/**
 * Main API for snapDOM: capture DOM elements as SVG and raster images.
 * Provides utilities for exporting, downloading, and converting DOM captures.
 * @module snapdom
 */

import { captureDOM } from '../core/capture';
import { isSafari } from '../utils/helpers.js';
import { extendIconFonts } from '../modules/iconFonts.js';

/**
 * Converts an SVG data URL to an HTMLImageElement (vector).
 *
 * Note: This method returns a vector-based image (`img.src = data:image/svg+xml`)
 * and does NOT apply DPR-based scaling. Use `toPng` or `toCanvas` for raster output.
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.scale=1] - Optional visual scale (CSS size)
 * @returns {Promise<HTMLImageElement>} The resulting image
 */

async function toImg(url, { scale = 1 } = {}) {
  const img = new Image();
  img.src = url;
  await img.decode();

  if (scale !== 1) {
    img.style.width = `${img.naturalWidth * scale}px`;
    img.style.height = `${img.naturalHeight * scale}px`;
  }

  return img;
}

/**
 * Converts an SVG data URL to a Canvas element.
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @returns {Promise<HTMLCanvasElement>} The resulting canvas
 */

async function toCanvas(url, { dpr = 1, scale = 1 } = {}) {
  const img = new Image();
  img.src = url;
  img.crossOrigin = 'anonymous';
  img.loading = 'eager';
  img.decoding = 'sync';

  const isSafariBrowser = isSafari();
  if (isSafariBrowser) {
    document.body.appendChild(img);
  }

  await img.decode();

  if (isSafariBrowser) {
    await new Promise((resolve, reject) => {
      if (img.complete) resolve(null);
      const onLoad = () => {
        img.removeEventListener('load', onLoad);
        resolve(null);
      };
      const onError = () => {
        img.removeEventListener('error', onError);
        reject(new Error('Image failed to load'));
      };
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
    });
  }

  if (img.width === 0 || img.height === 0) {
    if (isSafariBrowser) img.remove();
    throw new Error('Image failed to load or has no dimensions');
  }

  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;

  const canvas = document.createElement('canvas');

  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');

  // Scale the context so drawing happens in logical pixels
  ctx.scale(dpr, dpr);

  // Draw using unscaled dimensions
  ctx.drawImage(img, 0, 0, width, height);

  if (isSafariBrowser) img.remove();

  return canvas;
}

/**
 * Converts a DOM snapshot (SVG data URL) into a Blob of the specified format.
 *
 * @param {string} url - SVG data URL
 * @param {Object} [options]
 * @param {string} [options.format="svg"] - Output format: "svg", "png", "jpeg", "webp"
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @param {string} [options.backgroundColor="#fff"] - Background for raster formats
 * @param {number} [options.quality] - JPEG/WebP quality (0–1)
 * @returns {Promise<Blob>} The resulting Blob
 */
async function toBlob(url, { type = 'svg', scale = 1, backgroundColor = '#fff', quality } = {}) {
  const mime =
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    }[type] || 'image/png';

  if (type === 'svg') {
    const svgText = decodeURIComponent(url.split(',')[1]);
    return new Blob([svgText], { type: 'image/svg+xml' });
  }

  const canvas = await createBackground(url, { dpr: 1, scale }, backgroundColor);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), `${mime}`, quality);
  });
}

/**
 * Creates a canvas with a background color from an SVG data URL.
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @param {string} [backgroundColor] - Background color to apply
 * @returns {Promise<HTMLCanvasElement>} The resulting canvas
 */

async function createBackground(url, { dpr = 1, scale = 1 }, backgroundColor) {
  const baseCanvas = await toCanvas(url, { dpr, scale });
  if (!backgroundColor) return baseCanvas;

  const temp = document.createElement('canvas');
  temp.width = baseCanvas.width;
  temp.height = baseCanvas.height;
  const ctx = temp.getContext('2d');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(baseCanvas, 0, 0);

  return temp;
}

/**
 * Converts an SVG data URL to a raster image (PNG, JPEG, WebP).
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @param {string} [options.backgroundColor="#fff"] - Background color for rasterization
 * @param {number} [options.quality] - Image quality (for JPEG/WebP)
 * @param {string} [format="png"] - Output format: "png", "jpeg", or "webp"
 * @returns {Promise<HTMLImageElement>} The resulting raster image
 */

async function toRasterImg(url, { dpr = 1, scale = 1, backgroundColor, quality }, format = 'png') {
  const defaultBg = ['jpg', 'jpeg', 'webp'].includes(format) ? '#fff' : undefined;
  const finalBg = backgroundColor ?? defaultBg;

  const canvas = await createBackground(url, { dpr, scale }, finalBg);

  const img = new Image();
  img.src = canvas.toDataURL(`image/${format}`, quality);
  await img.decode();

  img.style.width = `${canvas.width / dpr}px`;
  img.style.height = `${canvas.height / dpr}px`;

  return img;
}

/**
 * Downloads a captured image in the specified format.
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @param {string} [options.backgroundColor="#fff"] - Background color for rasterization
 * @param {string} [options.format="png"] - Output format
 * @param {string} [options.filename="capture"] - Download filename
 * @returns {Promise<void>} Resolves when download is triggered
 */

async function download(url, { dpr = 1, scale = 1, backgroundColor, format = 'png', filename = 'snapDOM' } = {}) {
  if (format === 'svg') {
    const blob = await toBlob(url);
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectURL;
    a.download = `${filename}.svg`;
    a.click();
    URL.revokeObjectURL(objectURL);
    return;
  }

  const defaultBg = ['jpg', 'jpeg', 'webp'].includes(format) ? '#fff' : undefined;
  const finalBg = backgroundColor ?? defaultBg;

  const canvas = await createBackground(url, { dpr, scale }, finalBg);
  const mime =
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    }[format] || 'image/png';

  const dataURL = canvas.toDataURL(mime);

  const a = document.createElement('a');
  a.href = dataURL;
  a.download = `${filename}.${format}`;
  a.click();
}

/**
 * Main entry point: captures a DOM element and returns an object with export methods.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @returns {Promise<Object>} Object with export methods (toRaw, toImg, toCanvas, etc.)
 */

export async function snapdom(element, options = {}) {
  options = { scale: 1, ...options };
  if (!element) throw new Error('Element cannot be null or undefined');
  if (options.iconFonts) {
    extendIconFonts(options.iconFonts);
  }
  return await snapdom.capture(element, options);
}

/**
 * Captures a DOM element and returns an object with export methods (internal use).
 *
 * @param {Element} el - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @returns {Promise<Object>} Object with export methods
 */

snapdom.capture = async (el, options = {}) => {
  const url = await captureDOM(el, options);
  const dpr = options.dpr ?? (window.devicePixelRatio || 1);
  const scale = options.scale || 1;

  return {
    url,
    options,
    toRaw: () => url,
    toImg: (opts = {}) => toImg(url, { dpr, scale, ...opts }),
    toCanvas: (opts = {}) => toCanvas(url, { dpr, scale, ...opts }),
    toBlob: (opts = {}) => toBlob(url, { dpr, scale, ...opts }),
    toPng: (opts = {}) => toRasterImg(url, { dpr, scale, ...opts }, 'png'),
    toJpg: (opts = {}) => toRasterImg(url, { dpr, scale, ...opts }, 'jpeg'),
    toWebp: (opts = {}) => toRasterImg(url, { dpr, scale, ...opts }, 'webp'),
    download: ({ format = 'png', filename = 'snapDOM', backgroundColor, ...opts } = {}) =>
      download(url, { dpr, scale, format, filename, backgroundColor, ...opts }),
  };
};

// Compatibilidad
snapdom.toRaw = async (el, options) => (await snapdom.capture(el, options)).toRaw();
snapdom.toImg = async (el, options) => (await snapdom.capture(el, options)).toImg();
snapdom.toCanvas = async (el, options) => (await snapdom.capture(el, options)).toCanvas();
snapdom.toBlob = async (el, options) => (await snapdom.capture(el, options)).toBlob(options);
snapdom.toPng = async (el, options) => (await snapdom.capture(el, options)).toPng(options);
snapdom.toJpg = async (el, options) => (await snapdom.capture(el, options)).toJpg(options);
snapdom.toWebp = async (el, options) => (await snapdom.capture(el, options)).toWebp(options);
snapdom.download = async (el, options = {}) => {
  const { format = 'png', filename = 'capture', backgroundColor, ...rest } = options;

  const capture = await snapdom.capture(el, rest);
  return await capture.download({ format, filename, backgroundColor });
};
