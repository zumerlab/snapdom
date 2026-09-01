/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles, needsBackgroundInline } from '../modules/styles.js'
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
import { isFirefox, isSafari, nextFrame } from '../utils/browser.js'

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
function _nodeBox(node, _rect) {
  let r; try { r = node.getBoundingClientRect() } catch { return null }
  if (r.width === 0 && r.height === 0) return null
  const cs = getStyle(node)
  const sw = node.scrollWidth || 0, sh = node.scrollHeight || 0
  const box = { left: cs.direction === 'rtl' ? Math.min(r.left, r.right - sw) : r.left, top: r.top, right: Math.max(r.right, r.left + sw), bottom: Math.max(r.bottom, r.top + sh) }
  const wm = cs.writingMode || ''
  if (wm.startsWith('vertical') || wm.startsWith('sideways')) { box.top = Math.min(r.top, r.bottom - sh); box.left = Math.min(box.left, r.right - sw) }
  return { box, isInlineNonReplaced: cs.display === 'inline' && !CLIP_REPLACED_TAGS.has((node.localName||'').toLowerCase()) }
}
function ensureClipSubtreeCache(clip, rootEl) {
  if (clip._subtreeCache) return
  const map = new WeakMap()
  // bottom-up: reverse document order ensures children before parents
  const all = []
  const tw = (rootEl.ownerDocument||document).createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT)
  while (tw.nextNode()) all.push(tw.currentNode)
  for (let i = all.length - 1; i >= 0; i--) {
    const n = all[i]
    const info = _nodeBox(n, clip.rect)
    let hits = info && intersectsClip(info.box, clip.rect)
    if (!hits) {
      for (let c = n.firstElementChild; c; c = c.nextElementSibling) if (map.get(c)) { hits = true; break }
    }
    map.set(n, hits)
  }
  clip._subtreeCache = map
}
function isOutsideClip(node, clip) {
  if (node === clip.root) return false
  const info = _nodeBox(node, clip.rect)
  if (!info) return false
  if (info.isInlineNonReplaced) return false
  if (intersectsClip(info.box, clip.rect)) return false
  ensureClipSubtreeCache(clip, clip.root)
  if (clip._subtreeCache.get(node)) return false
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
  // walk-fusion helpers: register clone tag + collect img/image lists to avoid later queries
  const _track = (el) => {
    try {
      if (el && el.tagName && sessionCache.tagSet) sessionCache.tagSet.add(el.tagName.toLowerCase())
      if (el && el.tagName === 'IMG' && sessionCache.imgClones) sessionCache.imgClones.push(el)
      if (el && el.localName === 'image' && sessionCache.svgImageClones) sessionCache.svgImageClones.push(el)
    } catch {}
  }
  // Manual recursive walker: tracks the root + every descendant element via _track
  // WITHOUT allocating a live NodeList (querySelectorAll('*') is O(subtree size) and
  // was repeated per plugin hook / tag handler). Iterating node.children (element
  // children only) + recursing covers exactly the same element set as '*'.
  const trackSubtree = (node) => {
    try {
      _track(node)
      const kids = node.children
      for (let i = 0; i < kids.length; i++) {
        trackSubtree(kids[i])
      }
    } catch {}
  }
  const _trackTree = (root) => trackSubtree(root)
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
    const husk = makeClipHusk(node, sessionCache, options)
    _track(husk)
    return husk
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
          sessionCache.nodeMap.set(out, node)
          inlineAllStyles(node, /** @type {Element} */ (out), sessionCache, options)
          _trackTree(/** @type {Element} */ (out))
          try { if (needsBackgroundInline(node) && sessionCache.bgClones) sessionCache.bgClones.push(/** @type {Element} */ (out)) } catch {}
        }
        return out
      }
    }
  }

  {
    const preHandler = PRE_PLACEHOLDER_TAGS.has(node.tagName) && tagHandlers.get(node.tagName)
    if (preHandler) {
      const handled = await preHandler(node, sessionCache, options)
      if (handled !== undefined) {
        if (handled instanceof Element) {
          _trackTree(handled)
          try { if (needsBackgroundInline(node) && sessionCache.bgClones) sessionCache.bgClones.push(handled) } catch {}
        }
        return handled
      }
    }
  }

  if (node.getAttribute('data-capture') === 'placeholder') {
    const clone2 = node.cloneNode(false)
    sessionCache.nodeMap.set(clone2, node)
    inlineAllStyles(node, clone2, sessionCache, options)
    _track(clone2)
    const placeholder = document.createElement('div')
    placeholder.textContent = node.getAttribute('data-placeholder-text') || ''
    placeholder.style.cssText = 'color:#666;font-size:12px;text-align:center;line-height:1.4;padding:0.5em;box-sizing:border-box;'
    clone2.appendChild(placeholder)
    _track(placeholder)
    return clone2
  }

  {
    const handler = !PRE_PLACEHOLDER_TAGS.has(node.tagName) && tagHandlers.get(node.tagName)
    if (handler) {
      const handled = await handler(node, sessionCache, options)
      if (handled !== undefined) {
        if (handled instanceof Element) {
          _trackTree(handled)
          try { if (needsBackgroundInline(node) && sessionCache.bgClones) sessionCache.bgClones.push(handled) } catch {}
        }
        return handled
      }
    }
  }

  let clone
  try {
    clone = node.cloneNode(false)
    _track(clone)
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
      _trackTree(replacement)
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
  // walk-fusion: collect background-inline candidates to avoid later tree walk
  try { if (needsBackgroundInline(node) && sessionCache.bgClones) sessionCache.bgClones.push(clone) } catch {}
  // walk-fusion: collect blob URL nodes to avoid later 5x querySelectorAll in resolveBlobUrlsInTree
  try {
    const _hasBlob = (node.getAttribute?.('src')||'').includes('blob:') ||
                     (node.getAttribute?.('srcset')||'').includes('blob:') ||
                     (node.getAttribute?.('href')||'').includes('blob:') ||
                     (node.getAttribute?.('poster')||'').includes('blob:') ||
                     (node.getAttribute?.('style')||'').includes('blob:') ||
                     (node.tagName==='STYLE' && (node.textContent||'').includes('blob:'))
    if (_hasBlob && sessionCache.blobNodes) sessionCache.blobNodes.push(clone)
  } catch {}
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
      // Reuse the memoized computed style (cache.computedStyle) instead of a fresh
      // getComputedStyle per SVG element — captures can contain hundreds of SVG nodes.
      // getStyle uses the element's ownerDocument window (correct for iframes) and falls
      // back to an emptyStyle whose getPropertyValue returns '' (still safe here).
      const cs = getStyle(node)
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
        // Must NOT flatten: this set is checked against the host's *direct* childNodes.
        // flatten:true resolves nested slots away, so when a light-DOM child is itself a
        // <slot> (a component inside a component) it never lands here and gets cloned twice.
        const assigned = s.assignedNodes?.() || []
        for (const an of assigned) clonedAssignedNodes.add(an)
      }
    } catch {
    }
    const scopeId = nextShadowScopeId(sessionCache)
    const scopeSelector = `[data-sd="${scopeId}"]`
    sessionCache.shadowScopes ||= new WeakMap()
    sessionCache.shadowScopes.set(node.shadowRoot, scopeId)
    try {
      clone.setAttribute('data-sd', scopeId)
    } catch {
    }
    const rawCSS = extractShadowCSS(node.shadowRoot)
    const rewritten = rewriteShadowCSS(rawCSS, scopeSelector, scopeId)
    const neededVars = collectCustomPropsFromCSS(rawCSS)
    const seed = buildSeedCustomPropsRule(node, neededVars, scopeSelector)
    const _injected = injectScopedStyle(clone, seed + rewritten, scopeId)
    if (_injected && sessionCache.shadowStyleNodes) sessionCache.shadowStyleNodes.push(_injected)
    const shadowFrag = document.createDocumentFragment()
    // const, not a declaration: esbuild lowers block-level function declarations to a
    // hoisted `var` of the same name, which would clobber the walker below.
    const cloneShadowChild = (child, resolve) => {
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

    const cloneList = await idleCallback(Array.from(node.shadowRoot.childNodes), cloneShadowChild, options.fast)
    shadowFrag.append(...cloneList.filter(clonedChild => !!clonedChild))
    clone.appendChild(shadowFrag)
  }
  if (node.tagName === 'SLOT') {
    const scopeId = sessionCache.shadowScopes?.get(node.getRootNode())
    const directAssigned = node.assignedNodes?.() || []
    const assigned = directAssigned.length ? node.assignedNodes?.({ flatten: true }) || directAssigned : []
    const nodesToClone = assigned.length ? assigned : Array.from(node.childNodes)
    const fragment = document.createDocumentFragment()

    const cloneSlottedChild = (child, resolve) => {
      deepClone(child, sessionCache, options).then((clonedChild) => {
        if (clonedChild && directAssigned.length) {
          markSlottedSubtree(clonedChild, scopeId)
        }
        resolve(clonedChild || null)
      }).catch(() => {
        resolve(null)
      })
    }
    const cloneList = await idleCallback(Array.from(nodesToClone), cloneSlottedChild, options.fast)
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment
  }

  function cloneLightChild(child, resolve) {
    if (clonedAssignedNodes.has(child)) return resolve(null)
    // A shadow host renders its light DOM only through slots: a child that no slot accepted
    // (name mismatch, or a shadow tree with no <slot> at all) is not in the flat tree and
    // paints nothing. Cloning it anyway injects content the page never shows, and shows it
    // twice when the component mirrors its light DOM into its own shadow tree.
    if (node.shadowRoot && !child.assignedSlot) return resolve(null)
    deepClone(child, sessionCache, options).then((clonedChild) => {
      resolve(clonedChild || null)
    }).catch(() => {
      resolve(null)
    })
  }
  const cloneList = await idleCallback(Array.from(node.childNodes), cloneLightChild, options.fast)
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

  // NEW-7: warn that this iframe was skipped so callers can react. `placeholders` is on by
  // default, so what lands in the capture is the striped placeholder below; only mention the
  // opt-out, never suggest enabling an option that is already on.
  if (!sameOrigin) {
    console.warn(
      '[snapdom] cross-origin <iframe> skipped (its document cannot be read). Captured as a ' +
      'placeholder that keeps the frame\'s box; pass { placeholders: false } for an invisible spacer.',
      node
    )
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

/**
 * Whether nothing has been drawn into this canvas yet (fully transparent).
 * Sampled through a small scratch canvas so the check stays O(1) regardless of the source size;
 * only ever called under `{ debug: true }`.
 * @param {HTMLCanvasElement} node
 * @returns {boolean}
 */
function isBlankCanvas(node) {
  try {
    const w = Math.max(1, Math.min(32, node.width))
    const h = Math.max(1, Math.min(32, node.height))
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) return false
    sctx.drawImage(node, 0, 0, w, h)
    const data = sctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
    return true
  } catch {
    return false
  }
}

async function cloneCanvas(node, sessionCache, options) {
  // Safari-safe snapshot: poke + rAF + retry + scratch fallback
  let url = ''
  try {
    const ctx = node.getContext('2d', { willReadFrequently: true })
    try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
    // A canvas that already holds a WebGL/WebGPU context returns null above, and those are
    // exactly the ones that need a frame: with preserveDrawingBuffer:false the drawing
    // buffer is cleared as soon as the frame composites, so toDataURL called from a plain
    // task (a click handler, say) reads back fully transparent. Awaiting rAF resumes inside
    // the frame, right after the app's own render callback, while the buffer is still
    // intact — the blank-result retry below can't cover this because a transparent canvas
    // still serializes to a perfectly valid PNG, not to 'data:,' (#480).
    //
    // WebKit needs the same frame for the 2D poke to materialize the buffer; on other
    // engines toDataURL is synchronous with issued commands, so an unconditional rAF cost a
    // serialized frame (≥16ms) per canvas — dashboards with N 2D charts paid N frames.
    if (isSafari() || !ctx) await nextFrame()

    url = node.toDataURL('image/png')

    if (!url || url === 'data:,') {
      // reintento rápido
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      await nextFrame()
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

  // #486: a capture fired before the canvas has drawn anything (an animation still loading, a
  // chart rendered on the next frame) serializes a perfectly valid, perfectly empty PNG — the
  // capture "silently fails". Say so under debug, where it costs nothing in normal runs.
  if (options && options.debug && url && isBlankCanvas(node)) {
    debugWarn(sessionCache, 'canvas is empty at capture time — capture it after its first frame is drawn', node)
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
