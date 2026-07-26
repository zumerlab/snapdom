/**
 * burst:true memoization: a scoped MutationObserver plus caching of the last result per
 * element, so repeated captures of an unchanged subtree return instantly (dashboard polling,
 * video/gif frame loops with static frames). Any external mutation of the subtree — or of
 * document styles in <head> — marks the element dirty; the next capture re-runs the pipeline
 * with every content-keyed cache warm (images, downsampled assets, fonts, style snapshots).
 *
 * Dirty-tracking is DOM-mutation-based, so it also listens for `<video>` frame changes
 * (timeupdate/seeked — those don't touch any DOM attribute). It cannot see canvas pixel
 * draws or programmatic CSSOM edits (stylesheet.insertRule/deleteRule, cssRule.style.* on a
 * rule rather than an element) — pass `{ burst: true, invalidate: true }` on the next call
 * after those.
 *
 * State lives in a WeakMap keyed by element — no separate handle/dispose: once the element is
 * unreachable, its entry (and the MutationObserver instances closed over it) become
 * GC-eligible on their own.
 * @module burst
 */

import { hasExternalMutation, isExternalRecord } from '../modules/styles.js'
import { tryDiffCapture } from './diff.js'
import { cache } from './cache.js'

const burstStates = new WeakMap()

const AUTO_WINDOW_MS = 2000
const AUTO_THRESHOLD = 3

/**
 * Auto-burst: when the caller passes no explicit `burst` option, repeated captures of the
 * same element in a short sliding window enable memoization automatically — pollers get the
 * speedup without knowing the option exists. Canvas-bearing elements are excluded: canvas
 * pixel draws are invisible to MutationObserver, so auto mode could silently serve stale
 * frames to chart pollers (explicit `burst: true` still works there, with `invalidate`).
 * @param {Element} element
 * @returns {boolean}
 */
export function shouldAutoBurst(element) {
  const now = Date.now()
  const entry = cache.burstAdvice.get(element)
  if (!entry || now - entry.lastTs > AUTO_WINDOW_MS) {
    cache.burstAdvice.set(element, { count: 1, lastTs: now })
    return false
  }
  entry.lastTs = now
  entry.count++
  if (entry.count < AUTO_THRESHOLD) return false
  if (element.tagName === 'CANVAS' || element.querySelector?.('canvas')) return false
  return true
}

function trackVideos(element, state, onMediaDirty) {
  const videos = new Set()
  if (element.tagName === 'VIDEO') videos.add(element)
  if (element.querySelectorAll) for (const v of element.querySelectorAll('video')) videos.add(v)
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
  if (element.querySelectorAll) imgs.push(...element.querySelectorAll('img'))
  for (const img of imgs) {
    if (img.complete || state.trackedImages.has(img)) continue
    state.trackedImages.add(img)
    const once = () => {
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

/** Font loads also repaint with no DOM mutation. One module-level epoch (no per-element
 *  listener on document.fonts — that would root the state forever) that captures compare. */
let _fontEpoch = 0
let _fontsWired = false
function wireFontEpoch(doc) {
  if (_fontsWired) return
  _fontsWired = true
  try { doc.fonts?.addEventListener('loadingdone', () => { _fontEpoch++ }) } catch { /* no Font Loading API */ }
}

function createState(element) {
  const state = {
    dirty: true,
    dirtyRoots: new Set(), // scoped dirty subtree roots; null = everything is dirty
    retained: null,        // artifacts from the last full capture (clone, maps, css) for diff
    capturing: false,
    last: null,
    inflight: Promise.resolve(),
    observers: [],
    trackedVideos: new Set(),
    trackedImages: new Set(),
    fontEpoch: _fontEpoch,
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
    // Mutations during a capture are the capture's own transient DOM work (line-clamp bake,
    // content-visibility force, …) which always undoes itself; a user mutating concurrently
    // mid-capture produces a torn frame either way, so those are ignored too.
    if (state.capturing) return
    for (const rec of records) {
      if (!isExternalRecord(rec)) continue
      state.dirty = true
      noteDirtyRoot(rec.target)
    }
  }
  const markDirtyGlobal = (records) => {
    if (state.capturing) return
    if (hasExternalMutation(records)) dirtyAll()
  }
  const onMediaDirty = () => { if (!state.capturing) dirtyAll() }
  state.dirtyAll = dirtyAll

  const doc = element.ownerDocument || document
  try {
    const o = new MutationObserver(markDirty)
    o.observe(element, { subtree: true, childList: true, attributes: true, characterData: true })
    o.__flush = markDirty
    state.observers.push(o)
  } catch { /* degrade to always-dirty */ }
  try {
    if (doc.head) {
      const o = new MutationObserver(markDirtyGlobal)
      o.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true })
      o.__flush = markDirtyGlobal
      state.observers.push(o)
    }
  } catch { /* head not observable — subtree observer still applies */ }

  state.markDirty = markDirty
  state.onMediaDirty = onMediaDirty
  // Scroll positions change rendering with NO DOM mutation (scrollTop isn't an attribute):
  // a scrolled container inside the memoized element would serve its pre-scroll frame
  // forever. scroll doesn't bubble but does capture-phase propagate — one listener covers
  // the element and every scrollable descendant. GC'd with the element like the observers.
  try {
    element.addEventListener('scroll', onMediaDirty, { capture: true, passive: true })
  } catch { /* degrade: scrolls won't invalidate */ }
  trackVideos(element, state, onMediaDirty)
  trackPendingImages(element, state)
  wireFontEpoch(doc)
  return state
}

/** Stable signature of every option except burst/invalidate themselves, so a one-off call
 *  with different options (e.g. `{ burst: true, scale: 2 }` once) is detected as such. */
function optionsSignature(userOptions) {
  const { burst: _burst, invalidate: _invalidate, ...rest } = userOptions || {}
  try {
    return JSON.stringify(rest, Object.keys(rest).sort())
  } catch {
    return null // unserializable (e.g. a filter function) — treat every call as a one-off
  }
}

/**
 * Run a capture through the burst memoization for this element.
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
    for (const o of state.observers) o.__flush(o.takeRecords())
    if (state.fontEpoch !== _fontEpoch) { state.dirtyAll(); state.fontEpoch = _fontEpoch }
    if (context.invalidate) state.dirtyAll()
    if (!isOneOff && !state.dirty && state.last) return state.last

    state.capturing = true
    try {
      // Differential fast path: only SUBTREES are dirty and the last full capture's
      // artifacts are retained — rebuild just those subtrees and re-serialize. Any doubt
      // (null url) falls through to the full pipeline; correctness never depends on it.
      if (!isOneOff && state.dirty && state.retained && state.dirtyRoots && state.dirtyRoots.size && makeResult) {
        const url = await tryDiffCapture(element, state, context)
        if (url) {
          const result = makeResult(url)
          state.dirty = false
          state.dirtyRoots = new Set()
          state.last = result
          return result
        }
      }
      if (!isOneOff) {
        state.dirty = false
        state.dirtyRoots = new Set()
        // Retain this full capture's artifacts for future differential recaptures.
        context.__retain = (art) => {
          const srcToClone = new Map()
          for (const [cloneNode, srcNode] of art.nodeMap.entries()) srcToClone.set(srcNode, cloneNode)
          state.retained = { ...art, srcToClone }
        }
      }
      const result = await runCapture()
      if (!isOneOff) state.last = result
      return result
    } finally {
      context.__retain = undefined
      for (const o of state.observers) o.takeRecords() // drop the capture's own records
      state.capturing = false
      trackVideos(element, state, state.onMediaDirty) // pick up <video>s added/removed by this capture
      trackPendingImages(element, state) // and <img>s still loading — their load must invalidate
    }
  }

  // captureDOM shares the global cache.session bucket, so two in-flight captures of the same
  // element would race and corrupt each other's node/style maps. Serialize concurrent calls
  // on one queue; a failed capture rejects only its own caller, not the whole queue.
  const next = state.inflight.then(run, run)
  state.inflight = next.catch(() => {})
  return next
}
