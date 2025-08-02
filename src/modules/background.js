/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils/helpers.js';
import { cache } from '../core/cache.js'

/**
 * Converts all background images in the cloned element tree to data URLs.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Object} [options={}] - Options for image processing
 * @returns {Promise<void>} Promise that resolves when all background images are processed
 */
export async function inlineBackgroundImages(source, clone, options = {}) {
  const queue = [[source, clone]];

  const imageProps = [
    "background-image",
    "mask",
    "mask-image", "-webkit-mask-image",
    "mask-source", "mask-box-image-source",
    "mask-border-source",
    "-webkit-mask-box-image-source",
    "border-image",
    "border-image-source",
     'border-image-slice',
  'border-image-width',
  'border-image-outset',
  'border-image-repeat'
  ];

  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift();
    const style = cache.preStyle.get(srcNode) || getStyle(srcNode);
    if (!cache.preStyle.has(srcNode)) cache.preStyle.set(srcNode, style);

    for (const prop of imageProps) {
      const val = style.getPropertyValue(prop);
      if (!val || val === "none") continue;

      const splits = splitBackgroundImage(val);
      const inlined = await Promise.all(
        splits.map(entry => inlineSingleBackgroundEntry(entry, options))
      );

      if (inlined.some(p => p && p !== "none" && !/^url\(undefined/.test(p))) {
        cloneNode.style.setProperty(prop, inlined.join(", "));
      }
    }

    // También preservamos el background-color como antes
    const bgColor = style.getPropertyValue("background-color");
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

