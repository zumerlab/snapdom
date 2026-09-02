import { getStyleKey, softensWidth, softenNeedsAutoWidth, shouldIgnoreProp, getStyle, NO_DEFAULTS_TAGS, isHTMLEl } from '../utils/index.js'
import { isFirefox } from '../utils/browser.js'
import { cache } from '../core/cache.js'
import { scanAuthorStyles } from './styleScan.js'

const snapshotCache = new WeakMap()
const snapshotKeyCache = new Map()
/** PERF-4: evict snapshotKeyCache when it grows beyond this size.
 *  Each entry stores a long CSS signature string → key string. In SPAs with many
 *  unique element styles, this Map can grow without bound and leak memory. */
const MAX_SNAPSHOT_KEY_CACHE = 2000
let __epoch = 0
function bumpEpoch() { __epoch++ }

export function notifyStyleEpoch() { bumpEpoch() }

/** Mutations on snapdom-owned helper nodes (sandbox, measure wrapper, warmup img, injected font
 *  links, …) must NOT invalidate the style epoch: every capture creates and removes them, so
 *  without this filter each capture poisons the snapshot cache for the next one — repeated
 *  captures (gif/video export, cached sessions) paid a full re-snapshot every time. */
const OWNED_SELECTOR = '[data-snapdom-sandbox],[data-snapdom-internal],[data-snapdom]'
function isOwnedNode(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement)
  return !!(el && el.closest && el.closest(OWNED_SELECTOR))
}
export function hasExternalMutation(records) {
  for (const rec of records) {
    if (isExternalRecord(rec)) return true
  }
  return false
}

/** Per-record variant of the same ownership filter — burst's differential dirty-tracking
 *  needs to attribute each external record to its subtree, not just a boolean. */
export function isExternalRecord(rec) {
  if (isOwnedNode(rec.target)) return false
  if (rec.type === 'childList') {
    let allOwned = true
    for (const n of rec.addedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
    if (allOwned) for (const n of rec.removedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
    if (allOwned) return false
  }
  return true
}

/** Style-RULE epoch: bumps only when the author RULES themselves can have changed — a
 *  <style>/<link> added, removed, retargeted or rewritten anywhere in the tree, plus the
 *  rule sources no mutation record reports at all (below). The scanned property universe
 *  and the pseudo gates are derived from the rule TEXT alone: which rules match is not
 *  their business, so keying them on __epoch made a single text-node change re-scan every
 *  author stylesheet on the next capture — the SPA case v3 exists for. */

/** Style-ENVIRONMENT epoch: bumps only on <head> mutations and font loads — the events
 *  that change how any element renders without touching it. Consumers (burst) poll it via
 *  getStyleEnvEpoch() instead of wiring their own observers/listeners: one shared stack,
 *  and polling can't root anything (a subscriber callback would leak its closure). */
let __envEpoch = 0
export function getStyleEnvEpoch() {
  setupInvalidationOnce()
  return __envEpoch
}

/** Current style epoch — bumps on any external DOM/head/font mutation. Consumers use it
 *  to scope per-epoch memos (e.g. isInSvgTemplate) that DOM restructuring must invalidate. */
export function getStyleEpoch() {
  setupInvalidationOnce()
  return __epoch
}

/** The user's escape hatch (`invalidate: true`), and the ONLY answer to the changes no
 *  observer can see: `sheet.insertRule()`, `rule.style.x = …`, canvas pixel draws. Those
 *  bump no epoch, so every epoch-scoped memo (property universe, style snapshots, CSSVar,
 *  pseudo gates) would keep serving the pre-edit CSS world — and it did, even with
 *  `burst: false`, because the memos live below burst. Bumps BOTH epochs so the escape
 *  hatch has no exceptions. */
export function invalidateStyleCaches() {
  bumpEpoch()
  __envEpoch++
}

/** Per-node style stamps: how far a DOM mutation is allowed to reach.
 *
 *  The style snapshot is the expensive thing this module owns — ~340 computed properties per
 *  node — and it was thrown away for every element in the document whenever anything anywhere
 *  mutated. A page where an unrelated component re-renders between captures therefore paid a
 *  cold snapshot pass every time: measured on a 73-node card, 1.6ms became 5.7ms, and 1.4ms
 *  became 3.2ms for the canvas-bearing cards auto-burst deliberately excludes.
 *
 *  A mutation at T can only restyle what a selector can reach from T: T's parent's subtree
 *  covers descendant selectors, inheritance and sibling combinators, and each ancestor's own
 *  snapshot covers `:has()` reaching upwards. What that does NOT cover is `:has()` reaching
 *  SIDEWAYS — `.a:has(.b) ~ .c` restyles a cousin no walk from T would visit — so the
 *  narrowing is only used on documents whose author rules contain no `:has()` at all, and
 *  those documents get the old document-wide invalidation. Fidelity is not traded for speed
 *  here: there is no staleness window, only a case that opts out of the optimization.
 *
 *  Everything that is genuinely document-wide keeps its epoch: rule and head changes, font
 *  loads, viewport resizes, and the invalidate escape hatch all bump __envEpoch, which the
 *  snapshot cache reads alongside the stamp. */
const nodeStamp = new WeakMap()
let nodeClock = 0
/** Bumped instead of the stamps when narrowing is unsound (a `:has()` document), which
 *  invalidates every snapshot at once — exactly the old behaviour. */
let __allStamp = 0

function stampNode(el) { nodeStamp.set(el, ++nodeClock) }

function stampSubtree(root) {
  if (!root || root.nodeType !== 1) return
  nodeClock++
  nodeStamp.set(root, nodeClock)
  const all = root.querySelectorAll('*')
  for (let i = 0; i < all.length; i++) nodeStamp.set(all[i], nodeClock)
}

/** Invalidate everything a change at `el` can restyle (see the note above). */
function invalidateAround(el) {
  stampSubtree(el.parentElement || el)
  for (let p = el.parentElement; p; p = p.parentElement) stampNode(p)
}

/** The stamp a node's cached snapshot was taken at. */
function stampOf(el) {
  return __allStamp * 1e9 + (nodeStamp.get(el) || 0)
}

/** Whether narrowing is sound for this document: no author rule uses `:has()`.
 *
 *  Memoized on __envEpoch, NOT __epoch, and that distinction is the whole fix. The answer
 *  derives from rule TEXT alone, but it used to read straight through scanFor, whose memo IS
 *  keyed on __epoch — and onDomRecords bumps __epoch immediately BEFORE asking. The entry
 *  therefore missed on every batch, so once any capture had wired the observer, EVERY
 *  external mutation in the host page (a React commit, a virtualised scroll) paid a full
 *  scanAuthorStyles — every rule in every sheet plus a document-wide getAnimations — with no
 *  capture in flight, forever. onInteraction paid it again on every focus and change.
 *  Hoisting the call above the bump does not help: the PREVIOUS batch's bump already
 *  invalidated the entry, so it saves exactly one scan, not one per batch.
 *
 *  __envEpoch covers the rule changes that matter here: <head> mutations, font loads,
 *  resizes and the `invalidate` escape hatch. The one source it misses is a <style>/<link>
 *  mounted outside <head>, which onDomRecords closes below by dropping this entry.
 *  A failed scan answers "cannot narrow" — the document-wide behaviour, always sound. */
const hasMemo = new WeakMap()
function canNarrow(doc) {
  doc = doc || document
  let h = hasMemo.get(doc)
  if (!h || h.env !== __envEpoch) {
    let usesHas = true
    try { usesHas = scanFor(doc).usesHas } catch { /* unreadable sheets — stay pessimistic */ }
    h = { env: __envEpoch, usesHas }
    hasMemo.set(doc, h)
  }
  return !h.usesHas
}

/** A <style>/<link> mounted, removed or rewritten OUTSIDE <head>: the head observer never
 *  sees it, so nothing bumps __envEpoch and canNarrow's memo would keep answering from
 *  before those rules existed — including a `:has()` rule, which would leave narrowing
 *  wrongly enabled. Cheap tag test; it only has to be conservative. */
function ruleSourceDoc(records) {
  for (const rec of records) {
    const t = rec.target
    const el = t && (t.nodeType === 1 ? t : t.parentElement)
    if (el && (el.tagName === 'STYLE' || el.tagName === 'LINK')) return el.ownerDocument || document
    for (const n of rec.addedNodes) if (n.tagName === 'STYLE' || n.tagName === 'LINK') return n.ownerDocument || document
    for (const n of rec.removedNodes) if (n.tagName === 'STYLE' || n.tagName === 'LINK') return (t && t.ownerDocument) || document
  }
  return null
}

/** Open shadow roots wired into the same invalidation.
 *
 *  Neither the document observer (MutationObserver does not cross a shadow boundary) nor
 *  stampSubtree (querySelectorAll does not either) can see inside one, so a web component
 *  that re-rendered itself between captures moved no stamp and no epoch, and its cached
 *  snapshots were served forever. The damage is not limited to geometry: rewriteShadowCSS
 *  emits shadow rules at specificity zero, so the stale generated class OUTRANKS the
 *  re-injected stylesheet and a `.box` -> `.box.active` flip keeps the previous frame's
 *  colours — verified in pixels, not in the payload, where the new rule is present but loses.
 *
 *  Kept in their own list rather than __observers: the prune in flushStyleInvalidations keys
 *  on defaultView, which a ShadowRoot does not have, so it would disconnect these on the
 *  first flush. Their prune is the host leaving the document, and it drops the WeakSet entry
 *  too so a re-attached host is re-armed.
 *
 *  Stamping is scoped to the tree that changed — shadow CSS is scoped, so a mutation inside
 *  cannot restyle anything but that tree and (via :host / ::slotted) its host. */
const shadowObserved = new WeakSet()
const __shadowObservers = []

function onShadowRecords(records) {
  if (!hasExternalMutation(records)) return
  bumpEpoch()
  const stamped = new Set()
  for (const rec of records) {
    if (!isExternalRecord(rec)) continue
    const root = rec.target.getRootNode && rec.target.getRootNode()
    if (!root || root.nodeType !== 11 || stamped.has(root)) continue
    stamped.add(root)
    nodeClock++
    if (root.host) nodeStamp.set(root.host, nodeClock)
    const all = root.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) nodeStamp.set(all[i], nodeClock)
  }
}

/** Called from deepClone for every open root it walks — already inside its `node.shadowRoot`
 *  branch, so nodes without one pay nothing. Closed roots stay unobservable by design. */
export function observeShadowRoot(root) {
  if (!root || shadowObserved.has(root)) return
  shadowObserved.add(root)
  try {
    const o = new MutationObserver(onShadowRecords)
    o.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
    __shadowObservers.push({ o, root })
  } catch { /* degrade: this root's changes will not invalidate */ }
}

/** The DOM observer's callback, also replayed by flushStyleInvalidations on drained records:
 *  one pass answers both "did anything paintable change" and "did the author rules change". */
function onDomRecords(records) {
  if (!hasExternalMutation(records)) return
  bumpEpoch()
  const ruleDoc = ruleSourceDoc(records)
  if (ruleDoc) hasMemo.delete(ruleDoc)
  // The epoch above still invalidates the memos that key off DOM structure (isInSvgTemplate,
  // CSSVar, burst's out-of-subtree gate). The snapshot cache is the one that reads stamps.
  //
  // Stamping is deduped by the subtree root it would walk. A batch carries one record per
  // mutation, and a re-render emits many against the same target (an attribute flip plus a
  // characterData edit plus a childList splice all share a parent), so the undeduped loop
  // ran one querySelectorAll('*') per RECORD over the same neighbourhood.
  const stamped = new Set()
  for (const rec of records) {
    if (!isExternalRecord(rec)) continue
    const el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement
    if (!el) continue
    const doc = el.ownerDocument || document
    if (!canNarrow(doc)) { __allStamp++; return }
    // A class or custom-property flip on <html> or <body> reaches the whole document, which
    // is what the all-stamp is for.
    if (el === doc.documentElement || el === doc.body) { __allStamp++; return }
    const root = el.parentElement || el
    if (stamped.has(root)) continue
    stamped.add(root)
    invalidateAround(el)
  }
}

/** Wired PER DOCUMENT, not once per page. A same-origin <iframe> is a second document with
 *  its own observers, listeners and FontFaceSet: wiring only the top one meant nothing
 *  inside an iframe ever bumped the epoch, so the style snapshots kept serving whatever the
 *  first capture saw. Editing a rule inside the frame changed the live pixels and changed
 *  nothing in the next capture. The epoch stays SHARED — a cross-document bump invalidates
 *  a few memos it did not have to, which costs one rescan; the alternative is per-document
 *  epoch bookkeeping in every consumer to fix an over-invalidation nobody can measure. */
const __wiredDocs = new WeakSet()
/** Hot-path memo. `inlineAllStyles` calls setupInvalidationOnce once PER NODE, and before
 *  per-document wiring that call was a single boolean read — effectively free. A WeakSet
 *  lookup per node is not: it did not show up on one engine at a time, but under
 *  `BROWSER=all` (three engines contending for the same machine) it pushed two WebKit tests
 *  past their 15s budget. Nodes come in document order, so an identity compare against the
 *  last document answers essentially every call, and the WeakSet is only consulted when the
 *  document actually changes — which happens once per iframe, not once per node. */
let __lastWiredDoc = null
/** Every observer we wired, in any document. `env` ones also bump the environment epoch.
 *  Entries carry their document so dead ones can be dropped: flushStyleInvalidations walks
 *  this list on EVERY capture, and an <iframe> that is created, captured and removed — which
 *  a test suite or an SPA does constantly — would otherwise leave its two observers here
 *  forever. The list grew without bound and each capture paid a takeRecords() per entry; over
 *  a long run that is a per-capture census of every document the page ever touched, which is
 *  precisely the cost profile that timed WebKit out before. */
const __observers = []
function setupInvalidationOnce(doc = document) {
  if (doc === __lastWiredDoc) return
  if (!doc || doc.nodeType !== 9) return
  if (__wiredDocs.has(doc)) { __lastWiredDoc = doc; return }
  __wiredDocs.add(doc)
  __lastWiredDoc = doc
  const view = doc.defaultView
  const onEnvRecords = (records) => {
    if (hasExternalMutation(records)) { bumpEpoch(); __envEpoch++ }
  }
  const onFonts = () => { bumpEpoch(); __envEpoch++ }
  try {
    const o = new MutationObserver(onDomRecords)
    o.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
    __observers.push({ o, env: false, doc })
  } catch { }
  try {
    const o = new MutationObserver(onEnvRecords)
    o.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true })
    __observers.push({ o, env: true, doc })
  } catch { }
  try {
    // Viewport resizes flip media queries — computed styles change with no DOM mutation.
    view?.addEventListener('resize', onFonts, { passive: true })
  } catch { }
  try {
    // Interaction pseudo-classes (:focus, :focus-visible, :checked, :disabled) re-style
    // elements without producing a single mutation record, so a cached snapshot kept
    // serving the pre-interaction styles. focusin/out bubble (focus/blur do not); change
    // covers checkbox/radio/select. :hover is deliberately NOT wired — pointer events fire
    // continuously and would flush the snapshot cache on every mouse move.
    // These bump the epoch AND stamp the neighbourhood the pseudo-class can restyle: the
    // snapshot cache reads stamps, not the epoch, so bumping alone would no longer reach it.
    const onInteraction = (event) => {
      bumpEpoch()
      const t = event.target
      if (t && t.nodeType === 1 && !isOwnedNode(t)) {
        if (canNarrow(t.ownerDocument || doc)) invalidateAround(t)
        else __allStamp++
      } else {
        __allStamp++
      }
    }
    doc.addEventListener('focusin', onInteraction, { capture: true, passive: true })
    doc.addEventListener('focusout', onInteraction, { capture: true, passive: true })
    doc.addEventListener('change', onInteraction, { capture: true, passive: true })
  } catch { }
  try {
    const f = doc.fonts
    if (f) {
      f.addEventListener?.('loadingdone', onFonts)
      f.ready?.then(onFonts).catch(() => { })
    }
  } catch { }
}

/** Synchronously drains pending invalidation records. MutationObserver delivery is a
 *  microtask, so a <style> injected in the same tick as a capture would otherwise be
 *  read against the stale epoch — the scanned universe/pseudo-gates would miss its
 *  rules. Called once per capture (from the pseudo preflight's fingerprint recompute). */
export function flushStyleInvalidations() {
  setupInvalidationOnce()
  try {
    for (let i = __observers.length - 1; i >= 0; i--) {
      const { o, env, doc } = __observers[i]
      // A detached document — an <iframe> removed from the page — has a null defaultView and
      // can never paint again, so it has nothing left to invalidate. Drop it here rather than
      // paying for it on every future capture.
      if (doc !== document && !doc.defaultView) {
        try { o.disconnect() } catch { }
        __wiredDocs.delete(doc)
        if (__lastWiredDoc === doc) __lastWiredDoc = null
        __observers.splice(i, 1)
        continue
      }
      const r = o.takeRecords()
      if (!r.length) continue
      if (env) { if (hasExternalMutation(r)) { bumpEpoch(); __envEpoch++ } }
      else onDomRecords(r)
    }
    for (let i = __shadowObservers.length - 1; i >= 0; i--) {
      const { o, root } = __shadowObservers[i]
      if (!root.host || !root.host.isConnected) {
        try { o.disconnect() } catch { }
        shadowObserved.delete(root)
        __shadowObservers.splice(i, 1)
        continue
      }
      const r = o.takeRecords()
      if (r.length) onShadowRecords(r)
    }
  } catch { }
}

/** Deletes cached style snapshots under a root. Animated subtrees re-snapshot per diff
 *  frame: animations repaint without mutation records, so the epoch never bumps and the
 *  cache would freeze the first captured frame. */
export function invalidateSnapshotsUnder(root) {
  if (!root || root.nodeType !== 1) return
  snapshotCache.delete(root)
  try {
    const tw = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    while (tw.nextNode()) snapshotCache.delete(tw.currentNode)
  } catch { }
}

/** URL-bearing props that mean inlineBackgroundImages must visit the node. */
const BG_INLINE_FLAG_PROPS = [
  'mask', 'mask-image', '-webkit-mask', '-webkit-mask-image',
  'mask-source', 'mask-box-image-source', 'mask-border-source', '-webkit-mask-box-image-source',
  'border-image', 'border-image-source',
]

/**
 * Whether the background-inline pass has work on this element, per its cached style snapshot.
 * Unknown (no fresh snapshot — STYLE tags, SVG template descendants) → true, so callers fall
 * back to processing the node like before.
 * @param {Element} source
 * @returns {boolean}
 */
export function needsBackgroundInline(source) {
  const rec = snapshotCache.get(source)
  if (rec && snapshotIsCurrent(rec, source)) {
    const f = rec.snapshot && rec.snapshot.__needsBgInline
    if (f !== undefined) return f
  }
  return true
}

/**
 * The element's current style snapshot, or null when there is none to trust. The background
 * pass reads through this instead of the CSSOM: a prop present in the snapshot is the value
 * the capture already resolved, and a prop ABSENT from it was pruned by the property
 * universe — the page cannot touch it, so its computed value is the default and there is
 * nothing to copy. Nodes carrying the Firefox background-clip:text fallback are excluded:
 * their snapshot background props were deliberately swapped (applyBgClipTextFallback) and
 * the background pass must keep seeing the live values it was written against.
 * @param {Element} source
 * @returns {object|null}
 */
export function snapshotFor(source) {
  const rec = snapshotCache.get(source)
  if (!rec || !snapshotIsCurrent(rec, source)) return null
  const snap = rec.snapshot
  if (!snap || snap.__bgClipTextFix) return null
  return snap
}

/** Per-document memo of the scanned property universe, invalidated by the style-RULE epoch:
 *  what it holds depends on the author rules only, never on the DOM they apply to.
 *  Exported so the base reset prunes itself with the SAME universe the snapshots use:
 *  a reset-stamped prop the class diff can no longer override (e.g. the resolved-black
 *  `-webkit-text-fill-color` overriding a white `color`) must not be emitted either. */
const universeCache = new WeakMap()
function scanFor(doc) {
  let rec = universeCache.get(doc)
  if (!rec || rec.epoch !== __epoch) {
    rec = { epoch: __epoch, ...scanAuthorStyles(doc) }
    universeCache.set(doc, rec)
  }
  return rec
}
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
 * @param {Element} el capture root
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

export function importantPropsFor(el) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return null
  return scanFor(doc).importantProps
}

export function universeFor(el) {
  const doc = el.ownerDocument || document
  // Shadow-root content: its own sheets aren't scanned — keep full reads there.
  if (el.getRootNode && el.getRootNode() !== doc) return null
  return scanFor(doc).universe
}

/** Per-kind selector gates for the pseudo probe (see scanAuthorStyles). Same memo and
 *  same shadow-root escape as universeFor: null gates → probe every node. */
const NULL_GATES = { before: null, after: null, firstLetter: null, marker: null, firstLine: null }
export function pseudoGatesFor(el) {
  const doc = el.ownerDocument || document
  if (el.getRootNode && el.getRootNode() !== doc) return NULL_GATES
  return scanFor(doc).pseudoGates
}

function snapshotComputedStyleFull(style, options = {}, el = null, universe = null) {
  const out = {}
  const excludeStyleProps = options.excludeStyleProps
  const addProp = (prop) => {
    if (out[prop] !== undefined) return
    if (shouldIgnoreProp(prop)) return
    if (excludeStyleProps) {
      if (excludeStyleProps instanceof RegExp && excludeStyleProps.test(prop)) return
      if (typeof excludeStyleProps === 'function' && excludeStyleProps(prop)) return
    }
    let val = style.getPropertyValue(prop)
    if (!val) return
    if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
      val = 'none'
    }
    out[prop] = val
  }
  if (universe) {
    // Pruned read: only properties the page's CSS (or this element's inline style) can
    // move off their UA defaults — anything else diffs empty downstream anyway.
    for (const prop of universe) addProp(prop)
    const inline = el && el.style
    if (inline && inline.length) {
      for (let i = 0; i < inline.length; i++) addProp(inline[i])
    }
  } else {
    for (let i = 0; i < style.length; i++) addProp(style[i])
  }
    // Ensure text-decoration props: some engines do not list them in the iteration.
  const EXTRA_TEXT_DECORATION_PROPS = [
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'text-decoration-thickness',
    'text-underline-offset',
    'text-decoration-skip-ink'
  ]
  for (const prop of EXTRA_TEXT_DECORATION_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  // #340: -webkit-text-stroke on Safari. Capture it even when the iteration omits it.
  const TEXT_STROKE_PROPS = [
    '-webkit-text-stroke',
    '-webkit-text-stroke-width',
    '-webkit-text-stroke-color',
    'paint-order'
  ]
  for (const prop of TEXT_STROKE_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  if (options.embedFonts) {
    const EXTRA_FONT_PROPS = [
      'font-feature-settings',
      'font-variation-settings',
      'font-kerning',
      'font-variant',
      'font-variant-ligatures',
      'font-optical-sizing',
    ]
    for (const prop of EXTRA_FONT_PROPS) {
      if (out[prop]) continue
      try {
        const v = style.getPropertyValue(prop)
        if (v) out[prop] = v
      } catch { }
    }
  }
  // Keep visibility as visibility. Unlike opacity, it is inherited but a child may explicitly
  // restore `visibility: visible`; flattening a hidden ancestor to opacity:0 makes that legal,
  // painted descendant impossible to recover.
  // content-visibility:hidden skips the element's CONTENTS while still painting the element's
  // own box (background, border, padding) - verified against real Chromium. Carry the
  // declaration itself so the rasterizer applies those exact semantics: mapping it to
  // visibility:hidden would erase the box too, and a descendant could override it back, which
  // the real property does not allow. Read explicitly because content-visibility is not always
  // enumerated in the style.length iteration.
  try {
    const cv = out['content-visibility'] || style.getPropertyValue('content-visibility')
    if (cv === 'hidden') out['content-visibility'] = 'hidden'
  } catch { /* ignore */ }

  // Flag whether inlineBackgroundImages has any work on this node (bg/mask/border-image or a
  // background-color that needs its layout longhands for background-clip:text). Read from the
  // live declaration (not `out`) so excludeStyleProps or the url()→none rewrite can't hide it.
  // Stored non-enumerable so key generation/signature iteration never sees it.
  Object.defineProperty(out, '__needsBgInline', { value: computeNeedsBgInline(style), enumerable: false })

  // #362: Tailwind's * { border: 0 solid } renders incorrectly in capture.
  // When all border widths are 0, normalize to border: none for unambiguous output.
  const bt = parseFloat(style.getPropertyValue('border-top-width') || 0) || 0
  const br = parseFloat(style.getPropertyValue('border-right-width') || 0) || 0
  const bb = parseFloat(style.getPropertyValue('border-bottom-width') || 0) || 0
  const bl = parseFloat(style.getPropertyValue('border-left-width') || 0) || 0
  if (bt === 0 && br === 0 && bb === 0 && bl === 0) {
    // If border-image is being used (even with zero border widths), do NOT force
    // the shorthand `border: none` because it can override the intended rendering.
    // (Decorative border-image + 0 widths is valid CSS in some setups.)
    const bis = (style.getPropertyValue('border-image-source') || '').trim()
    const hasBorderImage = bis && bis !== 'none'
    const BORDER_PROPS = [
      'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
      'border-width', 'border-style', 'border-color',
      'border-top-width', 'border-top-style', 'border-top-color',
      'border-right-width', 'border-right-style', 'border-right-color',
      'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
      'border-left-width', 'border-left-style', 'border-left-color',
      'border-block', 'border-block-width', 'border-block-style', 'border-block-color',
      'border-inline', 'border-inline-width', 'border-inline-style', 'border-inline-color',
      // The per-side logical longhands too, or they survive the normalization and re-declare
      // a zero-width solid border after the `border: none` emitted below.
      'border-block-start', 'border-block-start-width', 'border-block-start-style', 'border-block-start-color',
      'border-block-end', 'border-block-end-width', 'border-block-end-style', 'border-block-end-color',
      'border-inline-start', 'border-inline-start-width', 'border-inline-start-style', 'border-inline-start-color',
      'border-inline-end', 'border-inline-end-width', 'border-inline-end-style', 'border-inline-end-color',
    ]
    for (const p of BORDER_PROPS) delete out[p]
    if (!hasBorderImage) out['border'] = 'none'
  }

  applyBgClipTextFallback(out)

  return out
}
/**
 * Firefox cannot rasterize background-clip:text inside an SVG foreignObject image: the
 * background is dropped entirely, so gradient text whose own colour is transparent captures as
 * nothing at all (verified on v3: 0 painted pixels against Chromium's 1198 for the same span).
 * Approximate it with a plain text colour — the average of the gradient's stops — which loses
 * the gradient but keeps the words. Only fires when the text would otherwise be invisible.
 *
 * Imported from @frostin/snapdom (element-mirror).
 * @param {Record<string,string>} out mutable style snapshot
 */
function applyBgClipTextFallback(out) {
  if (!isFirefox()) return
  const clip = out['background-clip'] || out['-webkit-background-clip']
  if (!clip || !clip.includes('text')) return
  const transparent = (v) => v === 'transparent' || v === 'rgba(0, 0, 0, 0)'
  // -webkit-text-fill-color paints the glyphs when set; color is the fallback.
  const fill = out['-webkit-text-fill-color']
  if (!transparent(fill !== undefined ? fill : out['color'])) return
  const solid = bgClipTextFallbackColor(out['background-image'], out['background-color'])
  if (!solid) return
  if (transparent(out['color'])) out['color'] = solid
  if (fill !== undefined) out['-webkit-text-fill-color'] = solid
  out['background-image'] = 'none'
  out['background-color'] = 'transparent'
  delete out['background-clip']
  delete out['-webkit-background-clip']
  // Other passes re-inline the live values onto the clone over the class this snapshot
  // becomes (resolveCSSVars materializes the transparent colour, the authored inline-style
  // normalization re-inlines the gradient), so the fallback is also written inline with
  // !important; inlineAllStyles reads this marker. Non-enumerable: signature and key
  // iteration must not see it.
  Object.defineProperty(out, '__bgClipTextFix', { value: solid, enumerable: false })
}

/**
 * A single colour standing in for a clipped-to-text background: the channel average of every
 * visible rgb()/rgba() in the background-image (computed gradients serialize their stops that
 * way), else the background-color.
 * @param {string} [backgroundImage]
 * @param {string} [backgroundColor]
 * @returns {string|null}
 */
export function bgClipTextFallbackColor(backgroundImage, backgroundColor) {
  const collect = (value) => {
    const colors = []
    const re = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/g
    let m
    while ((m = re.exec(value || ''))) {
      const raw = m[4]
      const alpha = raw === undefined ? 1 : parseFloat(raw) / (raw.endsWith('%') ? 100 : 1)
      if (alpha > 0.05) colors.push([+m[1], +m[2], +m[3]])
    }
    return colors
  }
  let colors = collect(backgroundImage)
  if (!colors.length) colors = collect(backgroundColor)
  if (!colors.length) return null
  const sum = [0, 0, 0]
  for (const [r, g, b] of colors) {
    sum[0] += r
    sum[1] += g
    sum[2] += b
  }
  return `rgb(${sum.map((c) => Math.round(c / colors.length)).join(', ')})`
}

/** ~10-read probe behind __needsBgInline (also run standalone for NO_DEFAULTS_TAGS,
 *  which skip the full snapshot but can still carry an external mask/border-image). */
function computeNeedsBgInline(style) {
  const bgi = style.getPropertyValue('background-image')
  if (bgi && bgi !== 'none') return true
  const bgc = style.getPropertyValue('background-color')
  if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') return true
  for (const p of BG_INLINE_FLAG_PROPS) {
    const v = style.getPropertyValue(p)
    if (v && v !== 'none') return true
  }
  // #343: some engines report background-image:none while the shorthand carries url()
  const sh = style.getPropertyValue('background')
  return !!(sh && /url\s*\(/i.test(sh))
}

/**
 * Cheap "is this box sized by its own content?" check: any child element or non-whitespace
 * direct text node. O(1) amortized (firstElementChild short-circuits); never reads textContent
 * so it can't go O(n²) on deep trees.
 * @param {Element} el
 */
function hasRenderedContent(el) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue || '')) return true
    // #454: an out-of-flow child doesn't size its parent — KaTeX's .hide-tail span
    // (width:100%, abspos svg inside) is sized by CSS, not content, so its width
    // must be kept verbatim instead of softened away.
    if (n.nodeType === 1) {
      const pos = getStyle(n).position
      if (pos !== 'absolute' && pos !== 'fixed') return true
    }
  }
  return false
}
/**
 * Whether the element's width is author-specified (a length/percentage) rather than derived from
 * its content or from the layout algorithm around it.
 *
 * `getComputedStyle().width` cannot answer this: it resolves to the USED width, so `auto` and
 * `width: 16px` both come back as `16px`. Typed OM reports the COMPUTED value, where `auto` stays
 * `auto` — that is the exact question, and it is available in Chromium and WebKit. Firefox has no
 * Typed OM, so there the answer is inferred from layout instead (see the two probes below).
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs live computed style of `el`
 * @param {boolean} isFlexItem
 */
function hasSpecifiedWidth(el, cs, isFlexItem) {
  try {
    if (typeof el.computedStyleMap === 'function') {
      const v = el.computedStyleMap().get('width')
      if (v != null) return !isContentWidthKeyword(String(v).trim().toLowerCase())
    }
  } catch { /* fall through to the layout probes */ }
  const inlineWidth = el.style && (el.style.width || el.style.inlineSize)
  if (inlineWidth && !isContentWidthKeyword(String(inlineWidth).trim().toLowerCase())) return true
  // A box that hugs its content is sized by it — `width: max-content` / `fit-content` land here
  // too, and those must keep softening. For a block-level box, also require that the used width
  // is not simply the available width (that is what plain `width: auto` gives).
  if (!contentNarrowerThanBox(el, cs)) return false
  return isFlexItem || usedWidthDiffersFromAvailable(el, cs)
}

/** Computed `width` values that still let the box be sized by its content or its container. */
const CONTENT_WIDTH_KEYWORDS = new Set([
  'auto', 'min-content', 'max-content', 'stretch', 'fill-available', '-webkit-fill-available',
])
function isContentWidthKeyword(value) {
  // fit-content(<length>) too: the box still shrinks around its content.
  return CONTENT_WIDTH_KEYWORDS.has(value) || value.startsWith('fit-content')
}

/**
 * Fallback probe for flex/grid items: an item sized by its own content is exactly as wide as that
 * content, so a content box wider than everything inside it means the width came from CSS.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
function contentNarrowerThanBox(el, cs) {
  const box = el.getBoundingClientRect().width -
    (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) -
    (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0)
  if (!(box > 0)) return false
  let left = Infinity, right = -Infinity, range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    let r
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      r = range.getBoundingClientRect()
      if (!r.width && !r.height) continue
    } else if (n.nodeType === 1) {
      const s = getStyle(n)
      if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
      r = n.getBoundingClientRect()
    } else continue
    if (r.left < left) left = r.left
    if (r.right > right) right = r.right
  }
  if (right === -Infinity) return false
  return (right - left) < box - 0.5
}

/**
 * Fallback probe for block-level boxes in normal flow: with `width: auto` they fill the
 * containing block, so a used width that differs from the available width was authored.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
function usedWidthDiffersFromAvailable(el, cs) {
  const parent = el.parentElement
  if (!parent) return false
  const pcs = getStyle(parent)
  const available = parent.getBoundingClientRect().width -
    (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0) -
    (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0) -
    (parseFloat(cs.marginLeft) || 0) - (parseFloat(cs.marginRight) || 0)
  if (!(available > 0)) return false
  return Math.abs(el.getBoundingClientRect().width - available) > 0.5
}

const __snapshotSig = new WeakMap()
function styleSignature(snap) {
  let sig = __snapshotSig.get(snap)
  if (sig) return sig
  // Built in INSERTION order, not sorted. This string is only ever a key into
  // snapshotKeyCache — never rendered, serialized, or compared for ordering — and
  // snapshotComputedStyleFull fills every snapshot by walking the same property universe, so
  // two equal snapshots already come out in the same order. The sort was a per-element
  // reordering of an already-ordered list, paid on the COLD path that every one-shot capture
  // takes: Object.entries + sort + map + join over ~130 properties, once per element.
  // Measured on a 1500-node table, per-element cold cost: 118ms sorted -> 77ms here (-35%),
  // with the warm path unchanged.
  //
  // Use push + join, NOT `sig +=`. The concatenating form builds a cons-string that V8 has
  // to flatten the moment it is used as a Map key, which moved the cost rather than removing
  // it (warm went 21ms -> 30ms while cold improved). join produces a flat string directly.
  //
  // The separator is U+0001 rather than the old `:`/`;` because both of those occur inside
  // real property values (a data: URL, a quoted font-family), so the old format could in
  // principle collide two different snapshots onto one key. A control character cannot
  // appear in a computed value.
  //
  // The only cost of dropping the sort is that two elements whose INLINE style properties
  // were authored in a different order now miss each other in the key cache — one extra
  // getStyleKey call, never a wrong key. `__needsBgInline` is non-enumerable, so for...in
  // sees exactly what Object.entries saw.
  const parts = []
  for (const k in snap) parts.push(k, snap[k])
  sig = parts.join('\u0001')
  __snapshotSig.set(snap, sig)
  return sig
}
/** A cached snapshot is current while nothing document-wide happened (env epoch) and nothing
 *  a selector could follow to this node did (its stamp). */
function snapshotIsCurrent(rec, el) {
  return rec.env === __envEpoch && rec.stamp === stampOf(el)
}

/**
 * Identity-share fast path (the per-element cold lever).
 *
 * A one-shot capture's dominant cost is the style snapshot: ~200 getPropertyValue reads per
 * node, measured at 56µs/node — 162ms of a 192ms capture on a 3000-node table. But most of
 * those nodes are structurally identical (same tag, same attributes, same ancestor chain),
 * and for such nodes the computed style can only differ in LAYOUT-derived values. Measured
 * across chromium/firefox/webkit with identical-identity nodes whose content differs, the
 * complete divergence set is: width/height (+ their logical aliases), transform-origin and
 * perspective-origin (box-derived), and margin/padding longhands (auto and % resolution). So: read
 * the full snapshot ONCE per identity, and per node re-read only the layout-varying props.
 *
 * FIDELITY GATES, all conservative (any doubt → full reads):
 *  - document: no author selector that can split identical identities (structural position,
 *    sibling combinators, interaction/UA state, :has — styleShareSafe above), and no running
 *    animation/transition under the capture root (computed styles differ per frame). Decided
 *    once per capture in captureDOM → options.__styleShare.
 *  - element: never for form controls (UA styles their state without author CSS), never for
 *    the focused element (UA :focus-visible ring), never for shadow-root content (its sheets
 *    are outside the scan — universeFor already forces full reads there).
 *
 * The share map lives on the SESSION — one capture — so no cross-capture staleness is
 * possible; the per-element snapshotCache (cross-capture, stamp-guarded) sits in front
 * exactly as before.
 */
/* Which shared-snapshot props a twin must RE-READ, refined empirically on all three engines
 * (2026-09-01, twins with %-valued props under different-width parents):
 *  - ALWAYS: the geometry props whose getComputedStyle value is the USED value regardless of
 *    how they were authored — width/height, the box offsets (top/right/bottom/left and the
 *    inset-* logical longhands), transform-origin/perspective-origin.
 *  - NEVER: the min and max sizing longhands — their resolved value is the COMPUTED value ('10%' stays '10%',
 *    'auto' stays 'auto' on chromium, firefox AND webkit), and computed values are identical
 *    between identity twins by construction (same matched rules, same inherited inputs).
 *  - CONDITIONAL: the margin and padding longhands resolve %-values to used px, so they vary only when the
 *    document (or the identity's own inline style, identical across twins) actually gives
 *    the family an unstable value — styleScan flags marginUnstable/paddingUnstable. */
const LAYOUT_ALWAYS_RE = /^(width|height|top|right|bottom|left|transform-origin|perspective-origin)$|^inset-/
const UNSTABLE_INLINE_RE = /(margin|padding)[a-z-]*\s*:[^;]*(%|\bauto\b|calc\(|var\()/i
const SHARE_SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER', 'BUTTON', 'DATALIST'])

function shareStateOf(session) {
  let st = session.__styleShare
  if (!st) {
    st = session.__styleShare = { ids: new WeakMap(), intern: new Map(), snaps: new Map(), rootSeen: false }
  }
  return st
}

/** Interned identity id: parent's id + own tag + every attribute, order-normalized. */
function identityFor(el, st) {
  let id = st.ids.get(el)
  if (id !== undefined) return id
  const parent = el.parentElement
  // The walk is top-down, so the ONE node whose parent was never walked is the capture root
  // itself (its parent lives outside the capture, a context every node here shares — a
  // constant marker keeps chains comparable). Any LATER node with an unwalked parent is a
  // structure this walk does not understand: refuse to share under it.
  let pid
  if (!parent) {
    pid = 'R'
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

function getSnapshot(el, preStyle = null, options = {}, shareInfo = null) {
  const rec = snapshotCache.get(el)
  // The snapshot content depends on embedFonts (extra font props) and excludeStyleProps
  // (skipped props), which no invalidation signal tracks. Capturing the same element twice
  // with different options must not reuse the snapshot (#348). excludeStyleProps is compared
  // by reference: a fresh value misses safely.
  const ef = !!(options && options.embedFonts)
  const ex = (options && options.excludeStyleProps) || null
  if (rec && snapshotIsCurrent(rec, el) && rec.embedFonts === ef && rec.excludeStyleProps === ex) return rec.snapshot
  const style = preStyle || getComputedStyle(el)
  let snap
  let dyn = null
  const shared = shareInfo && shareInfo.st.snaps.get(shareInfo.id)
  if (shared) {
    // Identity hit: copy the shared full read, then re-read only the layout-varying props on
    // THIS node. The non-enumerable riders carry over: __bgClipTextFix derives from colors,
    // and __needsBgInline from the PRESENCE of url()/gradient/mask/border-image values —
    // all non-geometry computed values, identical between identity twins by construction
    // (same matched rules; animations disable the share). Recomputing the flag per twin was
    // 7 live reads a node for an answer the identity already holds.
    snap = { ...shared }
    // Direct loop over the identity's precomputed re-read list: the old form walked all
    // ~150 keys with a regex test per key, per twin (10.8ms of getSnapshot self-time on
    // the 500-row table, profiled). The values feed `dyn`, which composes this twin's
    // snapshotKeyCache signature from the identity's base signature below — styleSignature
    // re-hashed the whole snapshot per twin for another 11ms otherwise.
    const rrList = shared.__rrList
    dyn = []
    for (let i = 0; i < rrList.length; i++) {
      const p = rrList[i]
      const v = style.getPropertyValue(p)
      if (v) snap[p] = v
      else delete snap[p]
      dyn.push(v)
    }
    Object.defineProperty(snap, '__needsBgInline', { value: shared.__needsBgInline, enumerable: false })
    if (shared.__bgClipTextFix !== undefined) {
      Object.defineProperty(snap, '__bgClipTextFix', { value: shared.__bgClipTextFix, enumerable: false })
    }
  } else {
    snap = snapshotComputedStyleFull(style, options, el, universeFor(el))
    if (shareInfo) {
      // Store BEFORE stripHeightForWrappers: that pass mutates per-element (it judges this
      // node's own children), so siblings must start from the unstripped read. The spread
      // drops the non-enumerable riders; the hit path above restores them.
      const stored = { ...snap }
      if (snap.__bgClipTextFix !== undefined) {
        Object.defineProperty(stored, '__bgClipTextFix', { value: snap.__bgClipTextFix, enumerable: false })
      }
      Object.defineProperty(stored, '__needsBgInline', { value: snap.__needsBgInline, enumerable: false })
      // Per-identity re-read list, decided once here: the always-geometry props, plus the
      // margin/padding families only when the document-level scan or this identity's own
      // inline style (the style attribute is part of the identity key, so every twin
      // carries the same text) gives them an unstable value.
      const scan = scanFor(el.ownerDocument || document)
      const attr = (el.getAttribute && el.getAttribute('style')) || ''
      const inlineUnstable = attr && UNSTABLE_INLINE_RE.test(attr)
      const rrM = !!scan.marginUnstable || (inlineUnstable && /margin/i.test(attr))
      const rrP = !!scan.paddingUnstable || (inlineUnstable && /padding/i.test(attr))
      const rrList = []
      for (const k in stored) {
        if (LAYOUT_ALWAYS_RE.test(k) ||
            (rrM && k.charCodeAt(0) === 109 && k.startsWith('margin-')) ||
            (rrP && k.charCodeAt(0) === 112 && k.startsWith('padding-'))) rrList.push(k)
      }
      // Base signature over the props twins NEVER re-read, plus the re-read prop NAMES:
      // a twin's full signature is base + its own re-read VALUES (+ the strip outcome),
      // injective for the same reason the flat signature was — every name and value of the
      // final snapshot is represented exactly once.
      const rrSet = new Set(rrList)
      const staticParts = []
      for (const k in stored) { if (!rrSet.has(k)) staticParts.push(k, stored[k]) }
      Object.defineProperty(stored, '__rrList', { value: rrList, enumerable: false })
      Object.defineProperty(stored, '__baseSig', {
        value: staticParts.join('\u0001') + '\u0002' + rrList.join('\u0001'),
        enumerable: false,
      })
      shareInfo.st.snaps.set(shareInfo.id, stored)
    }
  }
  stripHeightForWrappers(el, style, snap)
  if (dyn !== null) {
    // Seed the signature memo AFTER the strip: it deletes at most height/block-size, and two
    // twins with different strip outcomes must not collide onto one key.
    __snapshotSig.set(snap, shared.__baseSig + '\u0002' + dyn.join('\u0001') +
      ('height' in snap ? '' : '\u0003') + ('block-size' in snap ? '' : '\u0004'))
  }
  snapshotCache.set(el, { env: __envEpoch, stamp: stampOf(el), snapshot: snap, embedFonts: ef, excludeStyleProps: ex })
  return snap
}

function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    // Amortize to one ctx allocation per capture: deepClone calls this per node with the
    // same sessionCache + options references.
    let ctx = sessionOrCtx.__ctx
    if (!ctx || sessionOrCtx.__ctxOpts !== opts) {
      ctx = {
        session: sessionOrCtx,
        persist: {
          snapshotKeyCache,
          defaultStyle: cache.defaultStyle,
          baseStyle: cache.baseStyle,
          image: cache.image,
          resource: cache.resource,
          background: cache.background,
          font: cache.font,
        },
        options: opts || {},
      }
      sessionOrCtx.__ctx = ctx
      sessionOrCtx.__ctxOpts = opts
    }
    return ctx
  }

  return {
    // Direct callers without a session get isolated throwaway maps — never the global.
    session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() },
    persist: {
      snapshotKeyCache,
      defaultStyle: cache.defaultStyle,
      baseStyle: cache.baseStyle,
      image: cache.image,
      resource: cache.resource,
      background: cache.background,
      font: cache.font,
    },
    options: (sessionOrCtx || opts || {}),
  }
}

/**
 * Replaces the clone's inline style with computed (cascade-resolved) values for each
 * property that was authored inline on the source. This ensures !important rules in
 * stylesheets correctly override inline styles in the clone (fixes #328).
 * @param {Element} source
 * @param {Element} clone
 * @param {CSSStyleDeclaration} computed
 */
const CONTEXT_DEPENDENT_VALUE_RE =
  /%|[\d.](?:em|rem|ex|ch|cap|ic|lh|rlh|v[whib]|vmin|vmax|cq[whbi]|cqmin|cqmax)\b|\b(?:calc|var|min|max|clamp|env|attr)\(|\b(?:auto|inherit|initial|unset|revert|currentcolor|-webkit-fill-available|fit-content|min-content|max-content)\b/i

const isTextField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
function normalizeInlineStyleToComputed(source, clone, computed) {
  if (!source.style || source.style.length === 0) return
  const important = importantPropsFor(source)
  const canSkip = important != null && !CONTEXT_DEPENDENT_VALUE_RE.test(source.getAttribute('style') || '')
  for (let i = 0; i < source.style.length; i++) {
    const prop = source.style[i]
    if (canSkip && !important.has(prop) && !(prop.startsWith('background') && isTextField(source))) continue
    const val = computed.getPropertyValue(prop)
    if (val) clone.style.setProperty(prop, val)
  }
}

export function inlineAllStyles(source, clone, sessionOrCtx, opts) {
  if (source.tagName === 'STYLE') return

  const ctx = _resolveCtx(sessionOrCtx, opts)
  // Normalized upstream to 'soft' | 'disabled'; 'soft' is the only non-disabled value.
  const resetMode = (ctx.options && ctx.options.cache) || 'soft'

  // The node's OWN document. Capturing inside a same-origin iframe wired the parent's
  // observers and watched a document the captured element does not live in.
  if (resetMode !== 'disabled') setupInvalidationOnce(source.ownerDocument)

  if (resetMode === 'disabled' && !ctx.session.__bumpedForDisabled) {
    bumpEpoch()
    snapshotKeyCache.clear()
    ctx.session.__bumpedForDisabled = true
  }

  const { session, persist } = ctx

  if (!session.styleCache.has(source)) {
    // ROB-1: getComputedStyle() on detached nodes can return an empty or unstable
    // CSSStyleDeclaration in some environments. Wrap defensively so a stale/detached
    // element never throws and callers always receive a usable style object.
    let computed = null
    try { computed = getComputedStyle(source) } catch { /* detached / cross-origin */ }
    session.styleCache.set(source, computed || getComputedStyle((source.ownerDocument || document).documentElement))
  }
  const pre = session.styleCache.get(source)

  // Replace authored inline style with computed values so !important in stylesheets
  // correctly overrides inline styles in the clone (fixes #328)
  if (source.getAttribute?.('style')) {
    normalizeInlineStyleToComputed(source, clone, pre)
  }

  // A static snapshot must not animate. The generated style class already filters animation
  // props (shouldIgnoreProp), but `animation` can still reach the SVG through the normalized
  // inline style above or through `<style>` tags cloned inside the captured subtree; when the
  // SVG is rasterized the animation replays from its 0% keyframe. An entry animation whose
  // start frame hides the element (e.g. `from { opacity: 0 }`, or an off-screen `transform`)
  // therefore blanks it out even though the live element already finished animating. Pin
  // `animation` off with inline `!important` on the elements that actually have one; the
  // current opacity/transform captured in the snapshot below then renders as the frozen,
  // already-settled frame.
  const animName = pre.getPropertyValue('animation-name')
  if (clone && clone.style && animName && animName !== 'none') {
    clone.style.setProperty('animation', 'none', 'important')
  }

  const tag = source.tagName?.toLowerCase() || 'div'
  // NO_DEFAULTS_TAGS (SVG shapes/containers, head stuff) never get a style class —
  // getStyleKey returns '' and the empty key is dropped at emit. Skip the full universe
  // snapshot + signature they'd pay for nothing; their paint survives via clone.js's
  // SVG_PAINT_PROPS pass. Only the bg/mask flag probe runs (CSS masks DO apply to SVG
  // graphics elements) so needsBackgroundInline stays accurate.
  if (NO_DEFAULTS_TAGS.has(tag)) {
    const stub = {}
    Object.defineProperty(stub, '__needsBgInline', { value: computeNeedsBgInline(pre), enumerable: false })
    snapshotCache.set(source, {
      env: __envEpoch, stamp: stampOf(source), snapshot: stub,
      embedFonts: !!(ctx.options && ctx.options.embedFonts),
      excludeStyleProps: (ctx.options && ctx.options.excludeStyleProps) || null,
    })
    session.styleMap.set(clone, '')
    return
  }

  let shareInfo = null
  if (ctx.options && ctx.options.__styleShare && session.styleMap) {
    const st = shareStateOf(session)
    const id = identityFor(source, st)
    const doc = source.ownerDocument || document
    const active = doc.activeElement
    const eligible = id !== -1 &&
      !SHARE_SKIP_TAGS.has(source.tagName) &&
      !(active && active !== doc.body && active !== doc.documentElement && active === source) &&
      (!source.getRootNode || source.getRootNode() === doc)
    if (eligible) shareInfo = { st, id }
  }
  const snap = getSnapshot(source, pre, ctx.options, shareInfo)

  // Firefox background-clip:text fallback (see applyBgClipTextFallback): the class carries the
  // substitute colour, but resolveCSSVars and the authored inline-style normalization re-inline
  // the live transparent colour and the gradient over any class. Inline !important outranks
  // them all.
  if (snap.__bgClipTextFix && clone && clone.style) {
    clone.style.setProperty('background-image', 'none', 'important')
    clone.style.setProperty('background-color', 'transparent', 'important')
    clone.style.setProperty('color', snap.__bgClipTextFix, 'important')
    clone.style.setProperty('-webkit-text-fill-color', snap.__bgClipTextFix, 'important')
  }

  const flexItem = isFlexOrGridItem(source)

  // #406: foreignObject may resolve min-width:auto differently than normal DOM
  // for flex/grid items. Explicitly set min-width:0 on flex/grid items that have
  // the default auto value, so the generated CSS class includes it and we don't
  // need a blanket foreignObject *{min-width:0} rule (which breaks inline-flex+gap).
  if (flexItem) {
    const mw = pre.getPropertyValue('min-width')
    if (!mw || mw === 'auto' || mw === '0px') {
      snap['min-width'] = '0px'
    }
  }

  // getStyleKey only softens width for inline-sized / table / inline boxes, and only there does
  // its output depend on content/flex-item-ness. For every other node (the vast majority — divs,
  // headings, paragraphs…) skip that bookkeeping entirely so the hot path stays untouched.
  let sig = styleSignature(snap)
  let sizedByContent = true
  if (softensWidth(tag, (snap.display || '').toLowerCase())) {
    sizedByContent = hasRenderedContent(source)
    // #484: softening only reproduces the box when its `width` is auto. On a blockified box in
    // normal flow (`span{display:block;width:16px}`) the min-width floor cannot cap the stretch,
    // and a flex/grid item gets no floor at all (#406) — both lost the authored width. Treat an
    // author-specified width as "not sized by content" so it is kept verbatim.
    if (sizedByContent && softenNeedsAutoWidth(tag, snap, flexItem) &&
        hasSpecifiedWidth(source, pre, flexItem)) {
      sizedByContent = false
    }
    // Fold tag/content/flex into the cache key so soften-eligible elements with identical styles
    // but different shape don't collide on the shared snapshotKeyCache.
    sig = `${sig}|${tag}${sizedByContent ? '|c' : ''}${flexItem ? '|f' : ''}`
    // This is the exact condition getStyleKey uses to actually drop the width (the #429/#433/
    // #434 family): tally it so capture.js can suggest `reconcile: true` when it's never used —
    // cheap, since softensWidth/sizedByContent are already computed for this node regardless.
    // Nowrap/pre boxes stay frozen (#474), so they carry no re-wrap risk.
    const wsMode = snap['text-wrap-mode'] || snap['white-space'] || ''
    if (sizedByContent && wsMode !== 'nowrap' && wsMode !== 'pre') {
      session.reconcileRisk = (session.reconcileRisk || 0) + 1
    }
  }
  let key = persist.snapshotKeyCache.get(sig)
  if (key === undefined) {
    key = getStyleKey(snap, tag, sizedByContent, flexItem)
    // Bound at INSERTION: evicting only on an epoch bump left the Map unbounded for as long
    // as the page's styles held still. Map iterates in insertion order, so this is FIFO.
    if (persist.snapshotKeyCache.size >= MAX_SNAPSHOT_KEY_CACHE) {
      persist.snapshotKeyCache.delete(persist.snapshotKeyCache.keys().next().value)
    }
    persist.snapshotKeyCache.set(sig, key)
  }
  session.styleMap.set(clone, key)
}
/**
 * Caja “visual”: bg/border/padding u overflow ≠ visible.
 * @param {CSSStyleDeclaration} cs
 */
function hasBox(cs) {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true
  if ((parseFloat(cs.borderTopWidth) || 0) > 0) return true
  if ((parseFloat(cs.borderBottomWidth) || 0) > 0) return true
  if ((parseFloat(cs.paddingTop) || 0) > 0) return true
  if ((parseFloat(cs.paddingBottom) || 0) > 0) return true
  const ob = cs.overflowBlock || cs.overflowY || 'visible'
  return ob !== 'visible'
}

/**
 * Flex/grid item (reads the parent's display, one getComputedStyle).
 * @param {Element} el
 */
function isFlexOrGridItem(el) {
  const p = el.parentElement
  if (!p) return false
  // getStyle memoizes in cache.computedStyle; raw getComputedStyle forced a fresh resolution
  // per node on every capture (even on snapshot-cache hits).
  const pd = getStyle(p).display || ''
  return pd.includes('flex') || pd.includes('grid')
}

/**
 * Is there in-flow content? Fast version:
 *  - A direct, non-empty text node -> true (triggers no layout).
 *  - An immediate <br> -> true.
 *  - Any in-flow element child -> true.
 *
 * Both questions are about THIS element's own flow, so neither `textContent` nor a
 * scrollHeight probe can answer them: `textContent` also sees text inside absolutely
 * positioned descendants, and scrollHeight is floored at clientHeight, so a wrapper whose
 * children are all out of flow still reports its own used height. Trusting either one made
 * stripHeightForWrappers drop the height of such a wrapper, which then collapsed to 0 inside
 * the foreignObject — every following section shifted up over it.
 * @param {Element} el
 */
function hasFlowFast(el) {
  // Only direct text nodes belong to this element's flow.
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true
  }
  const f = el.firstElementChild, l = el.lastElementChild
  if ((f && f.tagName === 'BR') || (l && l.tagName === 'BR')) return true

  // An element child contributes flow content only when it is itself in flow. getStyle
  // memoizes per node, and this runs only after the cheap text/<br> paths miss.
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const s = getStyle(c)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos !== 'absolute' && pos !== 'fixed') return true
  }
  return false
}

/**
 * Height this block would take with `height: auto`, measured from the live layout — or NaN
 * when nothing in flow could be measured.
 *
 * Only called once every other guard in stripHeightForWrappers has passed, so the element is
 * a plain block box with no vertical padding/border and `overflow: visible`: its content-box
 * top coincides with its border-box top, and the top/bottom margins of its first/last in-flow
 * children collapse straight through it. The auto height is therefore the distance from the
 * element's own top edge down to the lowest bottom edge among its in-flow contents.
 *
 * Out-of-flow (absolute/fixed) and floated children are skipped: neither contributes to the
 * auto height of a visible-overflow block. Direct text nodes are measured with a Range, which
 * reports real line boxes without touching the DOM.
 *
 * @param {Element} el
 * @returns {number}
 */
function autoContentHeight(el) {
  const top = el.getBoundingClientRect().top
  let bottom = -Infinity
  let range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      const r = range.getBoundingClientRect()
      if (r.width || r.height) bottom = Math.max(bottom, r.bottom)
      continue
    }
    if (n.nodeType !== 1) continue
    const s = getStyle(n)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos === 'absolute' || pos === 'fixed') continue
    if (s.float && s.float !== 'none') continue
    bottom = Math.max(bottom, n.getBoundingClientRect().bottom)
  }
  return bottom === -Infinity ? NaN : bottom - top
}

/**
 * Best-effort: drop height/block-size on transparent flow wrappers so margin collapsing
 * still works, without breaking KaTeX, Orbit, or layouts with an explicit height.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @param {Record<string, any>} snap
 */
function stripHeightForWrappers(el, cs, snap) {
  // 1) Respect an author inline height
  if (isHTMLEl(el) && el.style && el.style.height) return

  // 2) Solo div/section/article/main/aside/header/footer/nav (no ol/ul/li: layout de listas)
  const tag = el.tagName && el.tagName.toLowerCase()
  const ALLOWED_TAGS = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav']
  if (!tag || !ALLOWED_TAGS.includes(tag)) return

  // 2c) aspect-ratio define dimensiones derivadas; respetar
  if (cs.aspectRatio && cs.aspectRatio !== 'none' && cs.aspectRatio !== 'auto') return

  // 3) Orbit: leave the height alone when the element is a flex/grid container
  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid')) return

  // 4) Guardas existentes
  //
  // (The replaced-element guard lived here and was removed: it is unreachable.
  // The allow-list in (2) only admits div/section/article/main/aside/header/footer/nav,
  // and none of those can be an img/canvas/video/iframe/svg/object/embed: the check was
  // false by construction, not by luck.)

  const pos = cs.position
  if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return
  if (cs.transform !== 'none') return
  if (hasBox(cs)) return
  if (isFlexOrGridItem(el)) return

  // 5) Leave hiding / accessibility wrappers alone (KaTeX, screen-reader hacks, and so on)
  const overflowX = cs.overflowX || cs.overflow || 'visible'
  const overflowY = cs.overflowY || cs.overflow || 'visible'
  if (overflowX !== 'visible' || overflowY !== 'visible') return

  const clip = cs.clip
  if (clip && clip !== 'auto' && clip !== 'rect(auto, auto, auto, auto)') return

  if (cs.visibility === 'hidden' || cs.opacity === '0') return

  // 6) Solo wrappers "en flujo" realmente neutros
  if (!hasFlowFast(el)) return

  // 6b) Last filter: only drop the height when the used height is what the element would
  // have with `height: auto`. If it differs, the author set it, wherever it came from
  // (stylesheet, <style>, CSSOM, inline attribute), and it has to be respected.
  //
  // This check used to read `el.scrollHeight`, which CANNOT answer that question:
  // scrollHeight returns the padding-box height when the content is shorter than the box,
  // so a `height: 400px` around one line of text gives scrollHeight === 400 === used
  // height, a difference of 0, and the height was dropped. It only caught fixed heights
  // SMALLER than the content (the rare case), never the usual one: the child collapsed to
  // its content height and the rest of the canvas came out blank.
  //
  // Deliberately last: by this point we know there is no vertical padding/border and no
  // overflow (hasBox), which is what makes the autoContentHeight measurement valid, and
  // only the few nodes that clear every guard pay for measuring.
  const usedH = parseFloat(cs.height)
  const autoH = autoContentHeight(el)
  const TOL = 2
  if (Number.isFinite(usedH) && Number.isFinite(autoH) && Math.abs(usedH - autoH) > TOL) return

  // 7) Now drop height and block-size from the snapshot
  delete snap.height
  delete snap['block-size']
}
