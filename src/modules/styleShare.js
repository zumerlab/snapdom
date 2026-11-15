/**
 * The identity share: within one capture, nodes with the same tag, attributes and ancestor
 * chain copy one computed-style read and re-read only the used values. `styleShareSafe` is
 * the per-capture verdict, the rest runs per node from styles.js and pseudo.js. The tables
 * live on the clone pass (`session.share`) and die with it.
 * @module styleShare
 */

import { snapshotComputedStyle } from '../utils/index.js'
import { scanFor } from '../core/changes.js'
import { pseudoUniverseFor } from './authorStyles.js'

/**
 * Whether the identity-share fast path is sound for THIS capture: no author selector that
 * can style two elements with identical tag + attributes + ancestor identity chain
 * differently (structural, sibling, state, :has — collected by styleScan) matches anything
 * under the capture root right now. A rule that matches nothing in the subtree at this
 * instant styles nobody the snapshot will read, so twins are identical by construction;
 * `.btn:hover` elsewhere on the page cannot split two table cells. One querySelector over
 * the joined gate, same shape as the pseudo pass's subtree question. Derived from the same
 * scan the property universe comes from; an unreadable scan or an unmatchable gate answers
 * "unsafe", which only costs the optimization.
 * Pinned by __tests__/module.styles.shareSubtreeGate.test.js.
 * @param {Element} el capture root
 * @returns {boolean}
 */
export function styleShareSafe(el) {
  try {
    const gate = scanFor(el.ownerDocument || document).shareGate
    if (gate === null) return false
    if (!gate.length) return true
    // Presence index of the subtree (root included): a selector whose subject compound
    // names a class/id/tag nobody here carries cannot match here, and stays out of the query.
    const present = new Set()
    const note = (n) => {
      present.add('t' + n.localName)
      if (n.id) present.add('i' + n.id)
      const cl = n.classList
      for (let i = 0; i < cl.length; i++) present.add('c' + cl[i])
    }
    note(el)
    for (const n of el.querySelectorAll('*')) note(n)
    const parts = []
    for (const { sel, key } of gate) if (key === null || present.has(key)) parts.push(sel)
    if (!parts.length) return true
    const sel = parts.join(',')
    return !el.matches(sel) && el.querySelector(sel) === null
  } catch {
    return false
  }
}

/**
 * Identity-share fast path (the per-element cold lever).
 *
 * A one-shot capture's dominant cost is the style snapshot: ~200 getPropertyValue reads per
 * node, measured at 56µs/node — 162ms of a 192ms capture on a 3000-node table. But most of
 * those nodes are structurally identical (same tag, same attributes, same ancestor chain),
 * and for such nodes the computed style can only differ in LAYOUT-derived values — the
 * properties CSSOM resolves to USED values. Measured across chromium/firefox/webkit with
 * identical-identity nodes whose boxes differ, the divergence set is: width/height (+ their
 * logical aliases), the box offsets, transform-origin and perspective-origin (box-derived),
 * margin/padding longhands (auto and % resolution), a grid container's track lists (`1fr 1fr`
 * reads as px per container — the deep-tree scene's grids took a deeper twin's columns and
 * laid out 18% of the pixels wrong), and the transform matrix (a % translate is resolved
 * against the box). So: read the full snapshot ONCE per identity, and per node re-read only
 * those.
 *
 * FIDELITY GATES, all conservative (any doubt → full reads):
 *  - document: no author selector that can split identical identities (structural position,
 *    sibling combinators, interaction/UA state, :has — styleShareSafe above), and no running
 *    animation/transition under the capture root (computed styles differ per frame). Decided
 *    once per capture in captureDOM, which writes it to the session (styleShare), and read
 *    from the clone pass.
 *  - element: never for form controls (UA styles their state without author CSS), never for
 *    the focused element (UA :focus-visible ring), never for shadow-root content (its sheets
 *    are outside the document scan the share gate comes from), and never for a shadow host
 *    or a slotted node, which that unscanned sheet styles through :host() and ::slotted().
 *    Pinned by __tests__/regression.shadowHostStructural.test.js.
 *
 * The share map lives on the SESSION — one capture — so no cross-capture staleness is
 * possible; the per-element snapshotCache (cross-capture, stamp-guarded) sits in front
 * exactly as before.
 */
/* Which shared-snapshot props a twin must RE-READ, refined empirically on all three engines
 * (2026-09-01, twins with %-valued props under different-width parents):
 *  - ALWAYS: the geometry props whose getComputedStyle value is the USED value regardless of
 *    how they were authored (width/height, transform-origin/perspective-origin).
 *  - POSITIONED: the box offsets (top/right/bottom/left and the inset-* logical longhands)
 *    resolve to used px only on a relative, absolute, fixed or sticky box. On a static one
 *    they read as the computed value ('10%' stays '10%') on all three engines, equal between
 *    twins under different-size parents, so they are re-read only when the identity's own
 *    `position` is not exactly 'static'. A container-query unit (`10cqw`) is the exception:
 *    it computes per container, so static twins then share a class text that differs from
 *    their own value, on a property that paints nothing on a static box.
 *  - NEVER: the min and max sizing longhands — their resolved value is the COMPUTED value ('10%' stays '10%',
 *    'auto' stays 'auto' on chromium, firefox AND webkit), and computed values are identical
 *    between identity twins by construction (same matched rules, same inherited inputs).
 *  - CONDITIONAL: the margin and padding longhands resolve %-values to used px, so they vary only when the
 *    document (or the identity's own inline style, identical across twins) actually gives
 *    the family an unstable value — styleScan flags marginUnstable/paddingUnstable. The grid
 *    track lists only on a grid container (elsewhere they are the specified value), and
 *    `transform` only when the identity has one (`none` cannot hide a % translate) — both
 *    decided from the identity's own read, so a table pays nothing for either. */
const LAYOUT_ALWAYS_RE = /^(width|height|inline-size|block-size|transform-origin|perspective-origin)$/
const OFFSET_RE = /^(top|right|bottom|left)$|^inset-/
const UNSTABLE_INLINE_RE = /(margin|padding)[a-z-]*\s*:[^;]*(%|\bauto\b|calc\(|var\()/i
export const SHARE_SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER', 'BUTTON', 'DATALIST'])

/** The capture's share state, made on first use: identity ids per node, the intern table,
 *  one snapshot record per identity. Lives on the session, so it dies with the capture. */
export function shareStateOf(session) {
  let st = session.share
  if (!st) {
    st = session.share = { ids: new WeakMap(), intern: new Map(), snaps: new Map(), rootSeen: false }
  }
  return st
}

/** Interned identity id: parent's id + own tag + every attribute, order-normalized. */
export function identityFor(el, st) {
  let id = st.ids.get(el)
  if (id !== undefined) return id
  const parent = el.parentElement
  // The walk is top-down, so the ONE node whose parent was never walked is the capture root
  // itself (its parent lives outside the capture, a context every node here shares — a
  // constant marker keeps chains comparable). Any LATER node with an unwalked parent is a
  // structure this walk does not understand: refuse to share under it.
  let pid
  if (!parent) {
    // The top of a shadow tree below the capture root. Its rules come from the root's own
    // sheet, which no scan reads and two roots do not share: the `::after` of the benchmark's
    // shadow scene took the colour of the first root read, on all 150 hosts.
    // Pinned by __tests__/module.styles.shareShadowRoots.test.js.
    pid = st.rootSeen ? -1 : 'R'
  } else {
    pid = st.ids.get(parent)
    if (pid === undefined) {
      if (st.rootSeen) {
        st.ids.set(el, -1)
        return -1
      }
      pid = 'R'
    }
  }
  st.rootSeen = true
  if (pid === -1) {
    st.ids.set(el, -1)
    return -1
  }
  let attrs = ''
  const list = el.attributes
  if (list && list.length) {
    if (list.length === 1) {
      attrs = list[0].name + '=' + list[0].value
    } else {
      const parts = []
      for (let i = 0; i < list.length; i++) parts.push(list[i].name + '=' + list[i].value)
      parts.sort()
      attrs = parts.join('\u0001')
    }
  }
  const key = pid + '|' + el.tagName + '|' + attrs
  id = st.intern.get(key)
  if (id === undefined) {
    id = st.intern.size
    st.intern.set(key, id)
  }
  st.ids.set(el, id)
  return id
}

/** The identity's re-read list and base signature, decided once on its first twin (`el`,
 *  whose style attribute is the identity's — the attribute is part of the key) and kept on
 *  the share record: the
 *  always-geometry props, plus the box offsets unless the identity is position:static, the
 *  margin/padding families only when the document-level
 *  scan or that inline style gives them an unstable value, the grid track lists on a grid
 *  container, and `transform` when the identity has one. The base signature covers the props
 *  twins NEVER re-read plus the re-read prop NAMES: a twin's full signature is base + its own
 *  re-read VALUES (+ the strip outcome), injective for the same reason the flat signature
 *  was — every name and value of the final snapshot is represented exactly once.
 *
 *  The list is the set of properties CSSOM resolves to USED values, and it was found by a
 *  defect: with the share on, the deep-tree scene rendered 18.6% of its pixels wrong because
 *  `grid-template-columns` reads as the used track list (`1fr 1fr` is `42px 388px` on one
 *  grid and `230px 840px` on its structural twin) and every grid took the first twin's
 *  columns. A probe of twins with different boxes on all three engines gave the full set.
 *  Building it on the first twin, and copying the snapshot once on the first hit, is what
 *  keeps the share free on a tree with no twins: per identity it cost the deep tree 27 ms of
 *  134, and twins spreading the identity's dictionary-mode object cost the 500-row table 6 ms.
 *  Pinned by __tests__/module.styles.identityShare.test.js.
 *  @param {{snap: object, rr: string[]|null, sig: string|null, h: boolean, b: boolean}} rec
 *  @param {Element} el the identity's first twin
 *  @returns {string[]} the re-read list, also stored on `rec.rr` */
export function shareLists(rec, el) {
  // Re-copied once here, riders included: the identity's own object was built by keyed
  // stores (dictionary mode in V8) and every twin spreads it — off a spread-made copy the
  // 500-row table's twins clone 6 ms faster, and only identities WITH twins pay the copy.
  const src = rec.snap
  const stored = rec.snap = { ...src }
  Object.defineProperty(stored, '__needsBgInline', { value: src.__needsBgInline, enumerable: false })
  if (src.__bgClipTextFix !== undefined) {
    Object.defineProperty(stored, '__bgClipTextFix', { value: src.__bgClipTextFix, enumerable: false })
  }
  const scan = scanFor(el.ownerDocument || document)
  const attr = (el.getAttribute && el.getAttribute('style')) || ''
  const inlineUnstable = attr && UNSTABLE_INLINE_RE.test(attr)
  const rrM = !!scan.marginUnstable || (inlineUnstable && /margin/i.test(attr))
  const rrP = !!scan.paddingUnstable || (inlineUnstable && /padding/i.test(attr))
  const rrG = stored.display !== undefined && stored.display.includes('grid')
  const rrT = stored.transform !== undefined && stored.transform !== 'none'
  // An absent `position` (a pseudo no rule positions, an excluded prop) still re-reads.
  const rrO = stored.position !== 'static'
  const rrList = []
  for (const k in stored) {
    if (LAYOUT_ALWAYS_RE.test(k) || (rrO && OFFSET_RE.test(k)) ||
        (rrG && (k === 'grid-template-columns' || k === 'grid-template-rows')) ||
        (rrT && k === 'transform') ||
        (rrM && k.charCodeAt(0) === 109 && k.startsWith('margin-')) ||
        (rrP && k.charCodeAt(0) === 112 && k.startsWith('padding-'))) rrList.push(k)
  }
  if (rec.h && !('height' in stored)) rrList.push('height')
  if (rec.b && !('block-size' in stored)) rrList.push('block-size')
  const rrSet = new Set(rrList)
  const staticParts = [el.tagName.toLowerCase()]
  for (const k in stored) { if (!rrSet.has(k)) staticParts.push(k, stored[k]) }
  rec.rr = rrList
  rec.sig = staticParts.join('\u0001') + '\u0002' + rrList.join('\u0001')
  return rrList
}

/**
 * A pseudo-element's snapshot, shared between identity twins the way the element's is. The
 * identity interned for `source` during the clone walk (same tag, attributes and ancestor
 * chain) means the same rules match its `::before` and its inherited inputs are a twin's,
 * so ONE pruned read per (identity, pseudo) and per twin only the used-value props
 * (shareLists — the element's own list, decided on the first twin). Falls back to the pruned
 * read whenever the element share is off for the capture (a splitting selector matching
 * under the root, animations, an unreadable scan, shadow content) or the walk refused this
 * node an identity. Deep tree with a `::before` on every leaf (1,936 pseudos), bare page:
 * pruned reads alone 272 ms; shared 190 ms; without the rule 125.
 * @param {Element} source
 * @param {string} pseudo '::before' | '::after'
 * @param {CSSStyleDeclaration} style getComputedStyle(source, pseudo)
 * Pinned by __tests__/module.pseudo.twinShare.test.js.
 * @param {Object} session the clone pass (carries the styleShare verdict and the share tables)
 * @returns {Record<string, string>}
 */
export function pseudoSnapshotFor(source, pseudo, style, session) {
  const st = session && session.styleShare ? session.share : null
  const id = st ? st.ids.get(source) : undefined
  // Same shadow-host and slotted escape as the element share (`:host(:nth-child(2))::before`).
  if (id === undefined || id === -1 || source.shadowRoot || source.assignedSlot) return snapshotComputedStyle(style, pseudoUniverseFor(source, session))
  const key = id + pseudo
  const snaps = st.pseudo || (st.pseudo = new Map())
  const rec = snaps.get(key)
  if (rec) {
    const snap = { ...rec.snap }
    const rr = rec.rr || shareLists(rec, source)
    for (let i = 0; i < rr.length; i++) {
      const v = style.getPropertyValue(rr[i])
      if (v) snap[rr[i]] = v
      else delete snap[rr[i]]
    }
    return snap
  }
  const snap = snapshotComputedStyle(style, pseudoUniverseFor(source, session))
  // By reference, copied on the first twin (shareLists), like the element share: a copy per
  // pseudo was paid on the deep tree for 1,936 identities that never had a twin. The one
  // write the pass makes afterwards (a flex-item min-width floor) depends on the host's
  // display, identical for twins.
  snaps.set(key, { snap, rr: null, sig: null, h: 'height' in snap, b: 'block-size' in snap })
  return snap
}
