import { getStyleKey } from '../utils/cssTools.js';

/**
 * Records computed styles for an element to later generate CSS classes
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} styleMap - Map to store element-to-style-key mappings
 * @param {Object} defaults - Default CSS property values
 * @param {WeakMap} cache - Cache of computed styles
 */
export function inlineAllStyles(source, clone, styleMap, defaults, cache) {
  if (source.tagName === 'STYLE') return;
  if (!cache.has(source)) {
    cache.set(source, window.getComputedStyle(source));
  }
  const style = cache.get(source);
  const key = getStyleKey(style, defaults);
  styleMap.set(clone, key);
}
