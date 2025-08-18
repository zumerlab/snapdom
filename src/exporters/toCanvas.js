// src/exporters/toCanvas.js
import { isSafari } from '../utils/browser';

/**
 * Converts a data URL to a Canvas element.
 * @param {string} url - The image data URL.
 * @param {object} options - Context including scale and dpr.
 * @param {number} options.scale - Scale factor for the image.
 * @param {number} options.dpr - Device pixel ratio for high DPI rendering.
 * @returns {Promise<HTMLCanvasElement>} Resolves with the rendered Canvas element.
 */
export async function toCanvas(url, options) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.loading = 'eager';
  img.decoding = 'sync';
  img.src = url;

  const isSafariBrowser = isSafari();
  let appended = false;

  if (isSafariBrowser) {
    document.body.appendChild(img);
    appended = true;
  }

  await img.decode();

  if (isSafariBrowser) await new Promise(resolve => setTimeout(resolve, 100));

  const width = img.naturalWidth * options.scale;
  const height = img.naturalHeight * options.scale;

  const canvas = document.createElement('canvas');
  const dpr = options.dpr;
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.drawImage(img, 0, 0, width, height);

  if (appended) img.remove();

  return canvas;
}
