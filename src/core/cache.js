/** Max entries before evicting oldest (FIFO). Keeps lib lightweight, avoids memory leaks. */
const MAX_IMAGE = 100
const MAX_BACKGROUND = 100
const MAX_RESOURCE = 150
const MAX_BASE_STYLE = 50
const MAX_DEFAULT_STYLE = 30
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
 * Global caches for images, styles, and resources.
 * Persistent caches use EvictingMap to avoid unbounded memory growth.
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
  /** { count, firstTs, warned } per element — tracks capture frequency for elements NOT using
   *  burst:true, to suggest it when the same element is captured repeatedly in a short window.
   *  The actual burst:true memoization state lives in src/core/burst.js, not here. */
  burstAdvice: new WeakMap(),
  /** Fires the reconcile suggestion at most once per page load (see capture.js). */
  warnedReconcile: false,
  font: new Set(),
  session: {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
  }
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
 * Applies the cache policy.
 * @param {"soft"|"auto"|"full"|"disabled"} policy
 */
export function applyCachePolicy(policy = 'soft') {
  // Fresh per-capture session bucket (legacy surface — captures snapshot it immediately
  // via createCaptureSession and never trust the global afterwards).
  cache.session.styleMap   = new Map()
  cache.session.nodeMap    = new Map()
  cache.session.styleCache = new WeakMap()
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
  cache.font          = new Set()
}
