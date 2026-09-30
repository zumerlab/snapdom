/**
 * var() materialization for inline styles and attributes.
 *
 * A custom property resolves where the element lives. Inside the foreignObject the cascade
 * above the capture root is gone, so a `var(--x)` left in an inline style would take its
 * fallback, or nothing. `resolveCSSVars` writes the computed value onto the clone instead.
 * The one place that must NOT happen is an SVG template (`<symbol>`, or a shape in `<defs>`):
 * its content renders through `<use>`, where the consumer's custom properties cascade in,
 * so freezing the value there freezes the fallback (#408). Paint servers and the other
 * `url(#...)` targets are not templates: they inherit from their own position (#515).
 * @module CSSVar
 */

import { getStyleEpoch } from './styles.js'

/** SVG containers whose content `<use>` instantiates: the use site's custom properties
 *  cascade into that shadow tree, so a var() inside must survive the clone unresolved. */
const SVG_TEMPLATE_TAGS = new Set(['symbol', 'defs'])
/** url(#...) targets that paint where they sit in the document. A url() reference reaches
 *  the element itself, not a copy, so its content inherits from its own ancestors and the
 *  computed value IS the painted one. #515: a stop-color var() inside <defs> painted black
 *  because the gradient counted as a template. #459: the same for mask/clipPath. */
const SVG_IN_PLACE_TAGS = new Set([
  'mask', 'clipPath', 'linearGradient', 'radialGradient', 'pattern', 'marker', 'filter'
])
/** Per-element memo, scoped to the style epoch so DOM restructuring invalidates it.
 *  Each ancestor resolves once per epoch — the old uncached walk was O(depth) per node
 *  and ran 3× per SVG element (resolveCSSVars + two clone.js sites). */
let __tplMemo = new WeakMap()
let __tplEpoch = -1
/**
 * Whether `el` is, or sits inside, an SVG template container. clone.js skips the style
 * snapshot and the paint-prop pass for those. Pinned by __tests__/module.CSSVar.test.js.
 * @param {Element} el
 * @returns {boolean}
 */
export function isInSvgTemplate(el) {
  const epoch = getStyleEpoch()
  if (epoch !== __tplEpoch) { __tplMemo = new WeakMap(); __tplEpoch = epoch }
  return tplLookup(el)
}
/** The memoized walk: the element's own tag decides, else its parent's answer does. */
function tplLookup(el) {
  const hit = __tplMemo.get(el)
  if (hit !== undefined) return hit
  let result
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
    // The nearest container decides: a gradient inside <defs> paints in place.
    if (SVG_IN_PLACE_TAGS.has(el.localName)) result = false
    else if (SVG_TEMPLATE_TAGS.has(el.localName)) result = true
  }
  if (result === undefined) {
    const p = el.parentNode
    result = !!(p && p.nodeType === 1) && tplLookup(p)
  }
  __tplMemo.set(el, result)
  return result
}

/**
 * Resolves var() in the element's inline styles and attributes, materializing the
 * computed value onto the clone. var() applied by stylesheet rules needs no pass of its
 * own: the style snapshot (inlineAllStyles) already captures the resolved values, and
 * SVGs with no snapshot get deepClone's SVG_PAINT_PROPS pass.
 * Pinned by __tests__/module.CSSVar.test.js.
 * @param {Element} sourceEl
 * @param {Element} cloneEl
 */
export function resolveCSSVars(sourceEl, cloneEl) {
  if ((sourceEl?.nodeType !== 1) || (cloneEl?.nodeType !== 1)) return

  // #408: descendants of <symbol>/<defs>/<pattern>/etc. render through <use>/url(#…),
  // where the cascade lives. Materializing var() here freezes the fallback.
  if (isInSvgTemplate(sourceEl)) return

  // --- 0) Cheap pre-check: no 'var(' in the style attribute or any other attribute, nothing to do
  const styleAttr = sourceEl.getAttribute?.('style')
  let hasVar = !!(styleAttr && styleAttr.includes('var('))

  if (!hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      // An inlined data: URL is opaque here and can be megabytes: not worth the scan.
      if (a && typeof a.value === 'string' && !a.value.startsWith('data:') && a.value.includes('var(')) { hasVar = true; break }
    }
  }

  // Read cs only when needed, or when it is about to be compared against the baseline
  let cs = null
  if (hasVar) {
    try { cs = getComputedStyle(sourceEl) } catch {}
  }

  // --- 1) Resolve var() in the inline style
  if (hasVar) {
    const author = sourceEl.style
    if (author && author.length) {
      // visitedProps guards against duplicate property names in the iteration
      // (can happen with browser quirks or malformed style attributes) which
      // would otherwise re-resolve and re-set the same property redundantly.
      const visitedProps = new Set()
      for (let i = 0; i < author.length; i++) {
        const prop = author[i]
        if (visitedProps.has(prop)) continue
        visitedProps.add(prop)
        const val = author.getPropertyValue(prop)
        if (!val || !val.includes('var(')) continue
        const resolved = cs && cs.getPropertyValue(prop)
        if (resolved) {
          try { cloneEl.style.setProperty(prop, resolved.trim(), author.getPropertyPriority(prop)) } catch {}
        }
      }
    }
  }

  // --- 2) Resolve var() in attributes (generic: setProperty is a no-op for a non-CSS prop)
  if (hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || typeof a.value !== 'string' || a.value.startsWith('data:') || !a.value.includes('var(')) continue
      const propName = a.name
      const resolved = cs && cs.getPropertyValue(propName)
      if (resolved) {
        try { cloneEl.style.setProperty(propName, resolved.trim()) } catch {}
      }
    }
  }
}
