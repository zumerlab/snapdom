// src/utils/resolveCSSVars.js

import { getStyleEpoch } from './styles.js'

/** SVG container elements that act as templates: their descendants are rendered
 *  virtually via <use> / url(#...). CSS custom properties on the use site cascade
 *  into the rendered shadow tree, so any var() inside these containers must be
 *  preserved (NOT materialized at clone time) — otherwise we'd freeze the var()
 *  to whatever it resolves to in the dead template context (usually the fallback). */
const SVG_TEMPLATE_TAGS = new Set([
  'symbol', 'defs', 'pattern', 'marker',
  'linearGradient', 'radialGradient', 'filter'
])
/** Per-element memo, scoped to the style epoch so DOM restructuring invalidates it.
 *  Each ancestor resolves once per epoch — the old uncached walk was O(depth) per node
 *  and ran 3× per SVG element (resolveCSSVars + two clone.js sites). */
let __tplMemo = new WeakMap()
let __tplEpoch = -1
export function isInSvgTemplate(el) {
  const epoch = getStyleEpoch()
  if (epoch !== __tplEpoch) { __tplMemo = new WeakMap(); __tplEpoch = epoch }
  return tplLookup(el)
}
function tplLookup(el) {
  const hit = __tplMemo.get(el)
  if (hit !== undefined) return hit
  let result
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
    // #459: mask/clipPath paint their content in place, exactly once, at their own
    // document position — unlike <use>, there's no per-consumer shadow tree to
    // re-scope var() against, so this IS the one true rendering context. Treating
    // them as templates skipped inlineAllStyles entirely, dropping font-family/etc.
    // for anything inside (e.g. a <text> used as a mask cutout).
    if (el.localName === 'mask' || el.localName === 'clipPath') result = false
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
 * Resuelve var() en estilos inline/atributos del elemento, materializando el valor
 * computado en el clone. Los var() aplicados por reglas de hoja no necesitan pasada
 * propia: el snapshot de estilos (inlineAllStyles) ya captura sus valores resueltos,
 * y los SVG sin snapshot reciben la pasada SVG_PAINT_PROPS de deepClone.
 */
export function resolveCSSVars(sourceEl, cloneEl) {
  if ((sourceEl?.nodeType !== 1) || (cloneEl?.nodeType !== 1)) return

  // #408: descendants of <symbol>/<defs>/<pattern>/etc. render through <use>/url(#…),
  // where the cascade lives. Materializing var() here freezes the fallback.
  if (isInSvgTemplate(sourceEl)) return

  // --- 0) Pre-chequeo ultra barato
  const styleAttr = sourceEl.getAttribute?.('style')
  let hasVar = !!(styleAttr && styleAttr.includes('var('))

  if (!hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (a && typeof a.value === 'string' && a.value.includes('var(')) { hasVar = true; break }
    }
  }

  // Leemos cs sólo si hace falta o si vamos a comparar con baseline
  let cs = null
  if (hasVar) {
    try { cs = getComputedStyle(sourceEl) } catch {}
  }

  // --- 1) Resolver var() en estilos inline
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

  // --- 2) Resolver var() en atributos (genérico; si prop no existe en CSS, setProperty no hace nada)
  if (hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || typeof a.value !== 'string' || !a.value.includes('var(')) continue
      const propName = a.name
      const resolved = cs && cs.getPropertyValue(propName)
      if (resolved) {
        try { cloneEl.style.setProperty(propName, resolved.trim()) } catch {}
      }
    }
  }
}
