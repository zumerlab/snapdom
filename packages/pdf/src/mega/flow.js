/**
 * Progress and cancellation for an export that is no longer instant.
 *
 * A 40-page report rasterizes forty page regions through an image codec; that is
 * seconds, and seconds behind a mute button is how users learn to distrust a
 * feature. `onProgress` narrates, `signal` aborts — the same two primitives the
 * platform already standardised, so nothing here invents a vocabulary.
 *
 * Cancellation is checked BETWEEN pages, not inside codec calls: an abort lands
 * within one page's worth of work, and the capture's own caches stay coherent
 * because nothing is torn down mid-object. An aborted export throws the
 * platform's own `AbortError` — the one shape `fetch` taught every caller to
 * catch — and produces no blob, no download, no report.
 *
 * Phases, in the order a caller will see them:
 *
 *   measure     the capture's final artifact is being measured (first export only)
 *   page        one body page drawn; done/total are page counts
 *   matter      cover, contents or closing page drawn
 *   assemble    objects, structure and metadata being written
 *
 * `total` is the body page count once pagination has run and `null` before
 * anything knows it. A progress bar treats null as indeterminate, which it is.
 */

/** Validate both options before any expensive work, and bind them into the two
 * calls the pipeline actually makes. */
export function flowSpec({ signal, onProgress } = {}) {
  if (signal != null && !(typeof AbortSignal !== 'undefined' && signal instanceof AbortSignal)) {
    throw new TypeError('[snapdom-pdf] signal must be an AbortSignal')
  }
  if (onProgress != null && typeof onProgress !== 'function') {
    throw new TypeError('[snapdom-pdf] onProgress must be a function')
  }
  if (!signal && !onProgress) return null
  return {
    /** Throws the platform AbortError if the caller has cancelled. */
    check() {
      if (!signal?.aborted) return
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('[snapdom-pdf] export aborted', 'AbortError')
    },
    /** One progress heartbeat. A throwing callback must not kill the export —
     * progress is narration, not control flow — so it is reported and dropped. */
    tick(phase, done = null, total = null) {
      if (!onProgress) return
      try {
        onProgress({ phase, done, total })
      } catch (error) {
        console.warn(`[snapdom-pdf] onProgress threw: ${error?.message || error}`)
        onProgress = null
      }
    },
  }
}
