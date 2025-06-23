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
    const bgColor = style.getPropertyValue("background-color");

    // Evitamos continuar si no hay background-image significativo
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
      bgSplits.map(async (entry) => {
        const isUrl = entry.startsWith("url(");
        const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry);

        if (isUrl) {
          const rawUrl = extractURL(entry);
          if (!rawUrl) return entry;

          try {
            const encodedUrl = encodeURI(rawUrl);
            if (bgCache.has(encodedUrl)) {
              return `url(${bgCache.get(encodedUrl)})`;
            } else {
              const crossOrigin = options.crossOrigin ? options.crossOrigin(encodedUrl) : "anonymous";
              const dataUrl = await fetchImage(encodedUrl, 3000, crossOrigin);
              bgCache.set(encodedUrl, dataUrl);
              return `url(${dataUrl})`;
            }
          } catch (err) {
            console.warn(`[snapdom] Failed to inline background-image:`, rawUrl, err);
            return entry;
          }
        }

        // Conservar gradientes (incluso repeating) y "none" tal como están
        if (isGradient || entry === "none") {
          return entry;
        }

        // No se reconoce, devolver tal cual
        return entry;
      })
    );

    // Solo aplicar si hay alguna parte útil (no sólo "none")
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
