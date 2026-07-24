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

import { hasExternalMutation } from '../modules/styles.js'

const burstStates = new WeakMap()

function trackVideos(element, state, onMediaDirty) {
  const videos = new Set()
  if (element instanceof HTMLVideoElement) videos.add(element)
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

function createState(element) {
  const state = {
    dirty: true,
    capturing: false,
    last: null,
    inflight: Promise.resolve(),
    observers: [],
    trackedVideos: new Set(),
  }

  const markDirty = (records) => {
    // Mutations during a capture are the capture's own transient DOM work (line-clamp bake,
    // content-visibility force, …) which always undoes itself; a user mutating concurrently
    // mid-capture produces a torn frame either way, so those are ignored too.
    if (state.capturing) return
    if (hasExternalMutation(records)) state.dirty = true
  }
  const onMediaDirty = () => { if (!state.capturing) state.dirty = true }

  const doc = element.ownerDocument || document
  try {
    const o = new MutationObserver(markDirty)
    o.observe(element, { subtree: true, childList: true, attributes: true, characterData: true })
    state.observers.push(o)
  } catch { /* degrade to always-dirty */ }
  try {
    if (doc.head) {
      const o = new MutationObserver(markDirty)
      o.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true })
      state.observers.push(o)
    }
  } catch { /* head not observable — subtree observer still applies */ }

  state.markDirty = markDirty
  state.onMediaDirty = onMediaDirty
  trackVideos(element, state, onMediaDirty)
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
 * @returns {Promise<object>} the memoized or freshly captured result
 */
export function captureWithBurst(element, userOptions, context, runCapture) {
  let state = burstStates.get(element)
  if (!state) {
    state = createState(element)
    state.baselineSignature = optionsSignature(userOptions)
    burstStates.set(element, state)
  }
  // A call whose options differ from the element's established burst baseline is a one-off:
  // always fresh, and must not overwrite (or be satisfied by) the memoized baseline result.
  const sig = optionsSignature(userOptions)
  const isOneOff = sig === null || sig !== state.baselineSignature

  const run = async () => {
    for (const o of state.observers) state.markDirty(o.takeRecords())
    if (context.invalidate) state.dirty = true
    if (!isOneOff && !state.dirty && state.last) return state.last

    state.capturing = true
    if (!isOneOff) state.dirty = false
    try {
      const result = await runCapture()
      if (!isOneOff) state.last = result
      return result
    } finally {
      for (const o of state.observers) o.takeRecords() // drop the capture's own records
      state.capturing = false
      trackVideos(element, state, state.onMediaDirty) // pick up <video>s added/removed by this capture
    }
  }

  // captureDOM shares the global cache.session bucket, so two in-flight captures of the same
  // element would race and corrupt each other's node/style maps. Serialize concurrent calls
  // on one queue; a failed capture rejects only its own caller, not the whole queue.
  const next = state.inflight.then(run, run)
  state.inflight = next.catch(() => {})
  return next
}
