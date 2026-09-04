/**
 * Burst memoization: a scoped MutationObserver plus caching of the last result per
 * element, so repeated captures of an unchanged subtree return instantly (dashboard polling,
 * video/gif frame loops with static frames). Auto-engages on repeated captures; mutated
 * subtrees rebuild via the differential path (diff.js).
 *
 * INVALIDATION MATRIX — every way a rendered frame can change, and who observes it
 * (ARCHITECTURE.md carries the prose version; THIS list is the wiring's source of truth):
 *  - DOM mutations ......... scoped MutationObserver (+ takeRecords flush pre-serve), below
 *  - <video> frames ........ timeupdate/seeked listeners, trackVideos
 *  - <img> loads ........... load/error listeners on pending images, trackPendingImages
 *  - font loads ............ style-environment epoch (styles.js getStyleEnvEpoch)
 *  - scroll ................ capture-phase scroll listener per element (no records exist),
 *                            PLUS one per open shadow root: scroll is composed:false, so it
 *                            stops at the boundary and never reaches the host
 *  - form-control state .... capture-phase input/change listeners (value/checked are
 *                            properties, not attributes — no records exist). `change` is
 *                            composed:false too, hence the per-shadow-root listener
 *  - ancestor state ........ ancestorSig compared when the global style epoch bumps
 *                            (theme/locale/custom-property changes ABOVE the element)
 *  - window resize ......... env epoch (media queries flip with no mutation)
 *  - <head> CSS ............ env epoch (head observer)
 *  - same-tick <style> ..... flushStyleInvalidations at capture start (records are async)
 *  - CSS/WAAPI animations .. getAnimations({subtree}) per capture: memo never serves nor
 *                            persists while running; targeted subtrees become dirty roots
 *                            for the diff path with invalidateSnapshotsUnder per frame
 *  - mid-capture edits ..... records that land WHILE a capture runs are buffered and judged
 *                            once it ends (hasTornMutation): a net change that is not the
 *                            pipeline's own self-undoing work leaves the element dirty, so a
 *                            torn frame is never memoized
 *  - mid-capture EVENTS .... the record-less sources above (scroll/input/change/focus/video)
 *                            set `state.torn` instead of being dropped. There is nothing to
 *                            judge afterwards — no target, no oldValue — and nothing to
 *                            judge: the pipeline never types, scrolls or moves focus inside
 *                            the captured subtree, so any of these is external by
 *                            construction and the frame is torn
 *  - shadow DOM ............ one observer per open root, plus the composed:false listeners
 *                            and the <video>/<img> trackers (querySelectorAll does not cross
 *                            the boundary either), rescanned per capture so a root attached
 *                            after the memo is also caught (trackShadowRoots).
 *                            Costs one subtree walk per capture: ~1ms at 8k nodes, against
 *                            a memo that replaces a ~100ms pipeline. Closed roots cannot
 *                            be observed by anyone → `invalidate: true` territory.
 *  - canvas pixel draws .... EXCLUDED (invisible to every observer) → `invalidate: true`
 *  - CSSOM rule edits ...... EXCLUDED (insertRule/rule.style.*) → `invalidate: true`
 *  - impure render plugins . suspend auto memo/diff (plugins.js hasImpureRenderPlugins)
 *
 * State lives in a WeakMap keyed by element — no separate handle/dispose: once the element is
 * unreachable, its entry (and the MutationObserver instances closed over it) become
 * GC-eligible on their own.
 * @module burst
 */

import { isExternalRecord, getStyleEnvEpoch, getStyleEpoch, invalidateSnapshotsUnder } from '../modules/styles.js'
import { tryDiffCapture } from './diff.js'

/** Per-element burst state, built by createState. Weak: the element's death frees it. */
const burstStates = new WeakMap()

/**
 * Memoization engages on an element's FIRST capture (api/snapdom.js): there is no threshold
 * to trip, because an unchanged element is served and a changed one is invalidated or
 * rebuilt through the diff path either way (there used to be one, three captures in two
 * seconds, decided 2026-09-04 to go). What the threshold was really guarding is guarded
 * here instead: how many elements keep a live memo at once. Past the cap the least recently
 * served memo is torn down (disposeState); its element captures fresh next time and
 * re-enters at the back. Pinned by __tests__/core.burst.firstCapture.test.js.
 */
const MAX_LIVE_MEMOS = 64
/** Elements with a live memo, oldest first. A Map keeps insertion order; re-insert to bump. */
const liveMemos = new Map()

/** The element's listeners on itself (createState), all capture-phase. */
const ELEMENT_EVENTS = ['scroll', 'input', 'change', 'focusin', 'focusout']

function touchMemo(element, state) {
  liveMemos.delete(element)
  liveMemos.set(element, state)
  if (liveMemos.size <= MAX_LIVE_MEMOS) return
  const [oldest, oldState] = liveMemos.entries().next().value
  disposeState(oldest, oldState)
}

/** Tear a state down: observers, listeners and the memo go; the element captures fresh. */
function disposeState(element, state) {
  liveMemos.delete(element)
  burstStates.delete(element)
  for (const o of state.observers) { try { o.disconnect() } catch { /* gone */ } }
  for (const type of ELEMENT_EVENTS) element.removeEventListener(type, state.onMediaDirty, true)
  for (const root of state.trackedShadowRoots.keys()) {
    for (const type of SHADOW_LOCAL_EVENTS) root.removeEventListener(type, state.onMediaDirty, true)
  }
  for (const v of state.trackedVideos) {
    v.removeEventListener('timeupdate', state.onMediaDirty)
    v.removeEventListener('seeked', state.onMediaDirty)
  }
  state.last = null
  state.retained = null
}

/**
 * The `:hover` chain as far as it can restyle this element: the hovered nodes that are the
 * element itself, its ancestors or its descendants. `:hover` produces no mutation record and
 * is deliberately not wired as an event (pointer events fire continuously), so it was the one
 * interaction state a memo served stale: capture with the pointer on a button inside the
 * element, move away, capture again, and the memo answered with the hover styles. Compared
 * on every serve. A hovered sibling elsewhere on the page is filtered out, so the price is
 * one :hover query, not a recapture.
 * @param {Element} element
 * @returns {Element[]}
 */
function hoverChain(element) {
  const out = []
  try {
    const doc = element.ownerDocument || document
    for (const n of doc.querySelectorAll(':hover')) {
      if (n.contains(element) || element.contains(n)) out.push(n)
    }
  } catch { /* :hover unsupported here */ }
  return out
}
const sameChain = (a, b) => a.length === b.length && a.every((n, i) => n === b[i])

/** querySelector stops at a shadow boundary, so a charting web component hid its <canvas>
 *  from the exclusion in api/snapdom.js and the memo served stale frames to exactly the
 *  pollers that exclusion exists to protect: canvas pixel draws are invisible to every
 *  observer. */
export function hasCanvas(element) {
  if (!element.querySelectorAll) return false
  if (element.querySelector('canvas')) return true
  for (const el of element.querySelectorAll('*')) {
    if (el.shadowRoot && (el.shadowRoot.querySelector('canvas') || hasCanvas(el.shadowRoot))) return true
  }
  return false
}

/** Attribute signature of the ancestor chain. A theme toggle, a locale switch or a custom
 *  property written on <html> changes what the subtree renders without producing a single
 *  mutation record INSIDE it, so the scoped observer cannot see any of them. Only computed
 *  when the global style epoch says something changed somewhere. */
function ancestorSig(element) {
  let s = ''
  for (let el = element.parentElement; el; el = el.parentElement) {
    s += '|' + el.tagName
    const attrs = el.attributes
    for (let i = 0; i < attrs.length; i++) s += ' ' + attrs[i].name + '=' + attrs[i].value
  }
  return s
}

/**
 * A MutationObserver with `subtree: true` does NOT cross a shadow boundary, so every web
 * component's internal updates were invisible to the memo and auto mode served pre-update
 * frames indefinitely. Each open root gets its own observer, feeding the same markDirty.
 * Re-scanned per capture, which also catches roots attached AFTER the memo was taken —
 * those are content the retained clone never saw, so they invalidate on sight.
 * Closed roots stay unreachable by design; nothing can observe them.
 */
function trackShadowRoots(element, state) {
  if (!element.querySelectorAll) return
  const roots = new Set()
  if (element.shadowRoot) roots.add(element.shadowRoot)
  for (const el of element.querySelectorAll('*')) {
    if (el.shadowRoot) roots.add(el.shadowRoot)
  }
  for (const [root, obs] of state.trackedShadowRoots) {
    if (!roots.has(root)) {
      try { obs.disconnect() } catch { /* already gone */ }
      for (const type of SHADOW_LOCAL_EVENTS) root.removeEventListener(type, state.onMediaDirty, true)
      state.trackedShadowRoots.delete(root)
      const i = state.observers.indexOf(obs)
      if (i >= 0) state.observers.splice(i, 1)
    }
  }
  for (const root of roots) {
    if (state.trackedShadowRoots.has(root)) continue
    try {
      const o = new MutationObserver(state.markDirty)
      o.observe(root, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
      o.__flush = state.markDirty
      state.observers.push(o)
      state.trackedShadowRoots.set(root, o)
      // The record-less half of the matrix needs its own wiring here. The listeners on the
      // captured element cover the light DOM and, through composition, `input` and focus from
      // inside a shadow tree — but `scroll` and `change` are composed:false, so they stop AT
      // the shadow boundary and never reached it. A scrolled pane inside a web component
      // served its pre-scroll frame forever. The root itself is where those events end up.
      for (const type of SHADOW_LOCAL_EVENTS) root.addEventListener(type, state.onMediaDirty, { capture: true, passive: true })
      // Newly seen root: its content was never part of the retained capture.
      if (state.retained) state.dirtyAll()
    } catch { /* degrade: this root's changes won't invalidate */ }
  }
}

/** Events that do NOT compose out of a shadow tree, so the host's listeners never see them. */
const SHADOW_LOCAL_EVENTS = ['scroll', 'change']

/** Every scope a capture's media can live in: the element's own tree plus each OPEN shadow
 *  root under it. `querySelectorAll` stops at a shadow boundary, so a <video> or a loading
 *  <img> inside a web component was invisible to the trackers below — and both change what
 *  paints with no mutation record to catch it. Costs one extra query per open root, and
 *  nothing at all on a page without shadow DOM. */
function scopesOf(element, state) {
  return state.trackedShadowRoots.size ? [element, ...state.trackedShadowRoots.keys()] : [element]
}

/**
 * Listen for frame changes on every <video> in the capture. A playing video repaints with no
 * mutation record, so `timeupdate` and `seeked` mark the element dirty instead. Re-run per
 * capture: videos added since are armed, removed ones released. Pinned by the <video> case
 * in __tests__/core.capture.burst.test.js.
 */
function trackVideos(element, state, onMediaDirty) {
  const videos = new Set()
  if (element.tagName === 'VIDEO') videos.add(element)
  for (const scope of scopesOf(element, state)) {
    if (scope.querySelectorAll) for (const v of scope.querySelectorAll('video')) videos.add(v)
  }
  for (const v of state.trackedVideos) {
    if (!videos.has(v)) {
      v.removeEventListener('timeupdate', onMediaDirty)
      v.removeEventListener('seeked', onMediaDirty)
      state.trackedVideos.delete(v)
    }
  }
  for (const v of videos) {
    if (!state.trackedVideos.has(v)) {
      v.addEventListener('timeupdate', onMediaDirty)
      v.addEventListener('seeked', onMediaDirty)
      state.trackedVideos.add(v)
    }
  }
}

/**
 * Image loads change layout and paint WITHOUT any DOM mutation — a memo taken while a
 * subtree <img> was still loading must not survive the load. Listeners live on the imgs
 * themselves (GC'd with the subtree) and set dirty unconditionally: even a capture in
 * flight used the pre-load layout, so its memo is stale the moment the image arrives.
 */
function trackPendingImages(element, state) {
  const imgs = []
  if (element.tagName === 'IMG') imgs.push(element)
  for (const scope of scopesOf(element, state)) {
    if (scope.querySelectorAll) imgs.push(...scope.querySelectorAll('img'))
  }
  // Drop the ones that are gone. `once` removes an image from the set when its load or
  // error fires, but an <img> detached while still in flight never fires either — it stayed
  // in this strong Set with two live listeners, and a list that swaps its rows faster than
  // they load accumulated them for as long as the captured element was alive.
  if (state.trackedImages.size) {
    const live = new Set(imgs)
    for (const img of state.trackedImages) {
      if (!live.has(img) && !img.isConnected) state.trackedImages.delete(img)
    }
  }
  for (const img of imgs) {
    if (img.complete || state.trackedImages.has(img)) continue
    state.trackedImages.add(img)
    const once = () => {
      // A load that lands WHILE a capture runs tears that frame: the pipeline read the
      // pre-load layout, so the clone it is building is already wrong. Marking only `dirty`
      // was not enough — the commit block clears `dirty` unconditionally and the finally's
      // tear check judges MutationRecords and `state.torn`, neither of which an image load
      // produces. The pre-load frame was therefore committed as clean and, since `once`
      // de-arms itself, served for every later capture. `torn` routes it through the
      // existing arm below, which drops the memo. Same reasoning as onMediaDirty.
      if (state.capturing) state.torn = true
      state.dirty = true
      state.dirtyRoots = null
      img.removeEventListener('load', once)
      img.removeEventListener('error', once)
      state.trackedImages.delete(img)
    }
    img.addEventListener('load', once)
    img.addEventListener('error', once)
  }
}

/**
 * Do the records collected during a capture describe a real change? Dropping them wholesale
 * (the old behaviour) let a concurrent external mutation vanish, so a TORN frame (half
 * pre-mutation, half post) was memoized and served as fresh. Flagging every external-looking
 * record instead would kill the memo outright on any page using text-overflow, line-clamp or
 * content-visibility:auto: the pipeline mutates those LIVE nodes and undoes them again
 * (measured: 10 such records on a two-div page).
 * A mutation whose NET effect is zero cannot change what renders, and that is the test:
 * attributes and character data compare the OLDEST recorded value against the current one, and
 * text-only childList records balance the text they added against the text they removed.
 * Anything else is a real change: an element added or removed. Character data belongs in the
 * net-zero group since the truncation bake writes `textNode.data` rather than `textContent`
 * (#485), so the ellipsis measurement now reports characterData records where it used to report
 * balanced childList pairs. Once per capture, over that capture's own records.
 * @param {MutationRecord[]} records
 * @returns {boolean}
 */
function hasTornMutation(records) {
  const attrs = new Map() // target → (attribute name → oldest recorded value)
  const chars = new Map() // text node → oldest recorded data
  const texts = new Map() // target → (text → +1 added / -1 removed)
  for (const rec of records) {
    if (!isExternalRecord(rec)) continue
    if (rec.type === 'attributes') {
      let byName = attrs.get(rec.target)
      if (!byName) attrs.set(rec.target, byName = new Map())
      if (!byName.has(rec.attributeName)) byName.set(rec.attributeName, rec.oldValue)
    } else if (rec.type === 'characterData') {
      if (!chars.has(rec.target)) chars.set(rec.target, rec.oldValue)
    } else if (rec.type === 'childList') {
      let delta = texts.get(rec.target)
      if (!delta) texts.set(rec.target, delta = new Map())
      for (const n of rec.addedNodes) {
        if (n.nodeType !== 3) return true
        delta.set(n.data, (delta.get(n.data) || 0) + 1)
      }
      for (const n of rec.removedNodes) {
        if (n.nodeType !== 3) return true
        delta.set(n.data, (delta.get(n.data) || 0) - 1)
      }
    } else return true
  }
  for (const [target, byName] of attrs) {
    for (const [name, old] of byName) if (target.getAttribute(name) !== old) return true
  }
  for (const [node, old] of chars) if (node.data !== old) return true
  for (const delta of texts.values()) {
    for (const n of delta.values()) if (n !== 0) return true
  }
  return false
}

/**
 * Build the tracking state for one element: the scoped MutationObserver, the capture-phase
 * listeners for the record-less half of the matrix, and the shadow, video and image
 * trackers. Runs once per element; captureWithBurst keeps the result in burstStates.
 */
function createState(element) {
  const state = {
    dirty: true,
    pending: [],           // records seen while capturing, judged by hasTornMutation after
    torn: false,           // a record-less event (input/scroll/focus/video) landed mid-capture
    dirtyRoots: new Set(), // scoped dirty subtree roots; null = everything is dirty
    retained: null,        // artifacts from the last full capture (clone, maps, css) for diff
    capturing: false,
    last: null,
    inflight: Promise.resolve(),
    observers: [],
    trackedVideos: new Set(),
    trackedShadowRoots: new Map(),
    trackedImages: new Set(),
    envEpoch: getStyleEnvEpoch(), // shared head+fonts environment epoch (styles.js)
    styleEpoch: getStyleEpoch(),  // cheap gate for the out-of-subtree check below
    ancestorSig: ancestorSig(element),
    hover: [],             // the :hover chain the memo was taken under (hoverChain)
  }

  const dirtyAll = () => { state.dirty = true; state.dirtyRoots = null }
  const noteDirtyRoot = (n) => {
    if (!state.dirtyRoots) return
    const el = n && (n.nodeType === 1 ? n : n.parentElement)
    // Root's own attrs, nodes outside the capture, or too many scattered roots → treat as
    // fully dirty (a class change on the root re-styles everything by inheritance anyway).
    if (!el || el === element || !element.contains(el) || state.dirtyRoots.size >= 12) {
      state.dirtyRoots = null
      return
    }
    state.dirtyRoots.add(el)
  }
  const markDirty = (records) => {
    // Mutations during a capture are MOSTLY the capture's own transient DOM work (line-clamp
    // bake, content-visibility force, …) which always undoes itself, but not all of them:
    // an external edit landing mid-capture makes the frame torn. Buffer the batch and judge
    // it once the capture ends (hasTornMutation), instead of dropping it unseen.
    if (state.capturing) {
      for (const rec of records) state.pending.push(rec)
      return
    }
    for (const rec of records) {
      if (!isExternalRecord(rec)) continue
      state.dirty = true
      noteDirtyRoot(rec.target)
    }
  }
  // The record-less half of the invalidation matrix (scroll, input/change, focus, video
  // frames) needs the same mid-capture handling markDirty gives mutations — it did not have
  // it, and simply DROPPED anything that arrived while `capturing` was true. The capture
  // then committed as a clean memo, so an <input> that went OLD → NEW during a capture was
  // answered with OLD on the next call, forever, since nothing was left to invalidate it.
  //
  // Unlike a mutation record there is nothing to judge afterwards (no target, no oldValue),
  // but there is also nothing to judge: the listeners sit on the captured element itself
  // and the pipeline never types, scrolls or moves focus inside it — its own DOM work
  // happens on clones in a sandbox outside the subtree. So the frame is torn, full stop.
  const onMediaDirty = () => {
    if (state.capturing) { state.torn = true; return }
    dirtyAll()
  }
  state.dirtyAll = dirtyAll

  try {
    const o = new MutationObserver(markDirty)
    // attributeOldValue / characterDataOldValue: hasTornMutation reads them to tell the
    // pipeline's own self-undoing edits (content-visibility force, ellipsis bake) from a real one.
    o.observe(element, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
    o.__flush = markDirty
    state.observers.push(o)
  } catch { /* degrade to always-dirty */ }

  state.markDirty = markDirty
  state.onMediaDirty = onMediaDirty
  // Scroll positions change rendering with NO DOM mutation (scrollTop isn't an attribute):
  // a scrolled container inside the memoized element would serve its pre-scroll frame
  // forever. scroll doesn't bubble but does capture-phase propagate — one listener covers
  // the element and every scrollable descendant. GC'd with the element like the observers.
  try {
    element.addEventListener('scroll', onMediaDirty, { capture: true, passive: true })
    // Form-control state is a property, not an attribute: typing, checking a box or picking
    // an option produces no mutation record at all, so a memoized form served its empty
    // pre-typing frame forever. Same capture-phase trick as scroll. A purely programmatic
    // `el.value = x` still fires nothing — that stays `invalidate: true` territory.
    element.addEventListener('input', onMediaDirty, { capture: true, passive: true })
    element.addEventListener('change', onMediaDirty, { capture: true, passive: true })
    // Focus moves re-style through :focus/:focus-visible with no record either.
    element.addEventListener('focusin', onMediaDirty, { capture: true, passive: true })
    element.addEventListener('focusout', onMediaDirty, { capture: true, passive: true })
  } catch { /* degrade: scrolls/edits won't invalidate */ }
  trackShadowRoots(element, state)
  trackVideos(element, state, onMediaDirty)
  trackPendingImages(element, state)
  return state
}

/** Identity tags for values that have no structural form (functions, class instances, DOM
 *  nodes). Comparing them by identity keeps the memo alive for the normal case — a polling
 *  loop passing the SAME `exclude` callback every frame — while a DIFFERENT callback yields
 *  a different signature and correctly forces a fresh capture. A freshly-allocated inline
 *  closure gets a new tag on every call, so it degrades to "always a one-off": slower, never
 *  wrong. */
let __refSeq = 0
const __refTags = new WeakMap()
function refTag(value) {
  let tag = __refTags.get(value)
  if (!tag) {
    tag = '@' + (++__refSeq)
    __refTags.set(value, tag)
  }
  return tag
}

/** Deterministic serializer for the options signature. Hand-rolled instead of
 *  `JSON.stringify(rest, sortedKeys)` because an ARRAY replacer applies at every depth: it
 *  filtered nested keys against the TOP-LEVEL key list, so `{clip:{x:0,…}}` and
 *  `{clip:{x:900,…}}` both serialized to `{"clip":{}}` and a memo taken for one rect was
 *  served for the other. Functions were dropped outright, which is how two different
 *  `exclude` predicates collided on one memo. Returns null only when nothing comparable can
 *  be built, and the caller treats that as a one-off. */
function stableStringify(value, seen) {
  const t = typeof value
  if (t === 'undefined') return null
  if (value === null || t === 'boolean' || t === 'number' || t === 'string') return JSON.stringify(value)
  if (t === 'function' || t === 'symbol') return t === 'symbol' ? null : JSON.stringify(refTag(value))
  if (t !== 'object') return null
  // DOM nodes and other host objects have no stable structural form: compare by identity.
  if (typeof value.nodeType === 'number') return JSON.stringify(refTag(value))
  if (seen.has(value)) return null // cycle
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const parts = []
      for (const v of value) {
        const s = stableStringify(v, seen)
        if (s === null) return null
        parts.push(s)
      }
      return '[' + parts.join(',') + ']'
    }
    // Class instances (plugin objects, Map/Set/Date…) carry state Object.keys can't see:
    // identity, not structure.
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return JSON.stringify(refTag(value))
    const parts = []
    for (const k of Object.keys(value).sort()) {
      const v = value[k]
      if (v === undefined) continue // matches JSON.stringify: absent key, not a distinct value
      const s = stableStringify(v, seen)
      if (s === null) return null
      parts.push(JSON.stringify(k) + ':' + s)
    }
    return '{' + parts.join(',') + '}'
  } finally {
    seen.delete(value)
  }
}

/** Stable signature of every option except burst/invalidate themselves, so a one-off call
 *  with different options (e.g. `{ burst: true, scale: 2 }` once) is detected as such.
 *  null means "can't be compared" — every such call is a one-off. */
function optionsSignature(userOptions) {
  const { burst: _burst, invalidate: _invalidate, ...rest } = userOptions || {}
  try {
    return stableStringify(rest, new Set())
  } catch {
    return null
  }
}

/**
 * Run a capture through the burst memoization for this element.
 *
 * Calls for the same element are serialized on one queue. Options that differ from the
 * element's baseline make the call a one-off: it captures fresh and leaves the memo alone,
 * until a second call repeats the new options and they become the baseline. A frame that
 * tore mid-capture is never memoized. This is where v3's large wins live: a mutating poll
 * went from 563 ms to 16 and an animated one from 39 to 7.5 (the polling scene in
 * docs/compare/live/harness.js). Pinned by __tests__/core.capture.burst.test.js,
 * __tests__/core.burst.transactional.test.js and __tests__/core.capture.autoburst.rebase.test.js.
 * @param {Element} element
 * @param {object} userOptions - the raw options passed to this call (pre-normalization)
 * @param {object} context - normalized capture context (reads context.invalidate)
 * @param {() => Promise<object>} runCapture - performs the actual full capture + export build
 * @param {(url: string) => Promise<object>} [makeResult] - builds an export result from a URL (differential path)
 * @returns {Promise<object>} the memoized or freshly captured result
 */
export function captureWithBurst(element, userOptions, context, runCapture, makeResult = null) {
  let state = burstStates.get(element)
  if (!state) {
    state = createState(element)
    state.baselineSignature = optionsSignature(userOptions)
    burstStates.set(element, state)
  }
  // A call whose options differ from the element's established burst baseline is a one-off:
  // always fresh, and must not overwrite (or be satisfied by) the memoized baseline result.
  const sig = optionsSignature(userOptions)
  let isOneOff = sig === null || sig !== state.baselineSignature
  if (isOneOff && sig !== null) {
    // The usage pattern changed (e.g. auto-burst tripped during one-off calls with other
    // options, then a polling loop settles on new ones): the SECOND consecutive call with
    // the same new signature adopts it as the baseline so the memo re-engages, instead of
    // treating every future call as a one-off forever.
    if (state.pendingSig === sig) {
      state.baselineSignature = sig
      state.last = null
      state.dirty = true
      state.dirtyRoots = null
      state.pendingSig = null
      isOneOff = false
    } else {
      state.pendingSig = sig
    }
  } else {
    state.pendingSig = null
  }

  const run = async () => {
    // Before serving: a shadow root attached since the last capture produces no mutation
    // record anywhere, so it has to be discovered by scanning.
    trackShadowRoots(element, state)
    // Same for an <img> appended since the last capture's finally: it carries no load
    // listener yet, so its arrival would not invalidate the memo. Arming here as well as in
    // the finally closes the between-captures window, at one querySelectorAll('img') next
    // to the subtree walk trackShadowRoots already does.
    trackPendingImages(element, state)
    for (const o of state.observers) o.__flush(o.takeRecords())
    // Shared style-environment epoch (head CSS + font loads) — one observer stack for the
    // whole library instead of a per-element duplicate.
    const env = getStyleEnvEpoch()
    if (state.envEpoch !== env) { state.dirtyAll(); state.envEpoch = env }
    // Ancestor state (dark-mode attribute, locale class, custom property on :root) re-styles
    // the subtree by inheritance without mutating anything inside it. Gated on the global
    // epoch so a static page pays one integer compare per capture, not a tree walk.
    const styleEpoch = getStyleEpoch()
    if (state.styleEpoch !== styleEpoch) {
      state.styleEpoch = styleEpoch
      const sig = ancestorSig(element)
      if (sig !== state.ancestorSig) { state.ancestorSig = sig; state.dirtyAll() }
    }
    if (context.invalidate) state.dirtyAll()
    // CSS animations/transitions/WAAPI repaint every frame with NO mutation records: while
    // any runs in the subtree, every capture is a different frame — never serve OR store a
    // memo, and drop any memo taken before the animation started (it would be served as
    // soon as the animation ends, showing a pre-animation frame).
    let animating = false
    try {
      const anims = element.getAnimations?.({ subtree: true }) || []
      let targets = new Set()
      for (const a of anims) {
        if (a.playState !== 'running') continue
        animating = true
        const t = a.effect?.target
        if (t && t.nodeType === 1 && element.contains(t)) targets.add(t)
        else { targets = null; break } // untargetable animation → can't scope the frame
      }
      // Frame source: animated subtrees become dirty roots, so the DIFF path serves each
      // frame (styles re-snapshot at the current animation state) instead of the full
      // pipeline. Their snapshots must be invalidated per frame — animations repaint with
      // no mutation records, so the epoch never bumps.
      if (animating && targets && targets.size && state.retained) {
        state.dirty = true
        for (const t of targets) {
          state.dirtyRoots.add(t)
          invalidateSnapshotsUnder(t)
        }
      }
    } catch { /* no Web Animations API — animations won't be detected */ }
    if (animating) state.last = null // every animated frame is different: never serve OR keep a memo
    // :hover moved onto or off the element's own chain since the memo: no record exists
    // for it, so it is compared here. The capture that follows is taken under the new chain.
    const hover = hoverChain(element)
    if (!sameChain(hover, state.hover)) { state.hover = hover; state.dirtyAll() }
    if (!isOneOff && !animating && !state.dirty && state.last) {
      touchMemo(element, state)
      return state.last
    }

    state.capturing = true
    let pendingRetained = null
    try {
      let result = null
      // Differential fast path: only SUBTREES are dirty and the last full capture's
      // artifacts are retained — rebuild just those subtrees and re-serialize. Any doubt
      // (null url) falls through to the full pipeline; correctness never depends on it.
      if (!isOneOff && state.dirty && state.retained && state.dirtyRoots && state.dirtyRoots.size && makeResult) {
        const url = await tryDiffCapture(element, state, context)
        if (url) result = makeResult(url)
      }
      if (!result) {
        // Retain this full capture's artifacts for future differential recaptures, into a
        // local that is published below with the rest of the memo.
        if (!isOneOff) {
          context.__retain = (art) => {
            const srcToClone = new Map()
            for (const [cloneNode, srcNode] of art.nodeMap.entries()) srcToClone.set(srcNode, cloneNode)
            pendingRetained = { ...art, srcToClone }
          }
        }
        result = await runCapture()
      }
      // COMMIT, and only now: clearing the dirty flags before awaiting the capture marked
      // the element clean on a capture that then threw, and the next call served the
      // PREVIOUS frame as if it were fresh. A rejection leaves every flag as it was, so the
      // pending mutations stay pending and the stale memo stays unreachable.
      if (!isOneOff) {
        state.dirty = false
        state.dirtyRoots = new Set()
        if (pendingRetained) state.retained = pendingRetained
        if (!animating) { state.last = result; touchMemo(element, state) }
      }
      return result
    } finally {
      context.__retain = undefined
      for (const o of state.observers) for (const rec of o.takeRecords()) state.pending.push(rec)
      // Mutations that landed mid-capture: the pipeline's own self-undoing edits are
      // ignored, a real one means the frame just built is torn: drop it and stay dirty.
      if (state.torn || hasTornMutation(state.pending)) { state.dirtyAll(); state.last = null }
      state.pending.length = 0
      state.torn = false
      state.capturing = false
      trackShadowRoots(element, state) // pick up shadow roots attached/removed by this capture
      trackVideos(element, state, state.onMediaDirty) // pick up <video>s added/removed by this capture
      trackPendingImages(element, state) // and <img>s still loading — their load must invalidate
    }
  }

  // Two in-flight captures of the same element would race on this element's retained
  // burst/diff state (memo, retained clone, dirty-roots). Serialize concurrent calls on
  // one queue; a failed capture rejects only its own caller, not the whole queue.
  const next = state.inflight.then(run, run)
  state.inflight = next.catch(() => {})
  return next
}
