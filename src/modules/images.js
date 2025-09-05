/**
 * Utilities for inlining <img> elements as data URLs or placeholders.
 * @module images
 */

import { fetchImage } from '../utils/helpers.js';


function setImgPlaceholder(img) {
  const dsW = parseInt(img.dataset?.snapdomWidth || '', 10) || 0;
  const dsH = parseInt(img.dataset?.snapdomHeight || '', 10) || 0;
  const attrW = parseInt(img.getAttribute('width') || '', 10) || 0;
  const attrH = parseInt(img.getAttribute('height') || '', 10) || 0;
  const styleW = parseFloat(img.style?.width || '') || 0;
  const styleH = parseFloat(img.style?.height || '') || 0;
  const w = dsW || styleW || attrW || img.width || 100;
  const h = dsH || styleH || attrH || img.height || 100;

  const fallback = document.createElement("div");
  fallback.style = `width: ${w}px; height: ${h}px; background: #ccc; display: inline-block; text-align: center; line-height: ${h}px; color: #666; font-size: 12px;`;
  fallback.innerText = "img";
  img.replaceWith(fallback);
}

/**
 * Converts all <img> elements in the clone to data URLs or replaces them with placeholders if loading fails.
 *
 * @param {Element} clone - Clone of the original element
 * @param {Object} [options={}] - Options for image processing
 * @returns {Promise<void>} Promise that resolves when all images are processed
 */
export async function inlineImages(clone, options = {}) {
  const imgs = Array.from(clone.querySelectorAll("img"));
  const processImg = async (img) => {
    if (!img.getAttribute('src')) {
      const eff = img.currentSrc || img.src || '';
      if (eff) img.setAttribute('src', eff);
    }
    
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    const src = img.src;
    try {
      const dataUrl = await fetchImage(src, { useProxy: options.useProxy });
      img.src = dataUrl;
      if (!img.width) img.width = img.naturalWidth || 100;
      if (!img.height) img.height = img.naturalHeight || 100;
    } catch {
      // Try defaultImageUrl (string or callback)
      const { defaultImageUrl } = options || {};
      if (defaultImageUrl) {
        try {
          const dsW = parseInt(img.dataset?.snapdomWidth || '', 10) || 0;
          const dsH = parseInt(img.dataset?.snapdomHeight || '', 10) || 0;
          const attrW = parseInt(img.getAttribute('width') || '', 10) || 0;
          const attrH = parseInt(img.getAttribute('height') || '', 10) || 0;
          const styleW = parseFloat(img.style?.width || '') || 0;
          const styleH = parseFloat(img.style?.height || '') || 0;
          const width = dsW || styleW || attrW || img.width || undefined;
          const height = dsH || styleH || attrH || img.height || undefined;

          const fallbackUrl = typeof defaultImageUrl === 'function'
            ? await defaultImageUrl({ width, height, src, element: img })
            : defaultImageUrl;

          if (fallbackUrl) {
            const fallbackData = await fetchImage(fallbackUrl, { useProxy: options.useProxy });
            img.src = fallbackData;
            if (!img.width && width) img.width = width;
            if (!img.height && height) img.height = height;
            if (!img.width) img.width = img.naturalWidth || 100;
            if (!img.height) img.height = img.naturalHeight || 100;
            return;
          }
        } catch {}
      }

      setImgPlaceholder(img);
    }
  };
  for (let i = 0; i < imgs.length; i += 4) {
    const group = imgs.slice(i, i + 4).map(processImg);
    await Promise.allSettled(group);
  }
}