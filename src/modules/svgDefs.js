/**
 * Inline external <defs> and <symbol> dependencies needed by an SVG subtree (or multiple SVGs),
 * so that serialization does not break. Handles:
 *  1) <use href="#..."> targets (symbols/defs)
 *  2) Attributes/inline styles that reference url(#id) (gradients, patterns, filters, clipPath, mask, marker-*)
 *  3) Recursive chains via href/xlink:href and nested url(#...) inside cloned defs
 *
 * Fast path: no computed styles, no layout reads. Only DOM queries + cloning.
 *
 * @param {Element} element - SVG root or container holding one/more SVGs.
 * @param {Document|ParentNode} [lookupRoot] - Where to search for external defs/symbols (defaults to element.ownerDocument).
 */
export function inlineExternalDefsAndSymbols(element, lookupRoot) {
  if (!element || !(element instanceof Element)) return

  const doc = element.ownerDocument || document
  const searchRoot = lookupRoot || doc

  /** Collect all SVG roots under element (or element if it's an <svg>) */
  const svgRoots =
    element instanceof SVGSVGElement
      ? [element]
      : Array.from(element.querySelectorAll('svg'))

  if (svgRoots.length === 0) return

  const URL_ID_RE = /url\(\s*#([^)]+)\)/g
  const URL_ATTRS = [
    'fill', 'stroke', 'filter', 'clip-path', 'mask',
    'marker', 'marker-start', 'marker-mid', 'marker-end'
  ]

  const cssEscape = (s) =>
    (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&')

  /** IDs ya presentes en TODO el contenedor root (no solo por-svg) */
  const globalExistingIds = new Set(
    Array.from(element.querySelectorAll('[id]')).map(n => n.id)
  )

  /** IDs referenciados (por cualquiera de los svgRoots) que no están locales aún */
  const neededIds = new Set()

  /** Flag para saber si hubo referencias (aunque luego no existan matches) */
  let sawAnyReference = false

  const addUrlIdsFromValue = (val) => {
    if (!val) return
    URL_ID_RE.lastIndex = 0
    let m
    while ((m = URL_ID_RE.exec(val))) {
      sawAnyReference = true
      const id = (m[1] || '').trim()
      if (id && !globalExistingIds.has(id)) neededIds.add(id)
    }
  }

  const collectReferencesInSvg = (rootSvg) => {
    // <use href="#...">
    const uses = rootSvg.querySelectorAll('use[href^="#"], use[xlink\\:href^="#"]')
    for (const u of uses) {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href')
      if (!href || !href.startsWith('#')) continue
      sawAnyReference = true
      const id = href.slice(1).trim()
      if (id && !globalExistingIds.has(id)) neededIds.add(id)
    }
    // url(#...) en attrs/estilos
    const candidates = rootSvg.querySelectorAll(`
      *[style*="url("],
      *[fill^="url("], *[stroke^="url("],
      *[filter^="url("], *[clip-path^="url("],
      *[mask^="url("],
      *[marker^="url("], *[marker-start^="url("],
      *[marker-mid^="url("], *[marker-end^="url("]
    `)
    for (const el of candidates) {
      addUrlIdsFromValue(el.getAttribute('style') || '')
      for (const a of URL_ATTRS) addUrlIdsFromValue(el.getAttribute(a))
    }
  }

  // 1) Recolectar referencias de TODOS los svgRoots con dedupe global
  for (const svg of svgRoots) collectReferencesInSvg(svg)

  // 2) Si no hay referencias, no crear contenedor (cumple test "does nothing...")
  if (!sawAnyReference) return

  // 3) Crear (o reutilizar) un ÚNICO contenedor oculto en 'element'
  let defsHost = element.querySelector('svg.inline-defs-container')
  if (!defsHost) {
    defsHost = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    defsHost.classList.add('inline-defs-container')
    defsHost.setAttribute('aria-hidden', 'true')
    defsHost.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    element.insertBefore(defsHost, element.firstChild || null)
  }
  let localDefs = defsHost.querySelector('defs') || null

  // 4) Resolver externos; nunca tomar fuentes que ya estén dentro de 'element'
  const findGlobalById = (id) => {
    if (!id) return null
    if (globalExistingIds.has(id)) return null // ya local en root
    const esc = cssEscape(id)

    const tryFind = (sel) => {
      const el = searchRoot.querySelector(sel)
      // si la fuente ya está dentro del contenedor root, no es "externa"
      return el && !element.contains(el) ? el : null
    }

    return (
      tryFind(`svg defs > *#${esc}`) ||
      tryFind(`svg > symbol#${esc}`) ||
      tryFind(`*#${esc}`)
    )
  }

  // 5) Si no hay matches globales, igual mantenemos el contenedor vacío (cumple test final)
  if (!neededIds.size) return

  const queued = new Set(neededIds)
  const inlined = new Set()

  while (queued.size) {
    const id = queued.values().next().value
    queued.delete(id)

    if (!id || globalExistingIds.has(id) || inlined.has(id)) continue

    const source = findGlobalById(id)
    if (!source) { // no existe externo o ya local en root
      inlined.add(id)
      continue
    }

    // Crear <defs> on-demand (solo si de verdad vamos a insertar algo)
    if (!localDefs) {
      localDefs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      defsHost.appendChild(localDefs)
    }

    const clone = source.cloneNode(true)
    if (!clone.id) clone.setAttribute('id', id)
    localDefs.appendChild(clone)
    inlined.add(id)
    globalExistingIds.add(id)

    // Seguir dependencias internas del clon (recursivo, dedupe global)
    const walk = [clone, ...clone.querySelectorAll('*')]
    for (const node of walk) {
      const h = node.getAttribute?.('href') || node.getAttribute?.('xlink:href')
      if (h && h.startsWith('#')) {
        const ref = h.slice(1).trim()
        if (ref && !globalExistingIds.has(ref) && !inlined.has(ref)) queued.add(ref)
      }
      const style = node.getAttribute?.('style') || ''
      if (style) addUrlIdsFromValue(style)
      for (const a of URL_ATTRS) {
        const v = node.getAttribute?.(a)
        if (v) addUrlIdsFromValue(v)
      }
    }
  }
}
