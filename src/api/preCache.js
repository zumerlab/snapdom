import { precacheCommonTags } from "../utils/cssTools";
import { fetchImage } from "../utils/helpers";
import { extractUrl } from "../utils/helpers";
import { embedCustomFonts } from "../modules/fonts";
import { imageCache, bgCache, resourceCache, baseCSSCache, computedStyleCache } from "../core/cache";
import { collectUsedTagNames, generateDedupedBaseCSS } from '../utils/cssTools';
import { inlinePseudoElements } from '../modules/pseudo';
import { prepareClone } from '../core/prepare';

/**
 *  Preload resources before capture
 *  WIP
 * @export
 * @param {*} [root=document]
 * @param {*} [options={}]
 * @return {*} 
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

  // Warming de CSS base para compress
  if (preWarm) {
    const usedTags = collectUsedTagNames(root).sort();
    const tagKey = usedTags.join(',');
    if (!baseCSSCache.has(tagKey)) {
      const css = generateDedupedBaseCSS(usedTags);
      baseCSSCache.set(tagKey, css);
    }

     const clone = root.cloneNode(false);
    // mapa vacío solo para calentar iconToImage, etc.
    await inlinePseudoElements(root, clone, new Map(), new WeakMap(), /* compress */ false);
  }

  if (preWarm) {
    try {
      // ejecuta una clonación para que deepClone/prepareClone se JIT-compile
      await prepareClone(root, /* compress: */ options.preWarm);
    } catch (e) {
    }
  }
}
