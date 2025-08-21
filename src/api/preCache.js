// src/api/preCache.js

import { getStyle, inlineSingleBackgroundEntry, fetchImage, splitBackgroundImage, precacheCommonTags, isSafari } from '../utils';
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js';
import { cache } from '../core/cache.js';

/**
 * Preloads images, background images, and (optionally) fonts into cache before DOM capture.
 * - Never leaves unhandled rejections (uses catch / Promise.allSettled).
 * - Fonts are embedded in "smart" mode: only families/weights/styles/stretch actually used under `root`,
 *   further pruned by unicode-range intersection. Honors simple excludes from options.fontExclude.
 *
 * @param {Element|Document} [root=document]   - Subtree to analyze (only this subtree is scanned)
 * @param {Object} [options={}]
 * @param {boolean} [options.embedFonts=true]
 * @param {boolean} [options.reset=false]
 * @param {string}  [options.useProxy=""]
 * @param {Array<{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}>} [options.localFonts=[]]
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.fontExclude]
 * @returns {Promise<void>}
 */
export async function preCache(root = document, options = {}) {
  const {
    embedFonts = true,
    reset = false,
    useProxy = "",
  } = options;

  if (reset) {
    // Soft reset: clear all caches and computed styles
    cache.image.clear();
    cache.background.clear();
    cache.resource.clear();
    cache.defaultStyle.clear();
    cache.baseStyle.clear();
    cache.font.clear();
    cache.computedStyle = new WeakMap();
    return;
  }

  // Fonts readiness: don't crash in test/headless environments
  try { await document.fonts.ready; } catch {}

  // Common <img>/<link rel="icon">, etc.
  precacheCommonTags();

  // Collect elements inside root (bounded scan)
  let imgEls = [], allEls = [];
  try {
    if (root?.querySelectorAll) {
      imgEls = Array.from(root.querySelectorAll('img[src]'));
      allEls = Array.from(root.querySelectorAll('*'));
    }
  } catch { /* ignore */ }

  const promises = [];

  // <img src="..."> → cache as dataURL
  for (const img of imgEls) {
    const src = img?.src;
    if (!src) continue;
    if (!cache.image.has(src)) {
      const p = Promise.resolve()
        .then(() => fetchImage(src, { useProxy }))
        .then((dataURL) => { cache.image.set(src, dataURL); })
        .catch(() => {}); // swallow error to avoid bubbling
      promises.push(p);
    }
  }

  // background-image: url(...) in any element
  for (const el of allEls) {
    let bg = '';
    try { bg = getStyle(el).backgroundImage; } catch {}
    if (bg && bg !== 'none') {
      const bgSplits = splitBackgroundImage(bg);
      for (const entry of bgSplits) {
        if (entry.startsWith('url(')) {
          const p = Promise.resolve()
            .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
            .catch(() => {}); // swallow error
          promises.push(p);
        }
      }
    }
  }

  // Fonts (smart): collect only from the same subtree `root`
  if (embedFonts) {
    try {
      const required = collectUsedFontVariants(root);     // Set<string> family__weight__style__stretchPct
      const usedCodepoints = collectUsedCodepoints(root); // Set<number>
if (isSafari) {
 const families = new Set(
        Array.from(required)
          .map(k => String(k).split('__')[0])
          .filter(Boolean)
      );
      await ensureFontsReady(families, 2);
}
     
      // preCached=true injects the style now AND stores "fonts-embed-css" in cache.resource
      await embedCustomFonts({
        required,
        usedCodepoints,
        exclude: options.fontExclude,   // { families?, domains?, subsets? }
        preCached: true,
        localFonts: options.localFonts,
        useProxy: options.useProxy ?? useProxy,
      });
    } catch {
      // swallow font errors; don't fail preCache
    }
  }

  // Wait for non-font assets
  await Promise.allSettled(promises);
}
