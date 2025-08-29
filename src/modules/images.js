/**
 * Utilities for inlining <img> elements as data URLs or placeholders.
 * @module images
 */

import { snapFetch } from './snapFetch.js';

/**
 * Converts all <img> elements in the clone to data URLs or replaces them with
 * placeholders if loading fails. Compatible with the new non-throwing snapFetch.
 *
 * - Success: result.ok === true && typeof result.data === 'string' (DataURL)
 * - Failure: any other case → replace <img> with a sized fallback <div>
 *
 * @param {Element} clone - Clone of the original element
 * @param {{ useProxy?: string }} [options={}] - Options for image processing
 * @returns {Promise<void>}
 */
export async function inlineImages(clone, options = {}) {
  const imgs = Array.from(clone.querySelectorAll('img'));

  /** @param {HTMLImageElement} img */
  const processImg = async (img) => {
    // Normalize src/srcset/sizes to a single concrete URL
    if (!img.getAttribute('src')) {
      const eff = img.currentSrc || img.src || '';
      if (eff) img.setAttribute('src', eff);
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');

    const src = img.src || '';
    if (!src) return;

    const r = await snapFetch(src, { as: 'dataURL', useProxy: options.useProxy });

    if (r.ok && typeof r.data === 'string' && r.data.startsWith('data:')) {
      // Success path: inline DataURL and ensure dimensions for layout fidelity
      img.src = r.data;
      if (!img.width)  img.width  = img.naturalWidth  || 100;
      if (!img.height) img.height = img.naturalHeight || 100;
      return;
    }

    // Failure path: sized, neutral fallback
    const w = img.width || img.naturalWidth || 100;
    const h = img.height || img.naturalHeight || 100;

    const fallback = document.createElement('div');
    // Mantener layout: inline-block con el mismo ancho/alto
    fallback.style.cssText = [
      `width:${w}px`,
      `height:${h}px`,
      'background:#ccc',
      'display:inline-block',
      'text-align:center',
      `line-height:${h}px`,
      'color:#666',
      'font-size:12px',
      'overflow:hidden',
    ].join(';');

    fallback.textContent = 'img';
    img.replaceWith(fallback);
  };

  // Procesar en lotes de 4 para balancear velocidad/fidelidad
  for (let i = 0; i < imgs.length; i += 4) {
    const group = imgs.slice(i, i + 4).map(processImg);
    await Promise.allSettled(group);
  }
}
