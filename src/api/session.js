/**
 * Capture session: a scoped MutationObserver plus memoization of the last result, so
 * repeated captures of an unchanged subtree return instantly (dashboard polling, video/gif
 * frame loops with static frames). Any external mutation of the subtree — or of document
 * styles in <head> — marks the session dirty; the next capture() re-runs the pipeline with
 * every content-keyed cache warm (images, downsampled assets, fonts, style snapshots).
 *
 * Dirty-tracking is DOM-mutation-based, so it also listens for `<video>` frame changes
 * (timeupdate/seeked — those don't touch any DOM attribute). It cannot see canvas pixel
 * draws or programmatic CSSOM edits (stylesheet.insertRule/deleteRule, cssRule.style.* on a
 * rule rather than an element) — call the returned session's `invalidate()` after those.
 * @module session
 */

import { hasExternalMutation } from '../modules/styles.js'

/**
 * @param {(el: Element, options?: object) => Promise<object>} snap - the snapdom main callable
 * @param {Element} element
 * @param {object} [options]
 * @returns {{dirty: boolean, capture: (overrides?: object) => Promise<object>, invalidate: () => void, dispose: () => void}}
 */
export function createSession(snap, element, options) {
  if (!element) throw new Error('Element cannot be null or undefined')
  let dirty = true
  let capturing = false
  let last = null
  let disposed = false
  let inflight = Promise.resolve()

  const markDirty = (records) => {
    // Mutations during a capture are the capture's own transient DOM work (line-clamp bake,
    // content-visibility force, …) which always undoes itself; a user mutating concurrently
    // mid-capture produces a torn frame either way, so those are ignored too.
    if (capturing) return
    if (hasExternalMutation(records)) dirty = true
  }

  // <video> frame changes (seek, playback) don't touch any DOM attribute, so the
  // MutationObserver below never sees them — track videos in the subtree directly.
  const onMediaDirty = () => { if (!capturing) dirty = true }
  const trackedVideos = new Set()
  const syncTrackedVideos = () => {
    const videos = new Set()
    if (element instanceof HTMLVideoElement) videos.add(element)
    if (element.querySelectorAll) for (const v of element.querySelectorAll('video')) videos.add(v)
    for (const v of trackedVideos) {
      if (!videos.has(v)) {
        v.removeEventListener('timeupdate', onMediaDirty)
        v.removeEventListener('seeked', onMediaDirty)
        trackedVideos.delete(v)
      }
    }
    for (const v of videos) {
      if (!trackedVideos.has(v)) {
        v.addEventListener('timeupdate', onMediaDirty)
        v.addEventListener('seeked', onMediaDirty)
        trackedVideos.add(v)
      }
    }
  }
  syncTrackedVideos()

  const observers = []
  const doc = element.ownerDocument || document
  try {
    const o = new MutationObserver(markDirty)
    o.observe(element, { subtree: true, childList: true, attributes: true, characterData: true })
    observers.push(o)
  } catch { /* degrade to always-dirty */ }
  try {
    if (doc.head) {
      const o = new MutationObserver(markDirty)
      o.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true })
      observers.push(o)
    }
  } catch { /* head not observable — subtree observer still applies */ }

  return {
    /** True when the subtree (or document styles) changed since the last capture. */
    get dirty() {
      for (const o of observers) markDirty(o.takeRecords())
      return dirty
    },

    /**
     * Capture the element. When nothing changed and no overrides are passed, the memoized
     * result is returned without touching the pipeline.
     * @param {object} [overrides] - per-call option overrides (results are not memoized)
     */
    async capture(overrides) {
      if (disposed) throw new Error('[snapdom.session] Session is disposed')
      // Flush queued records first so pre-capture mutations aren't misattributed to the capture.
      for (const o of observers) markDirty(o.takeRecords())
      if (!dirty && last && !overrides) return last

      const run = async () => {
        // Re-check: by the time this runs, a queued capture ahead of it may already
        // have produced a fresh memoized result — reuse it instead of recapturing.
        if (!dirty && last && !overrides) return last
        capturing = true
        dirty = false
        try {
          const result = await snap(element, { ...options, ...(overrides || {}) })
          if (!overrides) last = result
          return result
        } finally {
          for (const o of observers) o.takeRecords() // drop the capture's own records
          capturing = false
          syncTrackedVideos() // pick up <video> elements added/removed by this capture's caller
        }
      }

      // captureDOM shares the global cache.session bucket, so two in-flight
      // captures of the same element would race and corrupt each other's
      // node/style maps. Serialize concurrent capture() calls on one queue;
      // a failed capture rejects only its own caller, not the whole queue.
      const next = inflight.then(run, run)
      inflight = next.catch(() => {})
      return next
    },

    /**
     * Manually flag the session dirty for changes the automatic tracking can't see:
     * canvas pixel draws, programmatic CSSOM edits (stylesheet.insertRule/deleteRule,
     * cssRule.style.* on a rule rather than an element). DOM mutations and <video>
     * frame changes are already tracked automatically and don't need this.
     */
    invalidate() {
      if (disposed) return
      dirty = true
    },

    /** Disconnect observers and drop the memoized result. */
    dispose() {
      disposed = true
      last = null
      for (const o of observers) { try { o.disconnect() } catch { /* ok */ } }
      observers.length = 0
      for (const v of trackedVideos) {
        v.removeEventListener('timeupdate', onMediaDirty)
        v.removeEventListener('seeked', onMediaDirty)
      }
      trackedVideos.clear()
    },
  }
}
