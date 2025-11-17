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

  const XLINK_NS = 'http://www.w3.org/1999/xlink'

  /**
   * Robustly get any SVG href-like attribute, including namespaced ones:
   *  - href
   *  - xlink:href
   *  - getAttributeNS(xlinkNS, 'href')
   *  - any other prefix:*:href (e.g. ns1:href used by some serializers)
   * @param {Element} el
   * @returns {string|null}
   */
  const getHrefAttr = (el) => {
    if (!el || !el.getAttribute) return null

    let href =
      el.getAttribute('href') ||
      el.getAttribute('xlink:href') ||
      (typeof el.getAttributeNS === 'function'
        ? el.getAttributeNS(XLINK_NS, 'href')
        : null)

    if (href) return href

    // Fallback: scan any prefix:href attributes (e.g. ns1:href)
    const attrs = el.attributes
    if (!attrs) return null
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || !a.name) continue
      if (a.name === 'href') return a.value
      const idx = a.name.indexOf(':')
      if (idx !== -1 && a.name.slice(idx + 1) === 'href') {
        return a.value
      }
    }
    return null
  }

  /** IDs ya presentes en TODO el contenedor root (no solo por-svg) */
  const globalExistingIds = new Set(
    Array.from(element.querySelectorAll('[id]')).map(n => n.id)
  )

  /** IDs referenciados (por cualquiera de los svgRoots) que no están locales aún */
  const neededIds = new Set()

  /** Flag para saber si hubo referencias (aunque luego no existan matches) */
  let sawAnyReference = false

  /**
   * Extrae ids de url(#id) de un valor de atributo/inline style.
   * Opcionalmente también encola los ids para resolución recursiva.
   * @param {string|null} val
   * @param {Set<string>|null} queueForResolve
   */
  const addUrlIdsFromValue = (val, queueForResolve = null) => {
    if (!val) return
    URL_ID_RE.lastIndex = 0
    let m
    while ((m = URL_ID_RE.exec(val))) {
      sawAnyReference = true
      const id = (m[1] || '').trim()
      if (!id) continue

      if (!globalExistingIds.has(id)) {
        neededIds.add(id)
        if (queueForResolve && !queueForResolve.has(id)) {
          queueForResolve.add(id)
        }
      }
    }
  }

  const collectReferencesInSvg = (rootSvg) => {
    // <use ...href="#..."> (cualquier namespace/prefix)
    const uses = rootSvg.querySelectorAll('use')
    for (const u of uses) {
      const href = getHrefAttr(u)
      if (!href || !href.startsWith('#')) continue
      sawAnyReference = true
      const id = href.slice(1).trim()
      if (id && !globalExistingIds.has(id)) neededIds.add(id)
    }

    // url(#...) en attrs/estilos
    const query =
      '*[style*="url("],' +
      '*[fill^="url("], *[stroke^="url("],*[filter^="url("],' +
      '*[clip-path^="url("],*[mask^="url("],*[marker^="url("],' +
      '*[marker-start^="url("],*[marker-mid^="url("],*[marker-end^="url("]'

    const candidates = rootSvg.querySelectorAll(query)
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
      const href = getHrefAttr(node)
      if (href && href.startsWith('#')) {
        const ref = href.slice(1).trim()
        if (ref && !globalExistingIds.has(ref) && !inlined.has(ref)) {
          queued.add(ref)
        }
      }

      const style = node.getAttribute?.('style') || ''
      if (style) addUrlIdsFromValue(style, queued)

      for (const a of URL_ATTRS) {
        const v = node.getAttribute?.(a)
        if (v) addUrlIdsFromValue(v, queued)
      }
    }
  }
}
