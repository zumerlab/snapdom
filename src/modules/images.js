/**
 * Utilities for inlining <img> elements as data URLs or placeholders.
 * @module images
 */

import { fetchImage } from '../utils/helpers.js';

/**
 * Converts all <img> elements in the clone to data URLs or replaces them with placeholders if loading fails.
 *
 * @param {Element} clone - Clone of the original element
 * @returns {Promise<void>} Promise that resolves when all images are processed
 */
export async function inlineImages(clone) {
  const imgs = Array.from(clone.querySelectorAll("img"));
  const processImg = async (img) => {
    const src = img.src;
    try {
      const dataUrl = await fetchImage(src);
      img.src = dataUrl;
      if (!img.width) img.width = img.naturalWidth || 100;
      if (!img.height) img.height = img.naturalHeight || 100;
    } catch {
      const fallback = document.createElement("div");
      fallback.style = `width: ${img.width || 100}px; height: ${img.height || 100}px; background: #ccc; display: inline-block; text-align: center; line-height: ${img.height || 100}px; color: #666; font-size: 12px;`;
      fallback.innerText = "img";
      img.replaceWith(fallback);
    }
  };
  for (let i = 0; i < imgs.length; i += 4) {
    const group = imgs.slice(i, i + 4).map(processImg);
    await Promise.allSettled(group);
  }
}