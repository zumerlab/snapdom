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
 * @param {Object} [options={}] - Options for image processing
 * @returns {Promise<void>} Promise that resolves when all background images are processed
 */
export async function inlineBackgroundImages(source, clone, styleCache, options = {}) {
  const queue = [[source, clone]];
  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift();
    const style = styleCache.get(srcNode) || getStyle(srcNode);
    if (!styleCache.has(srcNode)) styleCache.set(srcNode, style);
    const bg = style.getPropertyValue("background-image");
    const bgSplits = bg.split(",");
    for (let i = 0; i < bgSplits.length; i++) {
      const rawUrl = extractURL(bgSplits[i]);
      if(rawUrl) {
        try {
          let bgUrl = encodeURI(rawUrl);
          let dataUrl;
          if (bgCache.has(bgUrl)) {
            dataUrl = bgCache.get(bgUrl);
          } else {
            const crossOrigin = options.crossOrigin ? options.crossOrigin(bgUrl) : "anonymous";
            dataUrl = await fetchImage(bgUrl, 3000, crossOrigin);
            bgCache.set(bgUrl, dataUrl);
          }
          bgSplits[i] = `url(${dataUrl})`;
        } catch {
          bgSplits[i] = "none";
        }
      }
    }
    if(bgSplits.length > 0) {
      cloneNode.style.backgroundImage = bgSplits.join(",");
    }
    const sChildren = Array.from(srcNode.children);
    const cChildren = Array.from(cloneNode.children);
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]]);
    }
  }
}