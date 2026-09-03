/**
 * SVG defs and symbols that live outside the captured subtree, copied into the clone.
 *
 * An icon sprite's <symbol>s, and the gradients, filters, clip paths and masks a page keeps
 * in one hidden <svg>, are referenced by id from anywhere in the document. Serialized on
 * their own, those references dangle and the effect is lost (#70, #178, #262). prepareClone
 * runs this on the clone so every referenced def travels with it.
 * @module svgDefs
 */

import { isSVGEl } from '../utils/helpers.js'

/**
 * Copy every external def or symbol the clone references into a hidden <svg> at its top.
 *
 * References are found in three places: `<use href="#id">` (any namespace or prefix),
 * `url(#id)` in presentation attributes and inline styles (fill, stroke, filter, clip-path,
 * mask, marker-*), and the same on the root <svg> itself, which querySelectorAll never
 * matches. HTML elements reach the same defs through CSS (`filter: url(#f)`), and that value
 * is only visible in the SOURCE's computed style, never on the clone, so the live root is
 * passed in too and walked only when the document holds a def CSS can reference. Copied defs
 * are walked for their own references, so chains resolve, each id once. No layout reads:
 * DOM queries and cloneNode only. Pinned by __tests__/module.svg.test.js and, in pixels,
 * __tests__/module.svgDefs.htmlRefs.test.js.
 * @param {Element} element - the clone: an <svg>, or a container holding one or more
 * @param {Document|ParentNode} [lookupRoot] - where the external defs are searched (element.ownerDocument by default)
 * @param {Element} [htmlSource] - the LIVE capture root, for references made through CSS
 */
export function inlineExternalDefsAndSymbols(element, lookupRoot, htmlSource) {
  if (!element || (element?.nodeType !== 1)) return

  const doc = element.ownerDocument || document
  const searchRoot = lookupRoot || doc

  /** Every <svg> under element, or element itself when it is one. */
  const svgRoots =
    isSVGEl(element) && element.localName === 'svg'
      ? [element]
      : Array.from(element.querySelectorAll('svg'))

  // Quotes are optional in CSS and getComputedStyle ADDS them: a class-based
  // `filter: url(#f)` reads back as `url("#f")`, which the unquoted-only pattern missed.
  const URL_ID_RE = /url\(\s*["']?\s*#([^)"']+)/g
  const URL_ATTRS = [
    'fill', 'stroke', 'filter', 'clip-path', 'mask',
    'marker', 'marker-start', 'marker-mid', 'marker-end'
  ]

  const cssEscape = (s) =>
    (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&')

  const XLINK_NS = 'http://www.w3.org/1999/xlink'

  /**
   * The element's href, whichever way it was written: `href`, `xlink:href`, the xlink
   * namespace, or any other `prefix:href` some serializers emit (ns1:href).
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

  /** Ids already present anywhere under element, not per <svg>. Grows as defs are copied in. */
  const globalExistingIds = new Set(
    Array.from(element.querySelectorAll('[id]')).map(n => n.id)
  )

  /** Referenced ids, from any of the svgRoots, that are not local yet. */
  const neededIds = new Set()

  /** Whether any reference was seen at all, matched or not. Decides if the container is made. */
  let sawAnyReference = false

  /**
   * Record the ids inside every url(#id) of an attribute or inline style value, and queue
   * them for resolution when a queue is given.
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
    // <use href="#..."> in any namespace or prefix
    const uses = rootSvg.querySelectorAll('use')
    for (const u of uses) {
      const href = getHrefAttr(u)
      if (!href || !href.startsWith('#')) continue
      sawAnyReference = true
      const id = href.slice(1).trim()
      if (id && !globalExistingIds.has(id)) neededIds.add(id)
    }

    // url(#...) in presentation attributes and inline styles
    const query =
      '*[style*="url("],' +
      '*[fill^="url("], *[stroke^="url("],*[filter^="url("],' +
      '*[clip-path^="url("],*[mask^="url("],*[marker^="url("],' +
      '*[marker-start^="url("],*[marker-mid^="url("],*[marker-end^="url("]'

    // querySelectorAll never matches rootSvg itself: url(#id) refs carried on the
    // <svg> element's own attributes (fill/filter/mask/clip-path/style) count too.
    addUrlIdsFromValue(rootSvg.getAttribute('style') || '')
    for (const a of URL_ATTRS) addUrlIdsFromValue(rootSvg.getAttribute(a))

    const candidates = rootSvg.querySelectorAll(query)
    for (const el of candidates) {
      addUrlIdsFromValue(el.getAttribute('style') || '')
      for (const a of URL_ATTRS) addUrlIdsFromValue(el.getAttribute(a))
    }
  }

  /**
   * HTML elements reach the same defs through CSS. The value lives in the computed style —
   * a class-based `filter: url(#f)` never touches the clone's attributes — so this is the
   * only place it can be read, and it is why the live source is passed in.
   *
   * Gated on the document actually holding a def that CSS can reference. `symbol` is
   * deliberately NOT in that list: an icon sprite is all <symbol>, it is reached through
   * <use href>, and counting it would put every sprite page through the walk below for
   * nothing. Pages with no filter/clipPath/mask/gradient/pattern id — nearly all of them —
   * pay one querySelector and stop.
   */
  const collectHtmlReferences = (root) => {
    if (!root || root.nodeType !== 1 || !root.querySelectorAll) return
    const referenceable = 'filter[id],clipPath[id],mask[id],linearGradient[id],radialGradient[id],pattern[id]'
    let hasDefs = false
    try { hasDefs = !!(searchRoot.querySelector && searchRoot.querySelector(referenceable)) } catch { return }
    if (!hasDefs) return
    const CSS_URL_PROPS = ['filter', 'clipPath', 'mask', 'maskImage', 'webkitMaskImage']
    const scan = (el) => {
      if (isSVGEl(el)) return // the SVG walk above already covers these
      let cs
      try { cs = getComputedStyle(el) } catch { return }
      for (const prop of CSS_URL_PROPS) {
        const v = cs[prop]
        if (v && v.includes('url(')) addUrlIdsFromValue(v)
      }
    }
    scan(root)
    for (const el of root.querySelectorAll('*')) scan(el)
  }

  // 1) Collect references from ALL svgRoots, deduped globally
  for (const svg of svgRoots) collectReferencesInSvg(svg)
  collectHtmlReferences(htmlSource)

  // 2) No references: leave the clone untouched, no container
  //    (module.svg.test.js, "does nothing if there are no <use> references")
  if (!sawAnyReference) return

  // 3) Create (or reuse) a SINGLE hidden container inside 'element'
  let defsHost = element.querySelector('svg.inline-defs-container')
  if (!defsHost) {
    defsHost = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    defsHost.classList.add('inline-defs-container')
    defsHost.setAttribute('aria-hidden', 'true')
    defsHost.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    element.insertBefore(defsHost, element.firstChild || null)
  }
  let localDefs = defsHost.querySelector('defs') || null

  // 4) Resolve external ones; never take sources that already live inside 'element'
  const findGlobalById = (id) => {
    if (!id) return null
    if (globalExistingIds.has(id)) return null // already local under the root
    const esc = cssEscape(id)

    const tryFind = (sel) => {
      const el = searchRoot.querySelector(sel)
      // a source already inside the root container is not "external"
      return el && !element.contains(el) ? el : null
    }

    return (
      tryFind(`svg defs > *#${esc}`) ||
      tryFind(`svg > symbol#${esc}`) ||
      tryFind(`*#${esc}`)
    )
  }

  // 5) References seen but all local already: the empty container stays
  //    (module.svg.test.js, "creates the hidden container even if no matches are found")
  if (!neededIds.size) return

  const queued = new Set(neededIds)
  const inlined = new Set()

  while (queued.size) {
    const id = queued.values().next().value
    queued.delete(id)

    if (!id || globalExistingIds.has(id) || inlined.has(id)) continue

    const source = findGlobalById(id)
    if (!source) { // not in the document, or already local under the root
      inlined.add(id)
      continue
    }

    // Create <defs> on demand, only when something is actually going to be inserted
    if (!localDefs) {
      localDefs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      defsHost.appendChild(localDefs)
    }

    const clone = source.cloneNode(true)
    if (!clone.id) clone.setAttribute('id', id)
    localDefs.appendChild(clone)
    inlined.add(id)
    globalExistingIds.add(id)

    // Follow the clone's internal dependencies (recursive, globally deduped)
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
