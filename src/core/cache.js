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
  },
  reset: resetCache
};

function resetCache() {
  cache.computedStyle = new WeakMap();
  cache.session.styleMap = new Map()
  cache.session.styleCache = new WeakMap()
  cache.session.nodeMap = new Map()
  cache.defaultStyle = new Map()
  cache.baseStyle = new Map()
}
