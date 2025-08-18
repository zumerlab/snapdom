import { getStyle, inlineSingleBackgroundEntry, fetchImage, splitBackgroundImage, precacheCommonTags } from '../utils';
import { embedCustomFonts } from '../modules/fonts.js';
import { cache } from '../core/cache.js';

/**
 * Preloads images, background images, and optionally fonts into cache before DOM capture.
 * Nunca deja promesas rechazadas sin manejar (evita unhandled rejections).
 */
export async function preCache(root = document, options = {}) {
  const { embedFonts = true, reset = false, useProxy } = options;

  if (reset) {
    // Resetea sin reasignar (los tests llaman cache.reset(), pero por si acaso)
   cache.image.clear(); 
   cache.background.clear(); 
   cache.resource.clear(); 
   cache.defaultStyle.clear(); 
   cache.baseStyle.clear(); 
   cache.font.clear(); 
   cache.computedStyle = new WeakMap(); 
    return;
  }

  // Fonts: no rompas el flujo si falla en tests/browser
  try { await document.fonts.ready; } catch {}

  precacheCommonTags();

  let imgEls = [], allEls = [];
  if (root?.querySelectorAll) {
    imgEls = Array.from(root.querySelectorAll('img[src]'));
    allEls = Array.from(root.querySelectorAll('*'));
  }

  const promises = [];

  // <img>
  for (const img of imgEls) {
    const src = img?.src;
    if (!src) continue;
    if (!cache.image.has(src)) {
      const p = Promise.resolve()
        .then(() => fetchImage(src, { useProxy }))
        .then((dataURL) => { cache.image.set(src, dataURL); })
        .catch(() => {}); // traga error para no propagar
      promises.push(p);
    }
  }

  // background-image
  for (const el of allEls) {
    let bg = '';
    try { bg = getStyle(el).backgroundImage; } catch {}
    if (bg && bg !== 'none') {
      const bgSplits = splitBackgroundImage(bg);
      for (const entry of bgSplits) {
        if (entry.startsWith('url(')) {
          const p = Promise.resolve()
            .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
            .catch(() => {}); // traga error
          promises.push(p);
        }
      }
    }
  }

  if (embedFonts) {
    try {await embedCustomFonts({ preCached: true, localFonts: options.localFonts, useProxy: options.useProxy })} catch {};
  }

  await Promise.allSettled(promises);
}
