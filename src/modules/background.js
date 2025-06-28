/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { getStyle, inlineSingleBackgroundEntry } from '../utils/helpers.js';

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
    const bgColor = style.getPropertyValue("background-color");

    if (!bg || bg === "none") {
      const sChildren = Array.from(srcNode.children);
      const cChildren = Array.from(cloneNode.children);
      for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
        queue.push([sChildren[i], cChildren[i]]);
      }
      continue;
    }

    const bgSplits = bg
      .split(/,(?=(?:[^()]*\([^()]*\))*[^()]*$)/)
      .map(s => s.trim());

    const newBgParts = await Promise.all(
      bgSplits.map(entry => inlineSingleBackgroundEntry(entry, options))
    );

    const hasRealBg = newBgParts.some(p =>
      p && p !== "none" && !/^url\(undefined\)/.test(p)
    );

    if (hasRealBg) {
      cloneNode.style.backgroundImage = newBgParts.join(", ");
    }

    if (
      bgColor &&
      bgColor !== "transparent" &&
      bgColor !== "rgba(0, 0, 0, 0)"
    ) {
      cloneNode.style.backgroundColor = bgColor;
    }

    const sChildren = Array.from(srcNode.children);
    const cChildren = Array.from(cloneNode.children);
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]]);
    }
  }
}
