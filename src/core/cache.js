/**
 * Caches for images, backgrounds, resources, and computed styles used during DOM capture.
 * @module cache
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


// Mantener solo estos públicos:
export function softReset() {
  cache.computedStyle = new WeakMap();
  cache.session.styleMap.clear();
  cache.session.styleCache = new WeakMap();
  cache.session.nodeMap.clear();
  cache.defaultStyle.clear();
  cache.baseStyle.clear(); 
}

export function hardReset() {
  softReset();
  cache.image.clear();
  cache.background.clear();
  cache.resource.clear();
  cache.font.clear();
}

// Mapea nivel → acción
export function applyReset(level) {
  if (level === "soft") return softReset();
  if (level === "hard") return hardReset();
  // 'none' → no-op
}