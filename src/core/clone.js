/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles, observeShadowRoot } from '../modules/styles.js'
import { NO_CAPTURE_TAGS } from '../utils/css.js'
import { resolveCSSVars, isInSvgTemplate } from '../modules/CSSVar.js'
import { debugWarn, getStyle, isPasswordInput, maskValue, isTag, isSVGEl } from '../utils/index.js'
import {
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
  createCheckboxRadioReplacement,
  createRangeReplacement
} from '../utils/clone.helpers.js'
import { isFirefox, isSafari, nextFrame } from '../utils/browser.js'
import { cloneTextWithSelection, inlineTextFieldSelection } from '../modules/selection.js'

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
  // A display:none node occupies nothing live, so ANY spacer shifts the layout; and a
  // hardcoded inline-block spacer for a block-level node adds a whole line box (baseline
  // + descender) on top of its height. `exclude` is the redaction feature, routinely
  // pointed at selectors that also match hidden elements — both cases moved content down.
  const display = getStyle(node).display
  if (display === 'none') return null
  const { width, height } = getUnscaledDimensions(node)
  let w = width, h = height
  if (!w || !h) {
    const rect = node.getBoundingClientRect()
    w = w || rect.width || 0
    h = h || rect.height || 0
  }
  const spacer = document.createElement('div')
  spacer.style.cssText = `display:${display === 'inline' ? 'inline-block' : display};width:${w}px;height:${h}px;visibility:hidden;`
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
  // Deliberately NOT overflow:hidden — that manufactures a BFC the original may not
  // have had, un-collapsing its margins with neighbors: 68 husks drifted deep-scroll
  // Wikipedia +812px, shifting the whole clip window one viewport. The husk is empty
  // (shallow clone), so there is nothing to clip anyway; it keeps the original's own
  // computed overflow from inlineAllStyles.
  // Escaped-margin compensation: an empty husk can't reproduce the child margins that
  // collapsed THROUGH the original's edges (Wikipedia loses 16px per husked <section>
  // — the whole flow drifts). Assign the LIVE measured gap to both husk edges: since
  // adjoining margins collapse to their max and the live gap already IS that max,
  // husk↔husk and husk↔content spacing land exactly on the live layout. Block flow
  // only — flex/grid/table parents don't collapse margins, and there the computed
  // margins already inlined are correct.
  const parentDisplay = node.parentElement ? getStyle(node.parentElement).display : ''
  const ownPos = getStyle(node).position
  if (!/flex|grid|table/.test(parentDisplay) && (ownPos === 'static' || ownPos === 'relative')) {
    const inFlow = (el) => {
      const cs = getStyle(el)
      return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed'
    }
    const r = node.getBoundingClientRect()
    let prev = node.previousElementSibling
    while (prev && !inFlow(prev)) prev = prev.previousElementSibling
    if (prev) {
      const g = r.top - prev.getBoundingClientRect().bottom
      if (g >= 0) husk.style.marginTop = `${g}px`
    }
    let next = node.nextElementSibling
    while (next && !inFlow(next)) next = next.nextElementSibling
    if (next) {
      const g = next.getBoundingClientRect().top - r.bottom
      if (g >= 0) husk.style.marginBottom = `${g}px`
    }
  }
  // offset* are border-box; content-box elements with padding/border would inflate
  husk.style.boxSizing = 'border-box'
  return husk
}

export async function deepClone(node, sessionCache, options) {
  if (!node) throw new Error('Invalid node')
  const clonedAssignedNodes = new Set()
  let pendingSelectValue = null
  let pendingSelectedFlags = null
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
    // Selected text is cloned with its highlight painted in: the selection itself is paint
    // state, not DOM, so a structural clone cannot carry it.
    if (sessionCache.selection) {
      const highlighted = cloneTextWithSelection(node, sessionCache.selection)
      if (highlighted) return highlighted
    }
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
  // Unified exclude predicates ((el) => true excludes). Split from selectors once in
  // createContext — zero typeof dispatch per node.
  if (options.excludePredicates) {
    for (const pred of options.excludePredicates) {
      try {
        if (pred(node)) {
          if (options.excludeMode === 'remove') return null
          return makeHideSpacer(node)
        }
      } catch (err) {
        console.warn('Error in exclude predicate:', err)
      }
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
      if (out?.nodeType) {
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
    resolveCSSVars(node, clone)
    sessionCache.nodeMap.set(clone, node)
    if (node.tagName === 'IMG') {
      freezeImgSrcset(node, clone, options)
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

      // When the author used % or auto, or the effective width/height resolve to 0,
      // write px inline so the clone does not "lose" the image.
      try {
        const authored = node.getAttribute('style') || ''
        const cs = window.getComputedStyle(node)
        const usesPercentOrAuto = (prop) => {
          const a = authored.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
          const v = a ? a[1].trim() : cs.getPropertyValue(prop)
          return /%|auto/i.test(String(v || ''))
        }

        // getUnscaledDimensions is the BORDER box (offsetWidth); width/height and min-* resolve
        // against the CONTENT box unless box-sizing is border-box, so with padding or a border
        // the frozen box was too large by exactly that much and the picture rendered scaled
        // inside it (measured against the live element: 18–34% of pixels differ with 20px
        // padding + a 5px border, 0% without either).
        const px = (p) => parseFloat(cs.getPropertyValue(p)) || 0
        const bb = cs.getPropertyValue('box-sizing') === 'border-box'
        const w = parseInt(clone.dataset.snapdomWidth || '0', 10) -
          (bb ? 0 : px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width'))
        const h = parseInt(clone.dataset.snapdomHeight || '0', 10) -
          (bb ? 0 : px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width'))

        const needFreezeW = usesPercentOrAuto('width') || !(w > 0)
        const needFreezeH = usesPercentOrAuto('height') || !(h > 0)

        if (needFreezeW && w > 0) clone.style.width = `${w}px`
        if (needFreezeH && h > 0) clone.style.height = `${h}px`

        // #337: Preserve object-fit and object-position for correct image proportions
        const objectFit = cs.getPropertyValue('object-fit')
        const objectPosition = cs.getPropertyValue('object-position')
        if (objectFit && objectFit !== 'fill') {
          clone.style.objectFit = objectFit
          if (objectPosition) clone.style.objectPosition = objectPosition
          // When object-fit is active, minWidth/minHeight can distort the image
          // Only set min dimensions if no object-fit override is in play
        } else {
          // Extra shielding: stops a class added later from overriding the fix. Content-box
          // values (see above): an earlier attempt corrected only this floor, saw no change on
          // a fixture whose freeze above still wrote the border box, and was reverted.
          if (w > 0) clone.style.minWidth = `${w}px`
          if (h > 0) clone.style.minHeight = `${h}px`
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
  if (isTag(node, 'textarea')) {
    const { width, height } = getUnscaledDimensions(node)
    const w = width || node.getBoundingClientRect().width || 0
    const h = height || node.getBoundingClientRect().height || 0
    if (w) clone.style.width = `${w}px`
    if (h) clone.style.height = `${h}px`
  }
  if (isTag(node, 'input')) {
    const type = (node.type || 'text').toLowerCase()
    const isCheckboxOrRadio = type === 'checkbox' || type === 'radio'
    // Firefox paints no native control inside a foreignObject, hence the replacement. It is
    // ALSO the only faithful path for an INDETERMINATE checkbox on any engine: that state
    // lives in a DOM property, XMLSerializer cannot emit it, and the cloned native control
    // therefore renders as plain unchecked. Measured on the same 30px box (dark pixels,
    // unchecked / indeterminate / checked): chromium 116 / 116 / 778 and webkit 10 / 10 / 57
    // — the middle state was indistinguishable from unchecked — against firefox 224 / 272 /
    // 826, where the replacement already drew the dash. An approximated dash is closer to the
    // truth than a checkbox that silently reads as "off".
    if (isCheckboxOrRadio && (isFirefox() || node.indeterminate)) {
      const { el: replacement, applyVisual } = createCheckboxRadioReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else if (type === 'range' && (isFirefox() || isSafari())) {
      // Same reason as the checkbox above: Firefox paints no native control inside a
      // foreignObject, so a cloned slider lost its track, its fill and its thumb. WebKit is
      // included beyond the fork's Firefox-only gate because it paints the slider without any
      // of its accent either (measured: 0 accent-coloured pixels on both engines).
      const { el: replacement, applyVisual } = createRangeReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else if (type === 'color' && isSafari()) {
      // WebKit paints a cloned colour well as a text field showing the hex value. The value
      // painted as a swatch is closer to the control than the value spelled out; !important
      // so the styles inlined from the (natively rendered) source cannot put the text back.
      const swatch = /** @type {HTMLInputElement} */ (clone)
      const colorValue = node.value || '#000000'
      applyInputVisual = () => {
        swatch.style.setProperty('background-color', colorValue, 'important')
        swatch.style.setProperty('color', 'transparent', 'important')
        swatch.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
        swatch.style.setProperty('appearance', 'none', 'important')
        swatch.style.setProperty('-webkit-appearance', 'none', 'important')
      }
      swatch.removeAttribute('value')
    } else if (
      (type === 'date' || type === 'time' || type === 'datetime-local') &&
      (isFirefox() || isSafari())
    ) {
      // The formatted text of these controls lives in UA shadow content that neither engine
      // paints inside a foreignObject: WebKit shows the raw machine value, Firefox nothing at
      // all. A text clone carrying the locale-formatted value reads like the control instead.
      clone.setAttribute('type', 'text')
      let shown = node.value
      if (type === 'date' && node.valueAsDate) {
        shown = node.valueAsDate.toLocaleDateString(undefined, { timeZone: 'UTC' })
      }
      clone.value = shown
      clone.setAttribute('value', shown)
    } else {
      // Password only, and only because the mask is fidelity-NEUTRAL: the control already
      // paints bullets, so a same-length bullet mask renders identically while the typed
      // secret stays out of the serialized SVG. Values the browser shows in plain text are
      // captured as-is; redacting those is the `redactInputs` plugin's job, not core's.
      const safeValue = isPasswordInput(node) ? maskValue(node.value) : node.value
      clone.value = safeValue
      clone.setAttribute('value', safeValue)
      if (node.checked !== void 0) {
        clone.checked = node.checked
        if (node.checked) clone.setAttribute('checked', '')
        if (node.indeterminate) clone.indeterminate = node.indeterminate
      }
    }
  }

  // #315: Preserve ::placeholder color for inputs/textareas showing placeholder text
  if ((isTag(node, 'input') || isTag(node, 'textarea')) && !node.value && node.placeholder) {
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

  if (isTag(node, 'select')) {
    pendingSelectValue = node.value
    // `value` is single-valued, so round-tripping a <select multiple> through it kept only
    // the first selected option and silently dropped the rest. Carry the whole selection.
    if (node.multiple) pendingSelectedFlags = Array.from(node.options).map((o) => o.selected)
  }
  if (isTag(node, 'textarea')) {
    pendingTextAreaValue = node.value
  }
  // Copy form validation/state attributes so :disabled, :required, :read-only,
  // :invalid, :in-range/:out-of-range pseudo-class styles render correctly in the capture.
  if (isTag(node, 'input') || isTag(node, 'textarea') || isTag(node, 'select')) {
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
  // A text field's selection lives on selectionStart/End rather than in a document Range, and
  // the field renders its own value, so the highlight is painted as background layers on the
  // clone instead of wrapped in a span.
  if (
    options.captureSelection &&
    (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
  ) {
    try {
      inlineTextFieldSelection(node, clone)
    } catch (e) {
      debugWarn(sessionCache, 'inlineTextFieldSelection failed', e)
    }
  }
  // #365: SVG painting elements — CSS rules override presentation attributes but aren't captured
  // via the class-based mechanism (NO_DEFAULTS_TAGS returns '' key). Copy key SVG presentation
  // properties from computed style as inline styles to ensure CSS-driven fills/strokes survive.
  // #408: skip descendants of <symbol>/<defs>/etc. — their var() must resolve at the <use> site,
  // not be materialized to the (dead) template's fallback computed value.
  if (isSVGEl(node) && !isInSvgTemplate(node)) {
    const SVG_PAINT_PROPS = [
      'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity',
      'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
      'marker', 'marker-start', 'marker-mid', 'marker-end', 'visibility', 'display',
      // fill/stroke: currentColor resolves against inherited color, which SVG children
      // without a style snapshot would otherwise lose (was resolveCSSVars' part 3).
      'color'
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
    // Wire this root into the style-snapshot invalidation. Nothing else can see inside it:
    // the document observer stops at the boundary, so without this a component that
    // re-renders between captures keeps serving its previous frame's snapshots.
    observeShadowRoot(node.shadowRoot)
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
    // The pseudo pass's preflight reads the DOCUMENT's sheets; a `<style>` in here is not
    // among them, and a page whose only ::after lives in a shadow root skipped the pass
    // entirely (the pinned shadow ::after that never painted).
    if (!sessionCache.__shadowPseudo && /::?(?:before|after|first-l|marker)|counter/.test(rawCSS)) sessionCache.__shadowPseudo = true
    const rewritten = rewriteShadowCSS(rawCSS, scopeSelector, scopeId)
    const neededVars = collectCustomPropsFromCSS(rawCSS)
    const seed = buildSeedCustomPropsRule(node, neededVars, scopeSelector)
    injectScopedStyle(clone, seed + rewritten, scopeId)
    // Children clone concurrently (sibling iframe/canvas work overlaps); a failed child
    // resolves to null and is dropped — same semantics the promise-wrapper scaffolding had.
    const shadowFrag = document.createDocumentFragment()
    const cloneList = await Promise.all(Array.from(node.shadowRoot.childNodes).map((child) =>
      (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'STYLE')
        ? null
        : deepClone(child, sessionCache, options).catch(() => null)
    ))
    shadowFrag.append(...cloneList.filter(clonedChild => !!clonedChild))
    clone.appendChild(shadowFrag)
  }
  if (node.tagName === 'SLOT') {
    const scopeId = sessionCache.shadowScopes?.get(node.getRootNode())
    const directAssigned = node.assignedNodes?.() || []
    const assigned = directAssigned.length ? node.assignedNodes?.({ flatten: true }) || directAssigned : []
    const nodesToClone = assigned.length ? assigned : Array.from(node.childNodes)
    const fragment = document.createDocumentFragment()
    const cloneList = await Promise.all(nodesToClone.map((child) =>
      deepClone(child, sessionCache, options).then((clonedChild) => {
        // Only real assignments carry a scope token; a slot's own fallback content belongs to
        // the shadow tree itself and must keep matching that tree's rules.
        if (clonedChild && directAssigned.length) markSlottedSubtree(clonedChild, scopeId)
        return clonedChild || null
      }).catch(() => null)
    ))
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment
  }

  // A shadow host renders its light DOM only through slots: a child already cloned at its slot
  // is skipped here, and a child that no slot accepted (its slot="name" matches nothing, or the
  // shadow tree has no <slot> at all) is outside the flat tree and paints nothing. Cloning the
  // latter injected content the page never shows, twice over for the common component that
  // reads its own light DOM and renders a copy inside its shadow tree.
  const skipLightChild = (child) =>
    clonedAssignedNodes.has(child) || (node.shadowRoot && !child.assignedSlot)
  const cloneList = await Promise.all(Array.from(node.childNodes).map((child) =>
    skipLightChild(child)
      ? null
      : deepClone(child, sessionCache, options).catch(() => null)
  ))
  clone.append(...cloneList.filter(clonedChild => !!clonedChild))

  // Adjust select value after children are cloned
  if (pendingSelectedFlags && isTag(clone, 'select')) {
    const opts = clone.options
    for (let i = 0; i < opts.length; i++) {
      if (pendingSelectedFlags[i]) opts[i].setAttribute('selected', '')
      else opts[i].removeAttribute('selected')
    }
  } else if (pendingSelectValue !== null && isTag(clone, 'select')) {
    clone.value = pendingSelectValue
    for (const opt of clone.options) {
      if (opt.value === pendingSelectValue) {
        opt.setAttribute('selected', '')
      } else {
        opt.removeAttribute('selected')
      }
    }
  }
  // Same reason as the select above, and the ordering is load-bearing: a textarea's child
  // nodes ARE its default value, so the recursion cloned that text and the append above just
  // put it back. Assigning here wipes those children and leaves exactly the live value.
  //
  // Move this up next to the other textarea handling, where it reads like it belongs, and it
  // runs BEFORE that append: the default text then lands after the value and the capture
  // shows the content twice. Verified, not assumed — that edit makes
  // core.clone.textarea.test.js report "expected 2 to be 1". Invisible on a textarea without
  // default content, which is most of them.
  //
  // Empty string is a real value, so the guard tests against null: `if (value)` would fall
  // through on a cleared textarea and leak the default back.
  if (pendingTextAreaValue !== null && isTag(clone, 'textarea')) {
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

  // Warn that this iframe was skipped so callers can react. `placeholders` is on by default,
  // so what lands in the capture is the striped placeholder below; only mention the opt-out,
  // never suggest enabling an option that is already on.
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
 * Sampled through a small scratch canvas so the check stays O(1) regardless of the source
 * size. Reading FROM the source with drawImage binds no context to it, which is what lets
 * cloneCanvas decide whether probing the source is safe at all.
 * @param {HTMLCanvasElement} node
 * @returns {boolean}
 */
export function isBlankCanvas(node) {
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
    // Read the canvas BEFORE asking it for a context. getContext('2d') on a canvas the page
    // has not initialized yet does not just answer the question — it CREATES the context and
    // permanently fixes the element's mode, so the page's own later getContext('webgl')
    // returns null and its renderer never starts. Snapdom must not be able to break the host
    // that way. isBlankCanvas reads through a scratch canvas (drawImage FROM the source),
    // which binds nothing to it.
    //
    // The discriminator: a canvas with content necessarily HAS a context, because nothing can
    // be drawn without one. So once it reads non-blank, getContext is safe by construction —
    // it returns the existing 2d context, or null when the context is WebGL/WebGPU.
    let blank = isBlankCanvas(node)
    if (blank) {
      // Blank means one of two things, and one frame separates them. A WebGL/WebGPU canvas
      // with preserveDrawingBuffer:false has its drawing buffer cleared as soon as the frame
      // composites, so a read from a plain task (a click handler, say) comes back fully
      // transparent; awaiting rAF resumes inside the frame, right after the app's own render
      // callback, while the buffer is still intact (#480). A canvas nobody has drawn into
      // stays blank across that frame — and it has nothing to capture, so it never needs the
      // poke that would have locked it.
      await nextFrame()
      blank = isBlankCanvas(node)
    }
    // WebKit needs a frame for the 2D poke to materialize the backing store; on other engines
    // toDataURL is synchronous with issued commands, so an unconditional rAF cost a serialized
    // frame (>=16ms) per canvas — dashboards with N 2D charts paid N frames.
    let ctx = null
    if (!blank) {
      ctx = node.getContext('2d', { willReadFrequently: true })
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      if (isSafari()) await nextFrame()
    }

    url = node.toDataURL('image/png')

    if (!url || url === 'data:,') {
      // quick retry
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      await nextFrame()
      url = node.toDataURL('image/png')

      // last resort: copy into a scratch canvas and read from there
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

  // keep the bitmap's intrinsic dimensions
  img.width = node.width
  img.height = node.height

  // keep the CSS box so layout is not broken, using pre-transform dimensions
  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) img.style.width = `${width}px`
  if (height > 0) img.style.height = `${height}px`

  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

async function cloneVideo(node, sessionCache, options) {
  let url = ''
  // The screen shows the poster until playback first starts or a seek (the "show poster
  // flag"), whatever frames are already decoded: drawImage would paint frame 0 on
  // Chromium/Firefox and nothing on WebKit, and even a blank canvas serializes to a valid
  // PNG that shadowed the poster. Read the flag from what it leaves behind instead.
  const showPoster = node.poster && node.paused && !node.currentTime && !node.played.length
  if (!showPoster) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = node.videoWidth || node.offsetWidth || 320
      canvas.height = node.videoHeight || node.offsetHeight || 240
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(node, 0, 0, canvas.width, canvas.height)
        url = canvas.toDataURL('image/png')
        if (!url || url === 'data:,') url = '' // 'data:,' is a 0x0 canvas
      }
    } catch (e) {
      debugWarn(sessionCache, 'Video frame capture failed, using poster fallback', e)
    }
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

/** <object>/<embed>: no handler meant their external data/src survived into the
 *  svg-as-image output, where external loads and nested browsing contexts are blocked —
 *  they rendered blank (or painted the object's FALLBACK children instead of the embedded
 *  content). Image-typed embeds become an <img> that inlineImages fetches like any source;
 *  same-origin embedded documents reuse the iframe rasterizer; the rest fall through to
 *  the generic clone (fallback children are the honest output there). */
async function cloneObjectEmbed(node, sessionCache, options) {
  const url = node.getAttribute('data') || node.getAttribute('src') || ''
  const type = (node.getAttribute('type') || '').toLowerCase()
  const looksImage = /^image\//.test(type) || /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(\?|#|$)/i.test(url)
  if (url && looksImage) {
    const img = document.createElement('img')
    try { img.decoding = 'sync'; img.loading = 'eager' } catch { }
    img.src = url
    const { width, height } = getUnscaledDimensions(node)
    if (width > 0) img.style.width = `${width}px`
    if (height > 0) img.style.height = `${height}px`
    sessionCache.nodeMap.set(img, node)
    inlineAllStyles(node, img, sessionCache, options)
    return img // fallback children deliberately dropped — both would paint otherwise
  }
  // Same-origin embedded document (e.g. text/html object) → rasterize like an iframe.
  let doc = null
  try { doc = node.contentDocument } catch { /* cross-origin */ }
  if (doc) {
    try {
      const out = await rasterizeIframe(node, sessionCache, options)
      if (out) return out
    } catch { /* fall through */ }
  }
  if (url) console.warn(`[snapdom] <${node.localName}> content could not be captured (${type || 'unknown type'}): rendering its fallback children`)
  return undefined // generic clone: fallback children render, matching the no-plugin browser behavior
}

registerTagHandler('IFRAME', cloneIframe)
registerTagHandler('CANVAS', cloneCanvas)
registerTagHandler('VIDEO', cloneVideo)
registerTagHandler('AUDIO', cloneAudio)
registerTagHandler('OBJECT', cloneObjectEmbed)
registerTagHandler('EMBED', cloneObjectEmbed)
