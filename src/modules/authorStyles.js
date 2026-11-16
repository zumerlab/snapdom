/**
 * What the page's author CSS can do, read from the document scan (styleScan.js, memoized in
 * core/changes.js): the properties it can set on an element or a pseudo-element, the
 * selectors that can generate a pseudo, the SVG geometry it declares, what it marks
 * `!important`, and whether a rule can restyle outside a subtree. Every reader answers the
 * conservative way when the scan is unreliable.
 * @module authorStyles
 */

import { isShadowRoot } from '../utils/index.js'
import { scanSheetProps, addAnimationProps } from './styleScan.js'
import { epoch, scanFor, scanOf } from '../core/changes.js'

/** Whether author CSS can restyle outside a dirty subtree. Shares the property-universe
 *  scan, including imports, fetched cross-origin rules, and the same epoch invalidation.
 *  @param {Document} doc
 *  @returns {boolean} */
export function stylesLeakAcrossSubtrees(doc) {
  return scanFor(doc).leaksAcrossSubtrees
}

/**
 * The properties some author rule declares `!important`, or null when the scan is unreliable
 * or `el` lives in a shadow root. normalizeInlineStyleToComputed re-resolves only the inline
 * declarations a stylesheet can beat; null means re-resolve all of them.
 * @param {Element} el
 * @returns {Set<string>|null}
 */
export function importantPropsFor(el) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return null
  return scanFor(doc).importantProps
}

/**
 * The properties the page's CSS can move off their UA default, or null (full reads). The base
 * reset and diff.js prune with the same set. Shadow content gets the session's union
 * (shadowUniverseOf), or full reads without a session.
 * @param {Element} el
 * @param {object} [session] - the capture's sessionCache
 * @returns {Set<string>|null}
 */
export function universeFor(el, session) {
  const doc = el.ownerDocument || document
  const root = el.getRootNode ? el.getRootNode() : doc
  if (root === doc) return scanOf(doc, session).universe
  return session && isShadowRoot(root) ? shadowUniverseOf(el, root, doc, session) : null
}

/** Per sheet and style epoch: what one shadow-root sheet can set, null when unreadable.
 *  Component libraries adopt one sheet per component type: the #503 table's 281 roots share
 *  34 sheets. */
const sheetPropsCache = new WeakMap()

/**
 * The universe for shadow content: the document's plus every root its style can come from
 * (its own and those above, its :host root, each ::slotted slot's root). One per session and
 * it only grows, so walk order does not matter. #503 ArcGIS table (2178 nodes, 281 roots):
 * first capture 590-614 to 472 ms, second 488 to 345 ms, raster identical.
 * Pinned by __tests__/module.styles.shadowUniverse.test.js.
 * @param {Element} el
 * @param {ShadowRoot} root - el's own root
 * @param {Document} doc
 * @param {object} session
 * @returns {Set<string>|null}
 */
function shadowUniverseOf(el, root, doc, session) {
  let st = session.shadowUniverse
  if (st === null) return null
  if (!st) {
    const base = scanOf(doc, session).universe
    if (!base) return (session.shadowUniverse = null)
    st = session.shadowUniverse = { universe: new Set(base), roots: new Set() }
  }
  const join = (r) => {
    for (; isShadowRoot(r) && !st.roots.has(r); r = r.host.getRootNode()) {
      st.roots.add(r)
      for (const sheet of [...r.styleSheets, ...(r.adoptedStyleSheets || [])]) {
        let rec = sheetPropsCache.get(sheet)
        if (!rec || rec.epoch !== epoch) sheetPropsCache.set(sheet, rec = { epoch, props: scanSheetProps(sheet) })
        if (!rec.props) return false
        for (const p of rec.props) st.universe.add(p)
      }
      addAnimationProps(r.getAnimations(), st.universe)
    }
    return true
  }
  let ok = join(root) && (!el.shadowRoot || join(el.shadowRoot))
  for (let slot = el.assignedSlot; ok && slot; slot = slot.assignedSlot) ok = join(slot.getRootNode())
  if (!ok) return (session.shadowUniverse = null)
  return st.universe
}

/** The property set a pseudo-element's snapshot reads (styleScan's pseudoUniverse); null
 *  (full read) for shadow content and an unreadable scan, like universeFor, and from the
 *  same pinned scan when given the session.
 *  @param {Element} el
 *  @param {object} [session] - the capture's sessionCache */
export function pseudoUniverseFor(el, session) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return null
  return scanOf(doc, session).pseudoUniverse
}

/** The SVG geometry/transform properties (styleScan's SVG_GEOMETRY_PROPS) some document rule
 *  or animation declares, for clone.js's copy onto SVG shapes. null (copy every one that
 *  applies) for shadow content and an unreadable scan, like universeFor. */
export function svgGeometryFor(el) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return null
  return scanFor(doc).svgGeometry
}

/** Whether a rule declaring one of those props can reach `el` (styleScan's svgGeometrySel).
 *  True without a usable gate (shadow, unreadable scan, WAAPI, selectorless block). None of
 *  these props is inherited, so the element itself must match.
 *  @param {Element} el document content (svgGeometryFor answered a Set for it) */
export function svgGeometryReaches(el) {
  const sel = scanFor(el.ownerDocument || document).svgGeometrySel
  if (sel == null) return true
  if (!sel) return false
  try { return el.matches(sel) } catch { return true }
}

/** Per-kind selector gates for the pseudo probe (see scanAuthorStyles). Same memo and
 *  same shadow-root escape as universeFor: null gates mean probe every node. */
const NULL_GATES = { before: null, after: null, firstLetter: null, marker: null, firstLine: null }
export function pseudoGatesFor(el) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return NULL_GATES
  return scanFor(doc).pseudoGates
}
