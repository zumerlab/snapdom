/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { fetchImage, getStyle, extractURL } from '../utils/helpers.js';
import { bgCache } from '../core/cache.js'

/**
 * Converts all background images in the cloned element tree to data URLs.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {WeakMap} styleCache - Cache of computed styles
 * @returns {Promise<void>} Promise that resolves when all background images are processed
 */
export async function inlineBackgroundImages(source, clone, styleCache) {
  const queue = [[source, clone]];
  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift();
    const style = styleCache.get(srcNode) || getStyle(srcNode);
    if (!styleCache.has(srcNode)) styleCache.set(srcNode, style);
    const bg = style.getPropertyValue("background-image");
    const rawUrl = extractURL(bg);
    if (rawUrl) {
      try {
        let bgUrl = encodeURI(rawUrl);
        let dataUrl;
        if (bgCache.has(bgUrl)) {
          dataUrl = bgCache.get(bgUrl);
        } else {
          dataUrl = await fetchImage(bgUrl);
          bgCache.set(bgUrl, dataUrl);
        }
        cloneNode.style.backgroundImage = `url(${dataUrl})`;
      } catch {
        cloneNode.style.backgroundImage = "none";
      }
    }

    const sChildren = Array.from(srcNode.children);
    const cChildren = Array.from(cloneNode.children);
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]]);
    }
  }
}