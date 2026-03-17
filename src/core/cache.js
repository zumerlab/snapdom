/** Max entries before evicting oldest (FIFO). Keeps lib lightweight, avoids memory leaks. */
const MAX_IMAGE = 100
const MAX_BACKGROUND = 100
const MAX_RESOURCE = 150
const MAX_BASE_STYLE = 50
const MAX_DEFAULT_STYLE = 30

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
  computedStyle: new WeakMap(),
  font: new Set(),
  session: {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
  }
}

export { EvictingMap }

/**
 * Normalizes shorthand values to canonical cache policies.
 *  - true  => "soft"
 *  - false => "disabled"
 *  - "auto" => "auto"
 *  - "full" => "full"
 * @param {unknown} v
 * @returns {"soft"|"auto"|"full"|"disabled"}
 */
export function normalizeCachePolicy(v) {
  if (v === true) return 'soft'
  if (v === false) return 'disabled'
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim()
    if (s === 'auto') return 'auto'
    if (s === 'full') return 'full'
    if (s === 'soft' || s === 'disabled') return s
  }
  return 'soft' // default
}

/**
 * Applies the cache policy.
 * @param {"soft"|"auto"|"full"|"disabled"} policy
 */
export function applyCachePolicy(policy = 'soft') {
  cache.session.__counterEpoch = (cache.session.__counterEpoch || 0) + 1
  switch (policy) {
    case 'auto': {
      cache.session.styleMap = new Map()
      cache.session.nodeMap  = new Map()
      return
    }
    case 'soft': {
      cache.session.styleMap   = new Map()
      cache.session.nodeMap    = new Map()
      cache.session.styleCache = new WeakMap()
      return
    }
    case 'full': {
      return
    }
    case 'disabled': {
      cache.session.styleMap   = new Map()
      cache.session.nodeMap    = new Map()
      cache.session.styleCache = new WeakMap()

      cache.computedStyle = new WeakMap()
      cache.baseStyle     = new EvictingMap(MAX_BASE_STYLE)
      cache.defaultStyle  = new EvictingMap(MAX_DEFAULT_STYLE)
      cache.image         = new EvictingMap(MAX_IMAGE)
      cache.background    = new EvictingMap(MAX_BACKGROUND)
      cache.resource      = new EvictingMap(MAX_RESOURCE)
      cache.font          = new Set()
      return
    }
    default: {
      // fallback → soft
      cache.session.styleMap   = new Map()
      cache.session.nodeMap    = new Map()
      cache.session.styleCache = new WeakMap()
      return
    }
  }
}
