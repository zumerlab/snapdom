/**
 * Utilities for inlining computed styles and generating CSS classes.
 * @module styles
 */

import { getStyleKey } from '../utils/cssTools.js';
import { snapshotComputedStyle } from '../utils/helpers.js';
import { getStyle } from '../utils/helpers.js';

/**
 * Records computed styles for an element to later generate CSS classes.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} styleMap - Map to store element-to-style-key mappings
 * @param {WeakMap} cache - Cache of computed styles
 * @param {boolean} compress - Whether to compress style keys
 */
export function inlineAllStyles(source, clone, styleMap, cache, compress) {
  if (source.tagName === "STYLE") return;
  if (!cache.has(source)) {
   // cache.set(source, window.getComputedStyle(source));
    cache.set(source, getStyle(source));
  }
  const style = cache.get(source);
  const snapshot = snapshotComputedStyle(style);  // ✅ hace getPropertyValue() solo 1 vez por prop
  const tagName = source.tagName?.toLowerCase() || 'div';
  const key = getStyleKey(snapshot, tagName, compress);
  styleMap.set(clone, key);
}
