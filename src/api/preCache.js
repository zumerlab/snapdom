import { precacheCommonTags } from "../utils/cssTools";
import { fetchImage } from "../utils/helpers";
import { extractUrl } from "../utils/helpers";
import { embedCustomFonts } from "../modules/fonts";
import { imageCache, bgCache, resourceCache, baseCSSCache, computedStyleCache } from "../core/cache";

/**
 * Preloads images, background images, and optionally fonts into cache before DOM capture.
 * This helps avoid delays or missing resources during the capture process.
 *
 * - If `reset` is true, all caches are cleared and the function returns immediately.
 * - If `embedFonts` is true, custom fonts are embedded (icon fonts are always embedded).
 * - If `preWarm` is true, common tag styles are pre-cached.
 *
 * @export
 * @param {Document|Element} [root=document] - The root node to search for resources (defaults to the whole document)
 * @param {Object} [options={}] - Pre-caching options
 * @param {boolean} [options.embedFonts=true] - Whether to embed custom fonts
 * @param {boolean} [options.reset=false] - Whether to clear all caches before pre-caching
 * @param {boolean} [options.preWarm=true] - Whether to pre-cache common tag styles
 * @returns {Promise<void>} Resolves when all resources are pre-cached
 */

export async function preCache(root = document, options = {}) {
  const { embedFonts = true, reset = false, preWarm = true } = options;
  if (reset) {
    imageCache.clear();
    bgCache.clear();
    resourceCache.clear();
    baseCSSCache.clear();
    computedStyleCache.clear();
    return;
  }

  await document.fonts.ready;
  precacheCommonTags();

  let imgEls = [], allEls = [];
  if (root?.querySelectorAll) {
    imgEls = Array.from(root.querySelectorAll('img[src]'));
    allEls = Array.from(root.querySelectorAll('*'));
  }

  const promises = [];
  for (const img of imgEls) {
    const src = img.src;
    if (!imageCache.has(src)) {
      promises.push(
        fetchImage(src)
          .then(dataURL => imageCache.set(src, dataURL))
          .catch(() => {})
      );
    }
  }
  for (const el of allEls) {
    const bg = getComputedStyle(el).backgroundImage;
    const url = extractUrl(bg);
    if (url && !bgCache.has(url)) {
      promises.push(
        fetchImage(url)
          .then(dataURL => bgCache.set(url, dataURL))
          .catch(() => {})
      );
    }
  }

  if (embedFonts) {
    await embedCustomFonts({ ignoreIconFonts: true, preCached: true });
  }

  await Promise.all(promises);
}
