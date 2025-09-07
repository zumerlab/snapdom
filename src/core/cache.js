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
      // Limpieza mínima: solo maps transitorios
      cache.session.styleMap = new Map();
      cache.session.nodeMap  = new Map();
      return;
    }
    case "soft": {
      // Limpieza de sesión completa
      cache.session.styleMap   = new Map();
      cache.session.nodeMap    = new Map();
      cache.session.styleCache = new WeakMap();
      return;
    }
    case "full": {
      // Mantener todo (no limpiar nada)
      return;
    }
    case "disabled": {
      // 🔁 Session (clonar siempre para cortar referencias)
      cache.session.styleMap   = new Map();
      cache.session.nodeMap    = new Map();
      cache.session.styleCache = new WeakMap();

      // 🔁 Estilos globales (ANTES solo se hacía clear() de algunos)
      cache.computedStyle = new WeakMap();
      cache.baseStyle     = new Map();
      cache.defaultStyle  = new Map();

      // 🔁 Recursos (mejor reinstanciar que clear() para cortar iteradores/referencias)
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
