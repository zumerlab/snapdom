/**
 * Caches reused across captures on purpose: fetched assets, per-tag defaults, the
 * clone-in-document measurement, the compress output. Anything scoped to one capture belongs
 * on the session (session.js). Each Map is capped and evicts FIFO, so a long-lived SPA cannot
 * grow them without bound; compress.js trims its own when a pass that added to it ends.
 * `cache: 'disabled'` replaces every one of them before a capture.
 * Pinned by __tests__/core.cache.test.js.
 * @module cache
 */

/** Max entries before the oldest is evicted (FIFO). */
const MAX_IMAGE = 100
const MAX_BACKGROUND = 100
const MAX_RESOURCE = 150
const MAX_BASE_STYLE = 50
// Keyed by tag name, and kept above the ~31 tags a page commonly uses: at 30 the first capture
// evicted 'div' while still filling it, and every capture re-measured div from the sandbox.
const MAX_DEFAULT_STYLE = 64

/**
 * Map that evicts oldest entries when exceeding maxSize. FIFO order.
 * @extends Map
 */
class EvictingMap extends Map {
  constructor(maxSize = 100, ...args) {
    super(...args)
    this._maxSize = maxSize
  }
  set(key, value) {
    if (this.size >= this._maxSize && !this.has(key)) {
      const first = this.keys().next().value
      if (first !== undefined) this.delete(first)
    }
    return super.set(key, value)
  }
}

/**
 * The global caches. Who writes each one:
 *  - image ........ <img> data URLs by source URL (images.js)
 *  - background ... background-image data URLs by URL (utils/image.js)
 *  - resource ..... blob: URL contents (clone.helpers resolveBlobUrl; fonts.js reads it)
 *  - defaultStyle . per-tag UA defaults from the sandbox (utils/css.js)
 *  - baseStyle .... base reset CSS per tag set, with the universe that pruned it (capture.helpers)
 *  - compress ..... downsampled images (compress.js), see below
 *  - computedStyle  getStyle's memo: element to declaration, then to its pseudos (utils/css.js)
 *  - measureHints . the clone-in-document measurement (engines/svg.js), see below
 */
export const cache = {
  image: new EvictingMap(MAX_IMAGE),
  background: new EvictingMap(MAX_BACKGROUND),
  resource: new EvictingMap(MAX_RESOURCE),
  defaultStyle: new EvictingMap(MAX_DEFAULT_STYLE),
  baseStyle: new EvictingMap(MAX_BASE_STYLE),
  /** {source, result, pass} records keyed by a sampled lookup hint + target size. compress.js
   *  verifies exact source equality and evicts (compressCloneAssets). */
  compress: new Map(),
  computedStyle: new WeakMap(),
  /** Clone-in-document layout measurements (PERF-3), Element to { cssLen, w0, csh, csw }.
   *  cssLen (total injected CSS length) and w0 are the cheap invalidation key. */
  measureHints: new WeakMap(),
  /** Fires the reconcile suggestion at most once per page load (see capture.js). */
  warnedReconcile: false,
}

export { EvictingMap }

/**
 * Normalizes the `cache` option: `false` or 'disabled' opt out of every cache (a debug and
 * test escape hatch); anything else, legacy 'auto' and 'full' included, is 'soft'. Do not
 * bring back 'full': sharing a session across captures is the mutable state the session
 * refactor removed.
 * @param {unknown} v
 * @returns {"soft"|"disabled"}
 */
export function normalizeCachePolicy(v) {
  if (v === false) return 'disabled'
  if (typeof v === 'string' && v.toLowerCase().trim() === 'disabled') return 'disabled'
  return 'soft'
}

/**
 * Empties every persistent cache when the policy is 'disabled'. A no-op otherwise.
 * Called by captureDOM at its entry and again before a torn clone is retried.
 * @param {"soft"|"disabled"} [policy='soft']
 */
export function applyCachePolicy(policy = 'soft') {
  if (policy !== 'disabled') return

  // 'disabled': also drop every persistent cache so nothing is reused across captures.
  cache.computedStyle = new WeakMap()
  cache.measureHints  = new WeakMap()
  cache.baseStyle     = new EvictingMap(MAX_BASE_STYLE)
  cache.defaultStyle  = new EvictingMap(MAX_DEFAULT_STYLE)
  cache.image         = new EvictingMap(MAX_IMAGE)
  cache.background    = new EvictingMap(MAX_BACKGROUND)
  cache.resource      = new EvictingMap(MAX_RESOURCE)
  cache.compress      = new Map()
}
