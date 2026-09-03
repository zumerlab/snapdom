/**
 * Cross-capture caches. The only module-level mutable state the library keeps.
 *
 * Everything scoped to one capture lives on the session (session.js). What lives here is
 * reused across captures on purpose: fetched assets, per-tag defaults, the clone-in-document
 * measurement, the compress output. Each Map is capped and evicts FIFO, so a long-lived SPA
 * cannot grow them without bound. `cache: 'disabled'` replaces every one of them before a
 * capture. Pinned by __tests__/core.cache.test.js.
 * @module cache
 */

/** Max entries before evicting oldest (FIFO). Keeps lib lightweight, avoids memory leaks. */
const MAX_IMAGE = 100
const MAX_BACKGROUND = 100
const MAX_RESOURCE = 150
const MAX_BASE_STYLE = 50
// Keyed by tag name. Must stay ABOVE utils/css.js `commonTags` (31), or precacheCommonTags
// evicts its own earliest entries — at 30 it evicted 'div', the most common tag on any page,
// during its own warmup, and every capture then re-measured div defaults from a live sandbox.
// Headroom above 31 covers the tags a real document uses beyond that list.
const MAX_DEFAULT_STYLE = 64
const MAX_COMPRESS = 50

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
 *  - image ........ <img> data URLs by source URL (images.js; preCache warms it)
 *  - background ... background-image data URLs by URL (utils/image.js)
 *  - resource ..... blob: URL contents (clone.helpers resolveBlobUrl; fonts.js reads it)
 *  - defaultStyle . per-tag UA defaults from the sandbox (utils/css.js)
 *  - baseStyle .... the base reset CSS per tag set (capture.helpers)
 *  - compress ..... downsampled images (compress.js), see below
 *  - computedStyle  getStyle's memo, one CSSStyleDeclaration per element (utils/css.js)
 *  - measureHints . the clone-in-document measurement (engines/svg.js), see below
 */
export const cache = {
  image: new EvictingMap(MAX_IMAGE),
  background: new EvictingMap(MAX_BACKGROUND),
  resource: new EvictingMap(MAX_RESOURCE),
  defaultStyle: new EvictingMap(MAX_DEFAULT_STYLE),
  baseStyle: new EvictingMap(MAX_BASE_STYLE),
  /** Downsampled data URLs keyed by source fingerprint + target size, so repeated captures
   *  of the same element don't re-decode + re-encode every inlined image. */
  compress: new EvictingMap(MAX_COMPRESS),
  computedStyle: new WeakMap(),
  /** Persistent cache for clone-in-document layout measurements (PERF-3).
   *  Key: Element. Value: { cssLen, w0, csh, csw } — cssLen is the total injected CSS
   *  length, used together with w0 as a cheap invalidation key when styles change. */
  measureHints: new WeakMap(),
  /** Fires the reconcile suggestion at most once per page load (see capture.js). */
  warnedReconcile: false,
}

export { EvictingMap }

/**
 * Normalizes cache values: `false`/'disabled' opt out of every cache (debug/test escape
 * hatch); everything else — including the legacy 'soft'/'auto'/'full' strings — maps to
 * the one structural behavior. The old per-policy session sharing is superseded: sessions
 * are per-capture by construction (createCaptureSession), repeat-capture speed comes from
 * auto-burst + differential recapture WITH real invalidation, and 'full' would re-share
 * session maps across captures — the exact mutable-state class the session refactor
 * eliminated.
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
 * Called once per capture from createCaptureSession, in the same synchronous tick.
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
  cache.compress      = new EvictingMap(MAX_COMPRESS)
}
