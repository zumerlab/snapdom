/**
 * Global caches for images, styles, and resources.
 */
export const cache = {
  image: new Map(),
  background: new Map(),
  resource: new Map(),
  defaultStyle: new Map(),
  baseStyle: new Map(),
  computedStyle: new WeakMap(),
  font: new Set(),
  session: {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
  }
};

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
  if (v === true) return "soft";
  if (v === false) return "disabled";
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "auto") return "auto";
    if (s === "full") return "full";
    if (s === "soft" || s === "disabled") return s;
  }
  return "soft"; // default
}

/**
 * Applies the cache policy.
 * @param {"soft"|"auto"|"full"|"disabled"} policy
 */
export function applyCachePolicy(policy = "soft") {
  switch (policy) {
    case "auto": {
      cache.session.styleMap = new Map();
      cache.session.nodeMap  = new Map();
      return;
    }
    case "soft": {
      cache.session.styleMap   = new Map();
      cache.session.nodeMap    = new Map();
      cache.session.styleCache = new WeakMap();
      return;
    }
    case "full": {
      return;
    }
    case "disabled": {
      cache.session.styleMap   = new Map();
      cache.session.nodeMap    = new Map();
      cache.session.styleCache = new WeakMap();

      cache.computedStyle = new WeakMap();
      cache.baseStyle     = new Map();
      cache.defaultStyle  = new Map();

      cache.image      = new Map();
      cache.background = new Map();
      cache.resource   = new Map();
      cache.font       = new Set();
      return;
    }
    default: {
      // fallback → soft
      cache.session.styleMap   = new Map();
      cache.session.nodeMap    = new Map();
      cache.session.styleCache = new WeakMap();
      return;
    }
  }
}
