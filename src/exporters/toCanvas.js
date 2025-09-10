// src/exporters/toCanvas.js
import { isSafari } from '../utils/browser';

/**
 * Converts a data URL to a Canvas element.
 * Safari: render offscreen in a per-call temporary slot to avoid flicker, then remove it.
 *
 * @param {string} url - The image data URL.
 * @param {{ scale: number, dpr: number }} options - Context including scale and dpr (already normalized upstream).
 * @returns {Promise<HTMLCanvasElement>} Resolves with the rendered Canvas element.
 */
export async function toCanvas(url, options) {
  const { scale, dpr } = options;
  // const safari = isSafari();

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.loading = 'eager';
  img.decoding = 'sync';
  img.src = url;

//  let tempSlot = null;
/*   if (safari) {
    tempSlot = document.createElement('div');
    tempSlot.setAttribute('aria-hidden', 'true');
    tempSlot.style.cssText =
      'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;' +
      'opacity:0;pointer-events:none;contain:size layout style;';
    document.body.appendChild(tempSlot);
    tempSlot.appendChild(img);
  } */

  await img.decode();
  /* if (safari) {
    await new Promise(r => setTimeout(r, 100));
  } */

  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (dpr !== 1) ctx.scale(dpr, dpr);
  ctx.drawImage(img, 0, 0, width, height);

  /* if (tempSlot && tempSlot.parentNode) {
    try { tempSlot.parentNode.removeChild(tempSlot); } catch { }
  } 
  */

  return canvas;
}
