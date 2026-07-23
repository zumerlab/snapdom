/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js'
import { NO_CAPTURE_TAGS } from '../utils/css.js'
import { resolveCSSVars, isInSvgTemplate } from '../modules/CSSVar.js'
import { debugWarn, getStyle } from '../utils/index.js'
import {
  idleCallback,
  rewriteShadowCSS,
  nextShadowScopeId,
  extractShadowCSS,
  injectScopedStyle,
  freezeImgSrcset,
  collectCustomPropsFromCSS,
  buildSeedCustomPropsRule,
  markSlottedSubtree,
  rasterizeIframe,
  getUnscaledDimensions,
  createCheckboxRadioReplacement
} from '../utils/clone.helpers.js'
import { isFirefox, isSafari } from '../utils/browser.js'

// helper implementations moved to ../utils/clone.helpers.js

/* ────────────────────────────────────────────────────────────────────────────
 * Tag handler registry: per-tag clone strategies for elements whose content
 * can't be cloned structurally (iframe/canvas/video/audio). A handler returns
 * a finished clone Node, null to skip the node, or undefined to fall through
 * to the generic clone path.
 * ──────────────────────────────────────────────────────────────────────────── */

/** @type {Map<string, (node: Element, sessionCache: object, options: object) => Promise<Node|null|undefined>>} */
const tagHandlers = new Map()

/** Tags dispatched BEFORE the data-capture="placeholder" branch (an <iframe> placeholder
 *  clone would render as an empty frame, so iframe handling keeps precedence). */
const PRE_PLACEHOLDER_TAGS = new Set(['IFRAME'])

/**
 * Register a clone strategy for a tag (internal extension point).
 * @param {string} tag
 * @param {(node: Element, sessionCache: object, options: object) => Promise<Node|null|undefined>} handler
 */
export function registerTagHandler(tag, handler) {
  tagHandlers.set(String(tag).toUpperCase(), handler)
}

/**
 * Build a hidden, layout-preserving spacer matching a node's unscaled box, used when a node is
 * excluded/filtered in 'hide' mode. Forces at most one getBoundingClientRect (the inline form
 * could read it twice per node in the hot path).
 * @param {Element} node
 * @returns {HTMLDivElement}
 */
function makeHideSpacer(node) {
  const { width, height } = getUnscaledDimensions(node)
  let w = width, h = height
  if (!w || !h) {
    const rect = node.getBoundingClientRect()
    w = w || rect.width || 0
    h = h || rect.height || 0
  }
  const spacer = document.createElement('div')
  spacer.style.cssText = `display:inline-block;width:${w}px;height:${h}px;visibility:hidden;`
  return spacer
}

/** Extra px around the clip rect kept alive so partially-bleeding effects (shadows, blur,
 *  overhanging glyphs) of near-edge elements still paint into the window. */
const CLIP_CULL_MARGIN = 200

/** Replaced elements are atomic inline boxes, so a fixed-size husk holds their flow slot
 *  even at display:inline — and culling offscreen <img>/<canvas> skips fetch/encode work. */
const CLIP_REPLACED_TAGS = new Set(['img', 'canvas', 'video', 'iframe', 'object', 'embed'])

/**
 * @param {{left:number,top:number,right:number,bottom:number}} b
 * @param {{left:number,top:number,right:number,bottom:number}} rect
 */
function intersectsClip(b, rect) {
  return b.right >= rect.left - CLIP_CULL_MARGIN && b.left <= rect.right + CLIP_CULL_MARGIN &&
         b.bottom >= rect.top - CLIP_CULL_MARGIN && b.top <= rect.bottom + CLIP_CULL_MARGIN
}

/**
 * Clip mode: true when the node paints entirely outside the clip window and its whole
 * subtree can be pruned. Conservative: keeps zero-sized boxes (display:contents, anchors),
 * non-replaced inline boxes (no fixed-size husk can hold their flow slot), extends the box
 * by scroll overflow in the writing direction, and scans descendants' painted boxes so
 * out-of-flow escapees (fixed widgets, portal-less modals, negative offsets, transforms)
 * keep their ancestor chain alive.
 * @param {Element} node
 * @param {{rect: {left:number,top:number,right:number,bottom:number}, root: Element}} clip
 * @returns {boolean}
 */
function isOutsideClip(node, clip) {
  if (node === clip.root) return false
  let r
  try { r = node.getBoundingClientRect() } catch { return false }
  if (r.width === 0 && r.height === 0) return false
  const cs = getStyle(node)
  if (cs.display === 'inline' && !CLIP_REPLACED_TAGS.has((node.localName || '').toLowerCase())) return false
  const rect = clip.rect
  // Scroll overflow grows right/down in horizontal-ltr; mirror for rtl / vertical modes.
  const sw = node.scrollWidth || 0
  const sh = node.scrollHeight || 0
  const box = {
    left: cs.direction === 'rtl' ? Math.min(r.left, r.right - sw) : r.left,
    top: r.top,
    right: Math.max(r.right, r.left + sw),
    bottom: Math.max(r.bottom, r.top + sh)
  }
  const wm = cs.writingMode || ''
  if (wm.startsWith('vertical') || wm.startsWith('sideways')) {
    box.top = Math.min(r.top, r.bottom - sh)
    box.left = Math.min(box.left, r.right - sw)
  }
  if (intersectsClip(box, rect)) return false
  // Escape scan: any descendant whose painted box reaches the window (gBCR reads only —
  // no style/clone/inline work) vetoes the cull; deeper levels then cull its siblings.
  const tw = (node.ownerDocument || document).createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
  while (tw.nextNode()) {
    const dr = /** @type {Element} */ (tw.currentNode).getBoundingClientRect()
    if ((dr.width > 0 || dr.height > 0) && intersectsClip(dr, rect)) return false
  }
  return true
}

/**
 * Layout-preserving stand-in for a culled subtree: shallow clone with the original's
 * computed styles (so display/margin/flex/grid participation is identical) and a frozen
 * box, hidden and emptied. Deliberately NOT registered in sessionCache.nodeMap so the
 * pseudo/background walkers skip the pruned subtree.
 * @param {Element} node
 * @param {Object} sessionCache
 * @param {Object} options
 * @returns {Element}
 */
function makeClipHusk(node, sessionCache, options) {
  const husk = node.cloneNode(false)
  if (node.tagName === 'IMG') {
    husk.removeAttribute('src')
    husk.removeAttribute('srcset')
    husk.removeAttribute('sizes')
  }
  inlineAllStyles(node, husk, sessionCache, options)
  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) {
    husk.style.width = `${width}px`
    husk.style.minWidth = `${width}px`
    husk.style.maxWidth = `${width}px`
  }
  if (height > 0) {
    husk.style.height = `${height}px`
    husk.style.minHeight = `${height}px`
    husk.style.maxHeight = `${height}px`
  }
  husk.style.visibility = 'hidden'
  husk.style.overflow = 'hidden'
  // offset* are border-box; content-box elements with padding/border would inflate
  husk.style.boxSizing = 'border-box'
  return husk
}

export async function deepClone(node, sessionCache, options) {
  if (!node) throw new Error('Invalid node')
  const clonedAssignedNodes = new Set()
  let pendingSelectValue = null
  let pendingTextAreaValue = null
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node.localName || node.tagName || '').toLowerCase()
    if (node.id === 'snapdom-sandbox' || node.hasAttribute('data-snapdom-sandbox')) {
      return null
    }
    if (NO_CAPTURE_TAGS.has(tag)) {
      return null
    }
    // SVG spec: foreignObject cannot be nested inside another foreignObject.
    // The capture output already wraps everything in an outer foreignObject, so any
    // foreignObject found in the captured DOM would become doubly nested → silently
    // skipped by browsers. Detect via closest() on the source DOM and skip.
    if (tag === 'foreignobject' && node.parentElement?.closest?.('foreignObject')) {
      debugWarn(sessionCache, 'Nested <foreignObject> skipped (SVG spec limitation — not rendered by browsers)')
      return null
    }
    // A <picture>'s <source> out-ranks its <img>'s own src, so it survives into the export
    // still pointing at an external URL — and svg-as-image may not load external resources,
    // so the picture rasterizes blank no matter how well the <img> was inlined. The <img>
    // clone is already frozen to the variant the live page chose (freezeImgSrcset), so the
    // sources carry nothing we still need: drop them and let that src win.
    if (tag === 'source' && node.parentElement?.localName === 'picture') {
      return null
    }
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(true)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true)
  }
  if (node.getAttribute('data-capture') === 'exclude') {
    if (options.excludeMode === 'hide') {
      return makeHideSpacer(node)
    } else if (options.excludeMode === 'remove') {
      return null
    }
  }
  if (options.exclude && Array.isArray(options.exclude)) {
    for (const selector of options.exclude) {
      try {
        if (node.matches?.(selector)) {
          if (options.excludeMode === 'hide') {
            return makeHideSpacer(node)
          } else if (options.excludeMode === 'remove') {
            return null
          }
        }
      } catch (err) {
        console.warn(`Invalid selector in exclude option: ${selector}`, err)
      }
    }
  }
  if (typeof options.filter === 'function') {
    try {
      if (!options.filter(node)) {
        if (options.filterMode === 'hide') {
          return makeHideSpacer(node)
        } else if (options.filterMode === 'remove') {
          return null
        }
      }
    } catch (err) {
      console.warn('Error in filter function:', err)
    }
  }
  // Clip mode: prune subtrees painting entirely outside the window (before any plugin
  // hooks or tag handlers — no per-node work is spent on culled content).
  if (sessionCache.clip && isOutsideClip(node, sessionCache.clip)) {
    return makeClipHusk(node, sessionCache, options)
  }
  // Per-node plugin hook: the first plugin whose resolveNode returns a value wins
  // (Node = finished replacement clone, null = skip node, undefined = continue).
  // Hooks are collected once per capture in captureDOM; zero cost when unused.
  if (options.__resolveNodeHooks) {
    for (const hook of options.__resolveNodeHooks) {
      let out
      try { out = await hook(node, options) } catch (e) {
        debugWarn(sessionCache, 'resolveNode plugin hook failed', e)
      }
      if (out === null) return null
      if (out instanceof Node) {
        if (out.nodeType === Node.ELEMENT_NODE) {
          // Same treatment as built-in tag handlers: map to the source and carry its box
          // styles so the replacement keeps the original layout.
          sessionCache.nodeMap.set(out, node)
          inlineAllStyles(node, /** @type {Element} */ (out), sessionCache, options)
        }
        return out
      }
    }
  }

  {
    const preHandler = PRE_PLACEHOLDER_TAGS.has(node.tagName) && tagHandlers.get(node.tagName)
    if (preHandler) {
      const handled = await preHandler(node, sessionCache, options)
      if (handled !== undefined) return handled
    }
  }

  if (node.getAttribute('data-capture') === 'placeholder') {
    const clone2 = node.cloneNode(false)
    sessionCache.nodeMap.set(clone2, node)
    inlineAllStyles(node, clone2, sessionCache, options)
    const placeholder = document.createElement('div')
    placeholder.textContent = node.getAttribute('data-placeholder-text') || ''
    placeholder.style.cssText = 'color:#666;font-size:12px;text-align:center;line-height:1.4;padding:0.5em;box-sizing:border-box;'
    clone2.appendChild(placeholder)
    return clone2
  }

  {
    const handler = !PRE_PLACEHOLDER_TAGS.has(node.tagName) && tagHandlers.get(node.tagName)
    if (handler) {
      const handled = await handler(node, sessionCache, options)
      if (handled !== undefined) return handled
    }
  }

  let clone
  try {
    clone = node.cloneNode(false)
    // ROB-3: strip XML 1.0 invalid control characters from attribute values.
    // These characters are legal in HTML but rejected by XMLSerializer, breaking the SVG output.
    // Most common in data-* attributes with user-generated content.
    // Invalid chars: U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF
    if (clone.attributes?.length) {
      try {
        for (const attr of clone.attributes) {
          /* eslint-disable no-control-regex */
          if (/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/.test(attr.value)) {
            clone.setAttribute(attr.name, attr.value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, ''))
          }
          /* eslint-enable no-control-regex */
        }
      } catch { /* read-only attr or live collection change — non-blocking */ }
    }
    resolveCSSVars(node, clone)
    sessionCache.nodeMap.set(clone, node)
    if (node.tagName === 'IMG') {
      freezeImgSrcset(node, clone)
      // Record original image dimensions (pre-transform) for fallback usage when inlining fails
      try {
        const { width, height } = getUnscaledDimensions(node)
        const w = Math.round(width || 0)
        const h = Math.round(height || 0)
        if (w) clone.dataset.snapdomWidth = String(w)
        if (h) clone.dataset.snapdomHeight = String(h)
      } catch (e) {
        debugWarn(sessionCache, 'getUnscaledDimensions for IMG failed', e)
      }

      // Si el autor usó % o auto, o el alto/ ancho efectivos dan 0,
      // escribimos px en línea para evitar que el clon “pierda” la imagen.
      try {
        const authored = node.getAttribute('style') || ''
        const cs = window.getComputedStyle(node)
        const usesPercentOrAuto = (prop) => {
          const a = authored.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
          const v = a ? a[1].trim() : cs.getPropertyValue(prop)
          return /%|auto/i.test(String(v || ''))
        }

        const w = parseInt(clone.dataset.snapdomWidth || '0', 10)
        const h = parseInt(clone.dataset.snapdomHeight || '0', 10)

        const needFreezeW = usesPercentOrAuto('width') || !w
        const needFreezeH = usesPercentOrAuto('height') || !h

        if (needFreezeW && w) clone.style.width = `${w}px`
        if (needFreezeH && h) clone.style.height = `${h}px`

        // #337: Preserve object-fit and object-position for correct image proportions
        const objectFit = cs.getPropertyValue('object-fit')
        const objectPosition = cs.getPropertyValue('object-position')
        if (objectFit && objectFit !== 'fill') {
          clone.style.objectFit = objectFit
          if (objectPosition) clone.style.objectPosition = objectPosition
          // When object-fit is active, minWidth/minHeight can distort the image
          // Only set min dimensions if no object-fit override is in play
        } else {
          // Blindaje extra: evita que una clase agregada luego anule el fix
          if (w) clone.style.minWidth = `${w}px`
          if (h) clone.style.minHeight = `${h}px`
        }
      } catch (e) {
        debugWarn(sessionCache, 'IMG dimension freeze failed', e)
      }

    }
  } catch (err) {
    console.error('[Snapdom] Failed to clone node:', node, err)
    throw err
  }
  let applyInputVisual = null
  if (node instanceof HTMLTextAreaElement) {
    const { width, height } = getUnscaledDimensions(node)
    const w = width || node.getBoundingClientRect().width || 0
    const h = height || node.getBoundingClientRect().height || 0
    if (w) clone.style.width = `${w}px`
    if (h) clone.style.height = `${h}px`
  }
  if (node instanceof HTMLInputElement) {
    const type = (node.type || 'text').toLowerCase()
    const isCheckboxOrRadio = type === 'checkbox' || type === 'radio'
    if (isCheckboxOrRadio && isFirefox()) {
      const { el: replacement, applyVisual } = createCheckboxRadioReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else {
      clone.value = node.value
      clone.setAttribute('value', node.value)
      if (node.checked !== void 0) {
        clone.checked = node.checked
        if (node.checked) clone.setAttribute('checked', '')
        if (node.indeterminate) clone.indeterminate = node.indeterminate
      }
    }
  }

  // #315: Preserve ::placeholder color for inputs/textareas showing placeholder text
  if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && !node.value && node.placeholder) {
    try {
      const phStyle = window.getComputedStyle(node, '::placeholder')
      const phColor = phStyle && phStyle.color
      if (phColor && phColor !== 'rgba(0, 0, 0, 0)') {
        const uid = 'snapdom-ph-' + (Math.random() * 1e6 | 0)
        clone.classList.add(uid)
        const styleEl = document.createElement('style')
        styleEl.textContent = `.${uid}::placeholder{color:${phColor}!important;opacity:${phStyle.opacity || '1'}!important;-webkit-text-fill-color:${phColor}!important;}`
        clone.prepend(styleEl)
      }
    } catch { /* non-blocking */ }
  }

  if (node instanceof HTMLSelectElement) {
    pendingSelectValue = node.value
  }
  if (node instanceof HTMLTextAreaElement) {
    pendingTextAreaValue = node.value
  }
  // Copy form validation/state attributes so :disabled, :required, :read-only,
  // :invalid, :in-range/:out-of-range pseudo-class styles render correctly in the capture.
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
    if (node.disabled) clone.setAttribute('disabled', '')
    if (node.required) clone.setAttribute('required', '')
    if ((/** @type {HTMLInputElement|HTMLTextAreaElement} */ (node)).readOnly) clone.setAttribute('readonly', '')
    const inputNode = /** @type {HTMLInputElement} */ (node)
    if (inputNode.min !== undefined && inputNode.min !== '') clone.setAttribute('min', inputNode.min)
    if (inputNode.max !== undefined && inputNode.max !== '') clone.setAttribute('max', inputNode.max)
    if (inputNode.pattern !== undefined && inputNode.pattern !== '') clone.setAttribute('pattern', inputNode.pattern)
    // Reflect aria-invalid to surface :invalid visual state in the snapshot
    const ariaInvalid = node.getAttribute('aria-invalid')
    if (ariaInvalid !== null) clone.setAttribute('aria-invalid', ariaInvalid)
  }
  // #408: descendants of <symbol>/<defs>/etc. are templates rendered via <use>/url(#…).
  // Snapshotting their computed style here would freeze var() to the (dead) fallback.
  if (!isInSvgTemplate(node)) {
    inlineAllStyles(node, clone, sessionCache, options)
  }
  if (applyInputVisual) { applyInputVisual() }
  // #365: SVG painting elements — CSS rules override presentation attributes but aren't captured
  // via the class-based mechanism (NO_DEFAULTS_TAGS returns '' key). Copy key SVG presentation
  // properties from computed style as inline styles to ensure CSS-driven fills/strokes survive.
  // #408: skip descendants of <symbol>/<defs>/etc. — their var() must resolve at the <use> site,
  // not be materialized to the (dead) template's fallback computed value.
  if (node instanceof SVGElement && !isInSvgTemplate(node)) {
    const SVG_PAINT_PROPS = [
      'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity',
      'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
      'marker', 'marker-start', 'marker-mid', 'marker-end', 'visibility', 'display'
    ]
    try {
      const cs = window.getComputedStyle(node)
      for (const prop of SVG_PAINT_PROPS) {
        const val = cs.getPropertyValue(prop)
        if (val) clone.style.setProperty(prop, val)
      }
    } catch { }
  }
  if (node.shadowRoot) {
    try {
      const slots = node.shadowRoot.querySelectorAll('slot')
      for (const s of slots) {
        let assigned = []
        try {
          assigned = s.assignedNodes?.({ flatten: true }) || s.assignedNodes?.() || []
        } catch {
          assigned = s.assignedNodes?.() || []
        }
        for (const an of assigned) clonedAssignedNodes.add(an)
      }
    } catch {
    }
    const scopeId = nextShadowScopeId(sessionCache)
    const scopeSelector = `[data-sd="${scopeId}"]`
    try {
      clone.setAttribute('data-sd', scopeId)
    } catch {
    }
    const rawCSS = extractShadowCSS(node.shadowRoot)
    const rewritten = rewriteShadowCSS(rawCSS, scopeSelector)
    const neededVars = collectCustomPropsFromCSS(rawCSS)
    const seed = buildSeedCustomPropsRule(node, neededVars, scopeSelector)
    injectScopedStyle(clone, seed + rewritten, scopeId)
    const shadowFrag = document.createDocumentFragment()
    function callback(child, resolve) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'STYLE') {
        return resolve(null)
      } else {
        deepClone(child, sessionCache, options).then((clonedChild) => {
          resolve(clonedChild || null)
        }).catch(() => {
          resolve(null)
        })
      }
    }

    const cloneList = await idleCallback(Array.from(node.shadowRoot.childNodes), callback, options.fast)
    shadowFrag.append(...cloneList.filter(clonedChild => !!clonedChild))
    clone.appendChild(shadowFrag)
  }
  if (node.tagName === 'SLOT') {
    const assigned = node.assignedNodes?.({ flatten: true }) || []
    const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes)
    const fragment = document.createDocumentFragment()

    function callback(child, resolve) {
      deepClone(child, sessionCache, options).then((clonedChild) => {
        if (clonedChild) {
          markSlottedSubtree(clonedChild)
        }
        resolve(clonedChild || null)
      }).catch(() => {
        resolve(null)
      })
    }
    const cloneList = await idleCallback(Array.from(nodesToClone), callback, options.fast)
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment
  }

  function callback(child, resolve) {
    if (clonedAssignedNodes.has(child)) return resolve(null)
    deepClone(child, sessionCache, options).then((clonedChild) => {
      resolve(clonedChild || null)
    }).catch(() => {
      resolve(null)
    })
  }
  const cloneList = await idleCallback(Array.from(node.childNodes), callback, options.fast)
  clone.append(...cloneList.filter(clonedChild => !!clonedChild))

  // Adjust select value after children are cloned
  if (pendingSelectValue !== null && clone instanceof HTMLSelectElement) {
    clone.value = pendingSelectValue
    for (const opt of clone.options) {
      if (opt.value === pendingSelectValue) {
        opt.setAttribute('selected', '')
      } else {
        opt.removeAttribute('selected')
      }
    }
  }
  if (pendingTextAreaValue !== null && clone instanceof HTMLTextAreaElement) {
    clone.textContent = pendingTextAreaValue
  }
  return clone
}

/* ────────────────────────────────────────────────────────────────────────────
 * Built-in tag handlers (extracted from the former inline branches)
 * ──────────────────────────────────────────────────────────────────────────── */

async function cloneIframe(node, sessionCache, options) {
  let sameOrigin = false
  try { sameOrigin = !!(node.contentDocument || node.contentWindow?.document) } catch (e) {
    debugWarn(sessionCache, 'iframe same-origin probe failed', e)
  }

  if (sameOrigin) {
    try {
      const wrapper = await rasterizeIframe(node, sessionCache, options)
      return wrapper
    } catch (err) {
      console.warn('[SnapDOM] iframe rasterization failed, fallback:', err)
      // fall through
    }
  }

  // NEW-7: warn that this iframe was skipped so callers can react
  if (!sameOrigin) {
    console.warn('[snapdom] cross-origin <iframe> skipped (cannot access content). Use options.placeholders to show a placeholder instead.', node)
  }

  // Fallback actual (placeholder o spacer)
  if (options.placeholders) {
    const { width, height } = getUnscaledDimensions(node)
    const fallback = document.createElement('div')
    fallback.style.cssText =
      `width:${width}px;height:${height}px;` +
      'background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);' +
      'display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;'
    inlineAllStyles(node, fallback, sessionCache, options)
    return fallback
  } else {
    const { width, height } = getUnscaledDimensions(node)
    const spacer = document.createElement('div')
    spacer.style.cssText = `display:inline-block;width:${width}px;height:${height}px;visibility:hidden;`
    inlineAllStyles(node, spacer, sessionCache, options)
    return spacer
  }
}

async function cloneCanvas(node, sessionCache, options) {
  // Safari-safe snapshot: poke + rAF + retry + scratch fallback
  let url = ''
  try {
    const ctx = node.getContext('2d', { willReadFrequently: true })
    try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
    // WebKit needs a frame for the poke to materialize the buffer; on other engines
    // toDataURL is synchronous with issued commands, so an unconditional rAF cost a
    // serialized frame (≥16ms) per canvas — dashboards with N charts paid N frames.
    // The blank-result retry below still covers any engine that returns an empty frame.
    if (isSafari()) await new Promise(r => requestAnimationFrame(r))

    url = node.toDataURL('image/png')

    if (!url || url === 'data:,') {
      // reintento rápido
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      await new Promise(r => requestAnimationFrame(r))
      url = node.toDataURL('image/png')

      // último recurso: copiar a un scratch-canvas y leer desde ahí
      if (!url || url === 'data:,') {
        const scratch = document.createElement('canvas')
        scratch.width = node.width
        scratch.height = node.height
        const sctx = scratch.getContext('2d')
        if (sctx) {
          sctx.drawImage(node, 0, 0)
          url = scratch.toDataURL('image/png')
        }
      }
    }
  } catch (e) {
    debugWarn(sessionCache, 'Canvas toDataURL failed, using empty/fallback', e)
  }

  const img = document.createElement('img')
  try { img.decoding = 'sync'; img.loading = 'eager' } catch (e) {
    debugWarn(sessionCache, 'img decoding/loading hints failed', e)
  }
  if (url) img.src = url

  // conservar dimensiones intrínsecas del bitmap
  img.width = node.width
  img.height = node.height

  // conservar caja CSS para no romper layout usando dimensiones pre-transform
  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) img.style.width = `${width}px`
  if (height > 0) img.style.height = `${height}px`

  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

async function cloneVideo(node, sessionCache, options) {
  let url = ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = node.videoWidth || node.offsetWidth || 320
    canvas.height = node.videoHeight || node.offsetHeight || 240
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(node, 0, 0, canvas.width, canvas.height)
      url = canvas.toDataURL('image/png')
      // blank canvas = cross-origin or no frame loaded
      if (!url || url === 'data:,') url = ''
    }
  } catch (e) {
    debugWarn(sessionCache, 'Video frame capture failed, using poster fallback', e)
  }

  const img = document.createElement('img')
  try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
  if (url) {
    img.src = url
  } else if (node.poster) {
    img.src = node.poster
  }

  img.width = node.videoWidth || node.offsetWidth || 0
  img.height = node.videoHeight || node.offsetHeight || 0

  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) img.style.width = `${width}px`
  if (height > 0) img.style.height = `${height}px`
  img.style.objectFit = 'contain'

  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

async function cloneAudio(node, sessionCache, options) {
  // The native <audio controls> UI is a UA shadow-DOM widget that can't be
  // serialized, so a plain clone renders blank. Draw a representative player
  // sized to the element (#444). Without `controls` the native element is
  // display:none, so we leave those to the generic (invisible) clone.
  if (!node.controls) return undefined
  const { width, height } = getUnscaledDimensions(node)
  const w = Math.round(width || node.offsetWidth || 300)
  const h = Math.round(height || node.offsetHeight || 54)
  const cy = h / 2
  const tri = Math.max(4, h * 0.16)
  const px = h * 0.34
  const rTime = w - h * 0.34
  const trackX = px + tri + h * 0.55
  const trackW = Math.max(0, rTime - h * 0.7 - trackX)
  const fs = Math.max(9, Math.round(h * 0.24))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" rx="${Math.min(h / 2, 10)}" fill="#f1f3f4"/>` +
    `<path d="M ${px} ${cy - tri} L ${px + tri} ${cy} L ${px} ${cy + tri} Z" fill="#5f6368"/>` +
    `<rect x="${trackX}" y="${cy - 1.5}" width="${trackW}" height="3" rx="1.5" fill="#bdc1c6"/>` +
    `<circle cx="${trackX}" cy="${cy}" r="${Math.max(3, h * 0.09)}" fill="#5f6368"/>` +
    `<text x="${rTime}" y="${cy}" fill="#5f6368" font-family="sans-serif" font-size="${fs}" text-anchor="end" dominant-baseline="central">0:00</text>` +
    '</svg>'
  const img = document.createElement('img')
  try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  img.width = w
  img.height = h
  img.style.width = `${w}px`
  img.style.height = `${h}px`
  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

registerTagHandler('IFRAME', cloneIframe)
registerTagHandler('CANVAS', cloneCanvas)
registerTagHandler('VIDEO', cloneVideo)
registerTagHandler('AUDIO', cloneAudio)
