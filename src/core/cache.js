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
  snapshot: new WeakMap(),
  snapshotKey: new Map(),
  preStyleMap: new Map(),
  preStyle: new WeakMap(),
  preNodeMap: new Map(),
  reset: resetCache
};

function resetCache() {
    // cache.image.clear();
    // cache.background.clear();
    // cache.resource.clear();
    // cache.defaultStyle.clear();
    // cache.baseStyle.clear();
    cache.computedStyle = new WeakMap();
    cache.snapshot= new WeakMap(); 
    cache.snapshotKey.clear();
    // cache.font.clear();
    cache.preStyleMap.clear();
    cache.preStyle = new WeakMap();
    cache.preNodeMap.clear();
}
