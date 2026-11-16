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
 * Whether the identity share is sound for THIS capture: no selector that can split twins
 * (structural, sibling, state, :has, from styleScan) matches under the root right now, so
 * `.btn:hover` elsewhere on the page cannot split two table cells. An unreadable scan or an
 * unmatchable gate answers "unsafe", which only costs the optimization.
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
 * Identity-share fast path: the style snapshot is 162ms of a 192ms capture on a 3000-node table
 * (56µs/node), and nodes with the same tag, attributes and ancestor chain differ only in USED
 * values, so the snapshot is read once per identity and each twin re-reads only those. Off for
 * the capture when a selector can split twins (styleShareSafe) or something animates under the
 * root (captureDOM decides); per node, see SHARE_SKIP_TAGS and inlineAllStyles.
 * Pinned by __tests__/regression.shadowHostStructural.test.js.
 */
/** Read as USED values however they were authored, on all three engines (2026-09-01, twins
 *  under parents of different width). Not min/max sizes: those read COMPUTED ('10%', 'auto')
 *  on chromium, firefox AND webkit, identical between twins. */
const LAYOUT_ALWAYS_RE = /^(width|height|inline-size|block-size|transform-origin|perspective-origin)$/
/** Used px only on a non-static box; on a static one '10%' stays '10%'. */
const OFFSET_RE = /^(top|right|bottom|left)$|^inset-/
export const UNSTABLE_INLINE_RE = /(margin|padding)[a-z-]*\s*:[^;]*(%|\bauto\b|calc\(|var\()/i
/** The UA styles a form control's state without author CSS, so controls never share. */
export const SHARE_SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER', 'BUTTON', 'DATALIST'])

/** The capture's share state, made on first use: identity ids per node, the intern table,
 *  one snapshot record per identity. Lives on the session, so it dies with the capture. */
export function shareStateOf(session) {
  let st = session.share
  if (!st) {
    st = session.share = { ids: new WeakMap(), intern: new Map(), snaps: new Map(), rootSeen: false, pass: session }
  }
  return st
}

/** Interned identity id: parent's id + own tag + every attribute, order-normalized. */
export function identityFor(el, st) {
  let id = st.ids.get(el)
  if (id !== undefined) return id
  const parent = el.parentElement
  // Top-down walk: only the capture root has an unwalked parent, and it gets a constant
  // marker. Any later node with an unwalked parent is a structure the walk does not
  // understand, so nothing shares under it.
  let pid
  if (!st.rootSeen) {
    // The capture root. Inside a shadow tree its rules come from a sheet no gate has read.
    pid = el.getRootNode() === (el.ownerDocument || document) ? 'R' : -1
  } else if (parent) {
    pid = st.ids.get(parent)
    if (pid === undefined) pid = -1
  } else {
    // The top of a shadow tree chains to its host and to the roots holding the same CSS text
    // (clone.js), when that text cannot split twins (SHADOW_SPLIT_RE) and nothing is hovered,
    // focused or pressed. Chained to a constant, the benchmark's shadow `::after` took the
    // first root's colour on all 150 hosts.
    // Pinned by __tests__/module.styles.shareShadowRoots.test.js.
    const root = el.getRootNode()
    const host = root.host
    const hid = host && st.pass.shadowShare?.has(root) && !host.matches(':hover,:focus-within,:active')
      ? identityFor(host, st) : -1
    pid = hid === -1 ? -1 : hid + '~' + st.pass.shadowScopes.get(root)
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

/** The identity's re-read list, built on its first twin and kept on `rec.rr`; a twin's
 *  re-read values are all that tells its key from another twin's. A used value missing here
 *  is a pixel defect: without `grid-template-columns` (it reads as used tracks) the deep-tree
 *  scene painted 18.6% of its pixels wrong. Built lazily, so a tree with no twins pays
 *  nothing: per identity it cost the deep tree 27 ms of 134.
 *  Pinned by __tests__/module.styles.identityShare.test.js.
 *  @param {{snap: object, rr: string[]|null}} rec
 *  @param {Element} el the identity's first twin
 *  @returns {string[]} the re-read list, also stored on `rec.rr` */
export function shareLists(rec, el, st) {
  // Copied once here, riders included: every twin inherits from this object, so it must not
  // be the first node's own snapshot, which the passes keep writing to (the height strip
  // leaves `height: undefined` there, and the key stays on the re-read list below).
  const src = rec.snap
  const stored = rec.snap = { ...src }
  Object.defineProperty(stored, '__needsBgInline', { value: src.__needsBgInline, enumerable: false })
  if (src.__bgClipTextFix !== undefined) {
    Object.defineProperty(stored, '__bgClipTextFix', { value: src.__bgClipTextFix, enumerable: false })
  }
  const scan = scanFor(el.ownerDocument || document)
  const attr = (el.getAttribute && el.getAttribute('style')) || ''
  const inlineUnstable = attr && UNSTABLE_INLINE_RE.test(attr)
  // The scan read the document's sheets. For shadow content the answer is its root's, taken
  // from the root's own CSS text when the clone grouped it (clone.js).
  const shadow = st.pass.shadowShare?.get(el.getRootNode())
  // margin and padding resolve % to used px, so they re-read only when made unstable.
  const rrM = shadow || !!scan.marginUnstable || (inlineUnstable && /margin/i.test(attr))
  const rrP = shadow || !!scan.paddingUnstable || (inlineUnstable && /padding/i.test(attr))
  const rrG = stored.display !== undefined && stored.display.includes('grid')
  // `none` cannot hide a % translate.
  const rrT = stored.transform !== undefined && stored.transform !== 'none'
  // An absent `position` (a pseudo no rule positions, an excluded prop) still re-reads. A
  // static twin's `10cqw` offset computes per container and is shared, but paints nothing.
  const rrO = stored.position !== 'static'
  const rrList = []
  for (const k in stored) {
    if (LAYOUT_ALWAYS_RE.test(k) || (rrO && OFFSET_RE.test(k)) ||
        (rrG && (k === 'grid-template-columns' || k === 'grid-template-rows')) ||
        (rrT && k === 'transform') ||
        (rrM && k.charCodeAt(0) === 109 && k.startsWith('margin-')) ||
        (rrP && k.charCodeAt(0) === 112 && k.startsWith('padding-'))) rrList.push(k)
  }
  rec.rr = rrList
  return rrList
}

/**
 * A pseudo-element's snapshot, shared between identity twins like the element's: one pruned
 * read per (identity, pseudo), then per twin only the element's re-read list. Falls back to
 * the pruned read when the share is off or the node has no identity. Deep tree, `::before` on
 * all 1,936 leaves: pruned reads 272 ms, shared 190 ms, without the rule 125.
 * Pinned by __tests__/module.pseudo.twinShare.test.js.
 * @param {Element} source
 * @param {string} pseudo '::before' | '::after'
 * @param {CSSStyleDeclaration} style getComputedStyle(source, pseudo)
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
    const rr = rec.rr || shareLists(rec, source, st)
    for (let i = 0; i < rr.length; i++) {
      const v = style.getPropertyValue(rr[i])
      if (v) snap[rr[i]] = v
      else delete snap[rr[i]]
    }
    return snap
  }
  const snap = snapshotComputedStyle(style, pseudoUniverseFor(source, session))
  // By reference, copied on the first twin (shareLists): a copy per pseudo was paid for 1,936
  // deep-tree identities that never had a twin. The flex-item min-width floor written later
  // depends on the host's display, identical for twins.
  snaps.set(key, { snap, rr: null })
  return snap
}
