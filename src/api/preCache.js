// src/api/preCache.js
import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage, precacheCommonTags, isSafari } from '../utils';
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js';
import { snapFetch } from '../modules/snapFetch.js';
import { cache, applyCachePolicy } from '../core/cache.js';
import { inlineBackgroundImages } from '../modules/background.js';

/**
 * Preloads images, background images, and (optionally) fonts into cache before DOM capture.
 * @param {Element|Document} [root=document]
 * @param {Object} [options={}]
 * @param {boolean} [options.embedFonts=true]
 * @param {'full'|'soft'|'auto'|'disabled'} [options.cache='full']
 * @param {string}  [options.useProxy=""]
 * @param {{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}[]} [options.localFonts=[]]
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.excludeFonts]
 * @returns {Promise<void>}
 */
export async function preCache(root = document, options = {}) {
  const {
    embedFonts = true,
    cacheOpt = 'full',
    useProxy = "",
  } = options;

  applyCachePolicy(cacheOpt);

  // No rompas en headless
  try { await document.fonts.ready; } catch {}

  // Warm de tags comunes (tu util ya aplica la política)
  precacheCommonTags();

  // ✅ styleCache en sesión (misma referencia que espera el test)
  cache.session = cache.session || {};
  if (!cache.session.styleCache) {
    cache.session.styleCache = new WeakMap();
  }

  // ✅ Llamada única a inlineBackgroundImages con root y styleCache compartido
  try {
    await inlineBackgroundImages(root, /* mirror */ undefined, cache.session.styleCache, { useProxy });
  } catch {
    // swallow cualquier error del warmup (reject o throw)
  }

  // ---- fallback fino por cada url(...) ya existente en el DOM ----
  let imgEls = [], allEls = [];
  try {
    if (root?.querySelectorAll) {
      imgEls = Array.from(root.querySelectorAll('img[src]'));
      allEls = Array.from(root.querySelectorAll('*'));
    }
  } catch {}

  const promises = [];

  for (const img of imgEls) {
    const src = img?.src;
    if (!src) continue;
    if (!cache.image.has(src)) {
      const p = Promise.resolve()
        .then(() => snapFetch(src, { as: 'dataURL',useProxy }))
        .then((dataURL) => { cache.image.set(src, dataURL); })
        .catch(() => {});
      promises.push(p);
    }
  }

  for (const el of allEls) {
    let bg = '';
    try { bg = getStyle(el).backgroundImage; } catch {}
    if (bg && bg !== 'none') {
      const parts = splitBackgroundImage(bg);
      for (const entry of parts) {
        if (entry.startsWith('url(')) {
          const p = Promise.resolve()
            .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
            .catch(() => {});
          promises.push(p);
        }
      }
    }
  }

  // ---- Fuentes (smart) ----
  if (embedFonts) {
    try {
      const required = collectUsedFontVariants(root);
      const usedCodepoints = collectUsedCodepoints(root);

      // ✅ isSafari es función (el test lo mockea con vi.fn)
      if (typeof isSafari === 'function' ? isSafari() : !!isSafari) {
        const families = new Set(
          Array.from(required)
            .map(k => String(k).split('__')[0])
            .filter(Boolean)
        );
        await ensureFontsReady(families, 2);
      }

      await embedCustomFonts({
        required,
        usedCodepoints,
        exclude: options.excludeFonts,
        localFonts: options.localFonts,
        useProxy: options.useProxy ?? useProxy,
      });
    } catch {
      // no rompas preCache por errores de fuentes
    }
  }

  await Promise.allSettled(promises);
}
