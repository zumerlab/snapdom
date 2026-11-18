/**
 * Change sources: every way a cached read can go stale without the reader being told, who
 * sees it and what it moves. One observer stack per document, shared by the style snapshot
 * cache (styles.js), the memo (burst.js), the pseudo gates and the CSSVar memo.
 *
 * One sequence, `seq`, and versions cut from it: `epoch` is the last external mutation, `env`
 * the last change that restyles with no mutation on the node (head, fonts, resize), a node's
 * stamp the last change a selector can carry to it. A reader keeps `stampOf` and compares.
 * `seq` itself moving means some box may have moved, so used values are probed again. CSSOM
 * edits no observer sees go through `invalidateStyleCaches`. The document scan lives here
 * because its memo is keyed on the epochs and it decides how far a mutation is stamped
 * (`canNarrow`).
 *
 * Never imports styles.js: the caches read these versions, the versions know no cache.
 * @module changes
 */

import { shadowHost } from '../utils/index.js'
import { scanAuthorStyles, sheetCensus } from '../modules/styleScan.js'
import { isInternalNode, isSelfWrite } from '../utils/ownership.js'
import { snapFetch } from '../modules/snapFetch.js'

/** One sequence orders every change. Each version below is the value of `seq` at the last
 *  change of its kind, so a reader keeps one integer and compares it with the newest version
 *  among the sources it depends on (`stampOf`). */
export let seq = 0
/** `seq` at the last external change of any kind. */
export let epoch = 0
export function bumpEpoch() { epoch = ++seq }

/** Bumps the style epoch by hand. Nothing in src calls it; tests use it to force a re-snapshot. */
export function notifyStyleEpoch() { bumpEpoch() }

/** Mutations on snapdom-owned helper nodes (sandbox, measure wrapper, warmup img, injected font
 *  links, …) must NOT move the style epoch: every capture creates and removes them, so each
 *  capture would poison the snapshot cache for the next (gif/video export paid a full
 *  re-snapshot every time). */
export function isOwnedNode(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement)
  while (el) {
    if (isInternalNode(el)) return true
    if (el.parentElement) el = el.parentElement
    else el = shadowHost(el)
  }
  return false
}
/**
 * Whether any record in a batch comes from outside snapdom's own helper nodes.
 * @param {MutationRecord[]} records
 * @returns {boolean}
 */
export function hasExternalMutation(records) {
  for (const rec of records) {
    if (isExternalRecord(rec)) return true
  }
  return false
}

/** Per-record form of the same filter: burst's differential dirty-tracking attributes each
 *  external record to its subtree.
 *  @param {MutationRecord} rec
 *  @returns {boolean} */
export function isExternalRecord(rec) {
  if (isOwnedNode(rec.target)) return false
  // snapdom's own edit of a page node, or its undo (ownership.js), is not the page's: counted
  // as one, a 300-node page took 12,839 computed reads for 889 and was never served. The
  // sequence still moves, so used values beside the forced box are probed.
  // Pinned by __tests__/core.changes.selfWrites.test.js.
  if (rec.type === 'characterData' ? isSelfWrite(rec.target, rec.target.data)
    : rec.attributeName === 'style' && isSelfWrite(rec.target, rec.target.style.cssText)) {
    seq++
    return false
  }
  if (rec.type === 'childList') {
    let allOwned = true
    for (const n of rec.addedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
    if (allOwned) for (const n of rec.removedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
    if (allOwned) return false
  }
  return true
}

/** Count mutation sources separately from selector reach. Document minus subtree counts
 *  tells burst whether a local edit coincided with outside work that diff cannot replay.
 *  Takes external records only: the observer callbacks classify each record once. */
const mutationCounts = new WeakMap()
function countMutationSources(records) {
  for (const rec of records) {
    const doc = rec.target.ownerDocument || document
    mutationCounts.set(doc, (mutationCounts.get(doc) || 0) + 1)
    let el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement || rec.target.host
    for (; el; el = el.parentElement || shadowHost(el)) {
      mutationCounts.set(el, (mutationCounts.get(el) || 0) + 1)
    }
  }
}

/** Count observed mutations outside this subtree, including open shadow trees in its document.
 *  Call after flushStyleInvalidations. Pinned by __tests__/core.burst.environment.test.js.
 *  @param {Element} element
 *  @returns {number} */
export function getOutsideMutationCount(element) {
  const doc = element.ownerDocument || document
  setupInvalidationOnce(doc)
  return (mutationCounts.get(doc) || 0) - (mutationCounts.get(element) || 0)
}

/** There is no separate rule epoch, on purpose: three rule sources emit no record
 *  (adoptedStyleSheets, a <link> finishing its load, insertRule), and covering them took a
 *  census of every sheet on EVERY capture, which timed WebKit out under BROWSER=all. The epoch
 *  stays the trigger; on a miss scanFor keeps the last scan while sheetCensus matches.
 *  Pinned by __tests__/module.styles.ruleEpoch.test.js. */

/** Style-ENVIRONMENT epoch: bumps only on <head> mutations and font loads, the events that
 *  restyle any element without touching it. Consumers (burst) poll getStyleEnvEpoch() instead
 *  of wiring their own listeners: one shared stack, and polling roots nothing (a subscriber
 *  callback would leak its closure). */
export let env = 0
function bumpEnv() { epoch = env = ++seq }
export function getStyleEnvEpoch(doc = document) {
  setupInvalidationOnce(doc)
  return env
}

/** Current style epoch, bumped on any external DOM, head or font mutation. Scopes the memos
 *  (e.g. isInSvgTemplate) that DOM restructuring must invalidate. */
export function getStyleEpoch() {
  setupInvalidationOnce()
  return epoch
}

/** The scoped stamp used by the style snapshot cache. Burst reads the capture root's stamp
 *  after flushing MutationObservers: an outside sibling/ancestor mutation can restyle the
 *  root through combinators, :has(), inheritance or a container query without producing a
 *  record inside the captured subtree. The stamp already models that selector reach. */
export function getStyleStamp(element) {
  if (!element) return 0
  setupInvalidationOnce(element.ownerDocument || document)
  return stampOf(element, shadowHostsOf(element))
}

/** The user's escape hatch (`invalidate: true`), and the ONLY answer to style changes no
 *  observer sees: `sheet.insertRule()`, `rule.style.x = …`. Those move no epoch, so every
 *  epoch-scoped memo (property universe, style snapshots, CSSVar, pseudo gates) keeps the old
 *  CSS, even with `burst: false`, because the memos live below burst. Bumps BOTH epochs. */
export function invalidateStyleCaches() {
  bumpEnv()
}

/** Per-node style stamps: how far a DOM mutation reaches, so an unrelated re-render does not
 *  cost a cold snapshot pass (73-node card: 1.6ms became 5.7ms). Necessary, not sufficient:
 *  layout reaches nodes no selector does (a footer pinned with `bottom: 0` kept its old `top`
 *  on every engine since 3.0.0), so once any stamp moved getSnapshot re-checks used values
 *  (usedValuesHold). Pinned by __tests__/module.styles.usedValues.test.js. */
const nodeStamp = new WeakMap()
/** Moves the sequence for a change no stamp names (an animation, a resource load): cached
 *  used values are probed again. */
export function bumpSeq() { seq++ }
/** Bumped instead of the stamps when narrowing is unsound (a `:has()` document): invalidates
 *  every snapshot at once. */
let allStamp = 0
function stampAll() { allStamp = ++seq }

export function stampNode(el) { nodeStamp.set(el, ++seq) }

export function stampSubtree(root) {
  if (!root || root.nodeType !== 1) return
  const v = ++seq
  nodeStamp.set(root, v)
  const all = root.querySelectorAll('*')
  for (let i = 0; i < all.length; i++) nodeStamp.set(all[i], v)
}

/** Stamp what a change at `el` can restyle: its parent's subtree (descendants, inheritance,
 *  siblings) and each ancestor (`:has()` reaching up). `:has()` reaching SIDEWAYS
 *  (`.a:has(.b) ~ .c`) escapes this, so a `:has()` document never narrows (canNarrow). */
function invalidateAround(el) {
  stampSubtree(el.parentElement || el)
  for (let p = el.parentElement; p; p = p.parentElement) stampNode(p)
}

/** The stamp a node's cached snapshot was taken at. */
export function stampOf(el, hosts = null) {
  let stamp = Math.max(env, allStamp, nodeStamp.get(el) || 0)
  if (hosts) for (const host of hosts) stamp = Math.max(stamp, nodeStamp.get(host) || 0)
  return stamp
}

/** Shadow styles inherit through their hosts. Keep that dependency on the snapshot so a
 *  warm light-DOM read stays one WeakMap lookup, without walking shadow trees on mutations.
 *  A move/slot redistribution stamps the host or node and rebuilds this list on the miss. */
export function shadowHostsOf(el) {
  let root = el.getRootNode?.()
  if (!root?.host) return null
  const hosts = []
  while (root?.host) {
    // Capturing a child directly never walks its enclosing host in deepClone. Wire that
    // open root here too, or its internal mutations would have no observer at all.
    if (root.mode === 'open') observeShadowRoot(root)
    hosts.push(root.host)
    root = root.host.getRootNode?.()
  }
  return hosts
}

/** Whether narrowing is sound for this document: no author rule uses `:has()`. Memoized on
 *  env, NOT epoch: onDomRecords bumps epoch right before asking, so an epoch memo made every
 *  host-page mutation (a React commit) pay a full scanAuthorStyles with no capture in flight.
 *  A <style>/<link> outside <head> moves no env, so onDomRecords drops this entry for it. */
const hasMemo = new WeakMap()
function canNarrow(doc) {
  doc = doc || document
  let h = hasMemo.get(doc)
  if (!h || h.env !== env) {
    let usesHas = true
    try { usesHas = scanFor(doc).usesHas } catch { /* unreadable sheets: stay pessimistic */ }
    h = { env, usesHas }
    hasMemo.set(doc, h)
  }
  return !h.usesHas
}

/** A <style>/<link> mounted, removed or rewritten OUTSIDE <head>: the head observer never
 *  sees it, so env stays and canNarrow would answer from before those rules existed, leaving
 *  narrowing on past a new `:has()` rule. A cheap tag test; it only has to be conservative. */
function ruleSourceDoc(records) {
  const containsRuleSource = (node) => node?.nodeType === 1 &&
    (node.matches?.('style,link') || node.querySelector?.('style,link'))
  for (const rec of records) {
    const t = rec.target
    const el = t && (t.nodeType === 1 ? t : t.parentElement)
    if (el && (el.tagName === 'STYLE' || el.tagName === 'LINK')) return el.ownerDocument || document
    for (const n of rec.addedNodes) if (containsRuleSource(n)) return n.ownerDocument || document
    for (const n of rec.removedNodes) if (containsRuleSource(n)) return n.ownerDocument || (t && t.ownerDocument) || document
  }
  return null
}

/** Open shadow roots, wired into the same invalidation: neither the document observer nor
 *  querySelectorAll crosses a shadow boundary. A stale shadow snapshot keeps old colours too:
 *  rewriteShadowCSS emits rules at specificity zero, so the stale class OUTRANKS the
 *  re-injected sheet (verified in pixels). Not in __observers: that prune keys on defaultView,
 *  which a ShadowRoot lacks, so it would disconnect these on the first flush. */
const shadowObserved = new WeakSet()
const __shadowObservers = []

function onShadowRecords(records) {
  const external = records.filter(isExternalRecord)
  if (!external.length) return
  countMutationSources(external)
  bumpEpoch()
  const stamped = new Set()
  for (const rec of external) {
    const root = rec.target.getRootNode && rec.target.getRootNode()
    if (!root || root.nodeType !== 11 || stamped.has(root)) continue
    stamped.add(root)
    // The host's light subtree too: ::slotted and inheritance through slots restyle it.
    if (root.host) stampSubtree(root.host)
    else seq++
    const all = root.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) nodeStamp.set(all[i], seq)
  }
}

/** Called from deepClone for every open root it walks, inside its `node.shadowRoot` branch,
 *  so nodes without one pay nothing. Closed roots stay unobservable by design. */
export function observeShadowRoot(root) {
  if (!root || shadowObserved.has(root)) return
  shadowObserved.add(root)
  try {
    const o = new MutationObserver(onShadowRecords)
    o.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
    __shadowObservers.push({ o, root })
  } catch { /* degrade: this root's changes will not invalidate */ }
}

/**
 * Add the animations inside the open shadow roots under `element` to `animations`:
 * `getAnimations({ subtree: true })` stops at a shadow boundary on all three engines. Only
 * roots a capture walked are asked (3,000 of them cost 0.5 ms a call in Chromium).
 * Pinned by `__tests__/core.capture.animationFrames.test.js`.
 * @param {Element} element - the capture root
 * @param {Set<Animation>} animations - collects them
 */
export function addShadowAnimations(element, animations) {
  for (const { root } of __shadowObservers) {
    let host = root.host
    while (host && host !== element && !element.contains(host)) host = host.getRootNode().host
    if (host) for (const a of root.getAnimations?.() || []) animations.add(a)
  }
}

/** The DOM observer's callback, also replayed by flushStyleInvalidations on drained records:
 *  one pass answers both "did anything paintable change" and "did the author rules change". */
function onDomRecords(records) {
  // Classified once: the test walks every ancestor of the target, on every mutation the page
  // makes for as long as the observer lives.
  const external = records.filter(isExternalRecord)
  if (!external.length) return
  countMutationSources(external)
  bumpEpoch()
  // Every record, not only the external ones: an owned <link> still changes the rules.
  const ruleDoc = ruleSourceDoc(records)
  if (ruleDoc) {
    hasMemo.delete(ruleDoc)
    // A stylesheet node may live in <body>; its CSS still reaches the entire document.
    // Local stamping at the node's parent would leave distant captures on old snapshots.
    bumpEnv()
    return
  }
  // The epoch above invalidates the memos keyed on DOM structure (isInSvgTemplate, CSSVar,
  // burst's out-of-subtree gate); only the snapshot cache reads stamps. Stamping is deduped by
  // the subtree root it walks: a re-render emits many records against one parent, and each
  // would run its own querySelectorAll('*') over the same neighbourhood.
  const stamped = new Set()
  for (const rec of external) {
    const el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement
    if (!el) continue
    const doc = el.ownerDocument || document
    if (!canNarrow(doc)) { stampAll(); return }
    // A class or custom-property flip on <html> or <body> reaches the whole document, which
    // is what the all-stamp is for.
    if (el === doc.documentElement || el === doc.body) { stampAll(); return }
    const root = el.parentElement || el
    if (stamped.has(root)) continue
    stamped.add(root)
    invalidateAround(el)
  }
}

/** Wired PER DOCUMENT: a same-origin <iframe> has its own observers, listeners and
 *  FontFaceSet, and with only the top one wired a rule edited inside the frame never reached
 *  the next capture. The epoch stays SHARED: a cross-document bump costs a rescan, an
 *  over-invalidation nobody can measure, against per-document epochs in every consumer. */
const __wiredDocs = new WeakSet()
/** Hot-path memo. `inlineAllStyles` calls setupInvalidationOnce once PER NODE, and a WeakSet
 *  lookup per node pushed two WebKit tests past their 15s budget under `BROWSER=all`. Nodes
 *  come in document order, so comparing with the last document answers almost every call and
 *  the WeakSet is read once per iframe. */
let __lastWiredDoc = null
/** Every observer wired, in any document; `head` ones also bump env. Entries carry their
 *  document so flushStyleInvalidations, which walks them on EVERY capture, drops removed
 *  iframes: kept, they grew into a per-capture census, the cost that timed WebKit out. */
const __observers = []
export function setupInvalidationOnce(doc = document) {
  if (doc === __lastWiredDoc) return
  if (!doc || doc.nodeType !== 9) return
  if (__wiredDocs.has(doc)) { __lastWiredDoc = doc; return }
  __wiredDocs.add(doc)
  __lastWiredDoc = doc
  const view = doc.defaultView
  const onEnvRecords = (records) => {
    if (hasExternalMutation(records)) {
      bumpEnv()
    }
  }
  const onFonts = bumpEnv
  try {
    const o = new MutationObserver(onDomRecords)
    o.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
    __observers.push({ o, head: false, doc })
  } catch { }
  try {
    const o = new MutationObserver(onEnvRecords)
    o.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true })
    __observers.push({ o, head: true, doc })
  } catch { }
  try {
    // Viewport resizes flip media queries: computed styles change with no DOM mutation.
    view?.addEventListener('resize', onFonts, { passive: true })
  } catch { }
  try {
    // Interaction pseudo-classes (:focus, :checked, :disabled) restyle with no record, and the
    // snapshot cache reads stamps, so each event stamps too. focusin/out bubble, focus/blur do
    // not. :hover is NOT wired: pointer events would flush the snapshot cache on every move.
    const onInteraction = (event) => {
      bumpEpoch()
      // Document listeners see a shadow event retargeted to its host. The first composed
      // path entry is the real control whose :focus/:active state can restyle shadow siblings.
      const t = event.composedPath?.()[0] || event.target
      if (t && t.nodeType === 1 && !isOwnedNode(t)) {
        if (canNarrow(t.ownerDocument || doc)) invalidateAround(t)
        else stampAll()
      } else {
        stampAll()
      }
    }
    doc.addEventListener('focusin', onInteraction, { capture: true, passive: true })
    doc.addEventListener('focusout', onInteraction, { capture: true, passive: true })
    doc.addEventListener('change', onInteraction, { capture: true, passive: true })
    // :active is already true while pointerdown/keydown dispatches and false again on the
    // matching release. Capturing either edge before a later task must not reuse the other.
    doc.addEventListener('pointerdown', onInteraction, { capture: true, passive: true })
    doc.addEventListener('pointerup', onInteraction, { capture: true, passive: true })
    doc.addEventListener('pointercancel', onInteraction, { capture: true, passive: true })
    doc.addEventListener('keydown', onInteraction, { capture: true, passive: true })
    doc.addEventListener('keyup', onInteraction, { capture: true, passive: true })
    // Native top-layer state (`showPopover`) is a property, not an authored attribute.
    doc.addEventListener('beforetoggle', onInteraction, { capture: true, passive: true })
    doc.addEventListener('toggle', onInteraction, { capture: true, passive: true })
    view?.addEventListener('hashchange', () => { bumpEpoch(); stampAll() }, { passive: true })
    // An image that finishes loading resizes the boxes around it with no record: a lazy one
    // loads when it scrolls into view, which is no record either. Not snapdom's own nodes:
    // WebKit's paint probe (toCanvas) is an <img> in the document on every export, and the
    // clock would never rest.
    doc.addEventListener('load', (event) => { if (!isOwnedNode(event.target)) seq++ }, { capture: true, passive: true })
  } catch { }
  try {
    const f = doc.fonts
    if (f) {
      f.addEventListener?.('loadingdone', onFonts)
      // Only while the set is still loading. On a settled set `ready` resolves at once, and that
      // bump with nothing changed sent the NEXT capture of anything down the full pipeline (a
      // seeded element with a nested iframe was never served its seed). Pinned by
      // __tests__/core.burst.nestedIframe.test.js.
      if (f.status === 'loading') f.ready?.then(onFonts).catch(() => { })
    }
  } catch { }
}

/** The `:hover` chain each document/shadow root had at its last capture. */
const __lastHover = new WeakMap()

function invalidateHoverScope(scope, doc) {
  if (!scope?.querySelectorAll) return
  let now
  try { now = Array.from(scope.querySelectorAll(':hover')) } catch { return }
  const prev = __lastHover.get(scope) || []
  if (prev.length === now.length && prev.every((n, i) => n === now[i])) return
  __lastHover.set(scope, now)
  bumpEpoch()
  if (scope.nodeType === 11) {
    // Shadow selectors cannot escape this tree except through :host/::slotted. Stamp the
    // whole root and host; this also reaches a capture whose root itself lives in shadow DOM.
    if (scope.host) stampSubtree(scope.host)
    else seq++
    for (const el of scope.querySelectorAll('*')) nodeStamp.set(el, seq)
    return
  }
  const changed = prev.filter((n) => !now.includes(n)).concat(now.filter((n) => !prev.includes(n)))
  for (const el of changed) {
    if (!el.isConnected) continue
    if (canNarrow(doc)) invalidateAround(el)
    else { stampAll(); return }
  }
}

/** Stamp what `:hover` restyled since the last capture. Hover produces no mutation record and
 * is deliberately sampled instead of wiring pointer movement. Passing roots keeps burst hits
 * scoped; full captures also inspect every connected shadow root already observed by snapdom.
 * @param {Document} doc
 * @param {ShadowRoot[]|null} [roots]
 */
export function invalidateHoverChanges(doc, roots = null) {
  if (!doc) return
  invalidateHoverScope(doc, doc)
  const scopes = roots || __shadowObservers
    .filter(({ root }) => root.host?.isConnected)
    .map(({ root }) => root)
  for (const root of scopes) invalidateHoverScope(root, doc)
}

/** Synchronously drains pending records. MutationObserver delivers in a microtask, so a
 *  <style> injected in the same tick as a capture would be read against the stale epoch and
 *  the scanned universe and pseudo gates would miss its rules. Called once per capture (from
 *  the root call of the pseudo pass). */
export function flushStyleInvalidations() {
  setupInvalidationOnce()
  try {
    for (let i = __observers.length - 1; i >= 0; i--) {
      const { o, head, doc } = __observers[i]
      // A detached document (an <iframe> removed from the page) has a null defaultView and
      // never paints again: drop it rather than pay for it on every capture.
      if (doc !== document && !doc.defaultView) {
        try { o.disconnect() } catch { }
        __wiredDocs.delete(doc)
        if (__lastWiredDoc === doc) __lastWiredDoc = null
        __observers.splice(i, 1)
        continue
      }
      const r = o.takeRecords()
      if (!r.length) continue
      if (head) { if (hasExternalMutation(r)) bumpEnv() }
      else onDomRecords(r)
    }
    for (let i = __shadowObservers.length - 1; i >= 0; i--) {
      const { o, root } = __shadowObservers[i]
      if (!root.host || !root.host.isConnected) {
        try { o.disconnect() } catch { }
        // So a re-attached host is re-armed.
        shadowObserved.delete(root)
        __shadowObservers.splice(i, 1)
        continue
      }
      const r = o.takeRecords()
      if (r.length) onShadowRecords(r)
    }
  } catch { }
}

/** Per-document memo of the scanned property universe, keyed on epoch and kept across an
 *  epoch miss while the sheet census and the env epoch stand (see the rule-epoch note above
 *  getStyleEnvEpoch). A capture reads it through scanOf, never directly. */
const universeCache = new WeakMap()
/** href to the rules of a parsed copy, or null while it loads or when it cannot be read. */
const crossOriginCopies = new Map()

/** Read a cross-origin sheet through a fetched copy, which lands later and bumps both epochs.
 *  One unreadable sheet (a Google Fonts <link>) turns off the universe, the pseudo gates, the
 *  share and stamp narrowing, so a ticking counter re-captured every memo. A copy with @import
 *  stays unreliable: replaceSync drops those rules.
 *  Pinned by __tests__/module.styles.crossOriginScan.test.js.
 *  @param {CSSStyleSheet} sheet
 *  @returns {CSSRuleList|null} */
function crossOriginRules(sheet) {
  const href = sheet.href
  if (!href || typeof CSSStyleSheet !== 'function') return null
  if (crossOriginCopies.has(href)) return crossOriginCopies.get(href)
  crossOriginCopies.set(href, null)
  snapFetch(href, { as: 'text' }).then((res) => {
    if (!res.ok || typeof res.data !== 'string' || /@import/i.test(res.data)) return
    const copy = new CSSStyleSheet()
    copy.replaceSync(res.data)
    crossOriginCopies.set(href, copy.cssRules)
    bumpEnv()
  }).catch(() => { })
  return null
}

/**
 * Rules a scan may read per element captured so far in its document. The scan costs by the
 * rule and saves by the element it prunes, so a document is scanned once its captures can pay
 * for it; until then every reader gets the conservative answers of an unreadable sheet.
 * First capture, Chromium, one element / 401 elements beside a linked sheet (ms):
 * 600 rules 31.2 -> 17.4 / 47.8 -> 47.0, 3,000 rules 57.6 -> 19.5 / 68.9 -> 69.7,
 * 10,000 rules 115.9 -> 25.3 / 127.1 -> 114.9. Every ratio from 8 to 24 picks the faster
 * side in the twelve cells measured.
 * The cost falls on recaptures of a page that changes: the differential path needs the scan
 * (diff.js), so until it runs each one is a full capture. 21 elements beside 3,000 rules,
 * one edit per capture: 8.5 ms each against 2, the scan on the ninth, 24 captures 166.6 ms
 * against 123.7. An unchanged page is a memo hit, counts nothing and is never scanned.
 * Pinned by __tests__/module.styles.scanBudget.test.js.
 */
const SCAN_RULES_PER_ELEMENT = 12
/** What a capture pays without the scan before its first element, in elements: recapturing
 *  one element beside 600 rules cost 2.3 ms against 1.4, and counted as one element it took
 *  fifty captures to reach the scan. */
const CAPTURE_BASE = 10
/** Elements captured so far, per document. */
const captured = new WeakMap()

/**
 * Count a capture's elements toward the scan of its document, and drop a declined scan they
 * now afford. No epoch moves: a snapshot read without a universe holds every property a
 * pruned one would, so the next scan serves it as it is.
 * @param {Document} doc
 * @param {number} elements
 */
export function noteCaptured(doc, elements) {
  const total = (captured.get(doc) || 0) + elements + CAPTURE_BASE
  captured.set(doc, total)
  if (universeCache.get(doc)?.declined <= total * SCAN_RULES_PER_ELEMENT) {
    universeCache.delete(doc)
    hasMemo.delete(doc)
  }
}

export function scanFor(doc) {
  let rec = universeCache.get(doc)
  if (!rec || rec.epoch !== epoch) {
    // The epoch moves on any DOM mutation, and most touch no stylesheet. While env stands (no
    // <style>/<link> node changed, no `invalidate`) an equal census is an equal scan. The CSSOM
    // edits the census cannot see (sheetCensus lists them) need `invalidate: true`.
    const census = sheetCensus(doc, crossOriginRules)
    if (rec && census && rec.env === env && rec.census &&
        rec.census.length === census.length && census.every((v, i) => v === rec.census[i])) {
      rec.epoch = epoch
      return rec
    }
    const prev = rec && rec.universe
    rec = { epoch, env, census, ...scanAuthorStyles(doc, crossOriginRules, (captured.get(doc) || 0) * SCAN_RULES_PER_ELEMENT) }
    // A re-scan that finds the same props keeps the previous Set: its identity keys the base
    // reset memo (assembleCaptureCSS) and any DOM mutation bumps the epoch, so a new Set per
    // scan would rebuild the reset (0.12-0.65 ms) on every capture of a live page.
    const next = rec.universe
    if (prev && next && prev.size === next.size) {
      let same = true
      for (const p of next) if (!prev.has(p)) { same = false; break }
      if (same) rec.universe = prev
    }
    universeCache.set(doc, rec)
  }
  return rec
}

/** The document scan one capture reads, pinned on its clone session: the base reset and the
 *  snapshots must be pruned by the same universe, or the reset overrides a class value or
 *  misses one that is then inherited (#554), and a Google Fonts copy (crossOriginRules) can
 *  land mid-capture. Pinned by __tests__/regression.resetUniverse.test.js.
 *  @param {Document} doc
 *  @param {object|null} [session] - the capture's sessionCache; none reads the current scan */
export function scanOf(doc, session) {
  if (!session) return scanFor(doc)
  if (!session.scan) {
    session.scan = scanFor(doc)
    // getSnapshot stores it: a snapshot read under a pin the page moved past is stale next time.
    session.scanEnv = env
  }
  return session.scan
}
