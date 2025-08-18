/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils';
import { cache } from '../core/cache.js'
/**
 * Recursively inlines background-related images and masks from the source element to its clone.
 * 
 * This function walks through the source DOM tree and its clone, copying inline styles for
 * background images, masks, and border images to ensure the clone retains all visual image
 * resources inline (e.g., data URLs), avoiding external dependencies.
 * 
 * It also preserves the `background-color` property if it is not transparent.
 * 
 * Special handling is done for `border-image` related properties: the
 * `border-image-slice`, `border-image-width`, `border-image-outset`, and `border-image-repeat`
 * are only copied if `border-image` or `border-image-source` are present and active.
 * 
 * @param {HTMLElement} source The original source element from which styles are read.
 * @param {HTMLElement} clone The cloned element to which inline styles are applied.
 * @param {Object} [options={}] Optional parameters passed to image inlining functions.
 * @returns {Promise<void>} Resolves when all inlining operations (including async image fetches) complete.
 */
export async function inlineBackgroundImages(source, clone, styleCache, options = {}) {
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
    "border-image-slice",
    "border-image-width",
    "border-image-outset",
    "border-image-repeat"
  ];

  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift();

    // Retrieve cached or computed style for source node
    const style = styleCache.get(srcNode) || getStyle(srcNode);
    if (!styleCache.has(srcNode)) styleCache.set(srcNode, style);

    // Determine if border-image or border-image-source is active for conditional copying
    const hasBorderImage = (() => {
      const bi = style.getPropertyValue("border-image");
      const bis = style.getPropertyValue("border-image-source");
      return (bi && bi !== "none") || (bis && bis !== "none");
    })();

    for (const prop of imageProps) {
      // Skip border-image derivative properties if no active border-image is present
      if (
        ["border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"].includes(prop) &&
        !hasBorderImage
      ) {
        continue;
      }

      const val = style.getPropertyValue(prop);
      if (!val || val === "none") continue;

      // Split multiple background images (e.g., comma-separated) for inlining each separately
      const splits = splitBackgroundImage(val);

      // Inline each background image entry asynchronously (e.g., fetch and embed as data URI)
      const inlined = await Promise.all(
        splits.map(entry => inlineSingleBackgroundEntry(entry, options))
      );

      // If any inlined entry is valid, set the joined inline style on the clone
      if (inlined.some(p => p && p !== "none" && !/^url\(undefined/.test(p))) {
        cloneNode.style.setProperty(prop, inlined.join(", "));
      }
    }

    // Preserve background-color if it's not transparent or default transparent rgba
    const bgColor = style.getPropertyValue("background-color");
    if (
      bgColor &&
      bgColor !== "transparent" &&
      bgColor !== "rgba(0, 0, 0, 0)"
    ) {
      cloneNode.style.backgroundColor = bgColor;
    }

    // Queue children for recursive processing
    const sChildren = Array.from(srcNode.children);
    const cChildren = Array.from(cloneNode.children);
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]]);
    }
  }
}
