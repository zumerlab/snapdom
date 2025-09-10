// src/api/snapdom.js
import { captureDOM } from '../core/capture';
import { extendIconFonts } from '../modules/iconFonts.js';
import { createContext } from '../core/context';
import { toImg } from '../exporters/toImg.js';
import { toCanvas } from '../exporters/toCanvas.js';
import { toBlob } from '../exporters/toBlob.js';
import { rasterize } from '../modules/rasterize.js';
import { download } from '../exporters/download.js';
import { isSafari } from '../utils/browser.js';

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal');

let _safariWarmup = false;

/**
 * Main function that captures a DOM element and returns export utilities.
 * @param {HTMLElement} element - The DOM element to capture.
 * @param {object} userOptions - Options for rendering/exporting.
 * @returns {Promise<object>} Object with exporter methods:
 *   - url: The raw data URL
 *   - toRaw(): Gets raw data URL
 *   - toImg(): Converts to HTMLImageElement
 *   - toCanvas(): Converts to HTMLCanvasElement
 *   - toBlob(): Converts to Blob
 *   - toPng(): Converts to PNG format
 *   - toJpg(): Converts to JPEG format
 *   - toWebp(): Converts to WebP format
 *   - download(): Triggers file download
 */
export async function snapdom(element, userOptions) {
  if (!element) throw new Error('Element cannot be null or undefined');

  if (isSafari()) {
    for (let i = 0; i < 3; i++) {
      try {
         await safariWarmup(element, userOptions)
      console.log("Iteración número:", i);
      _safariWarmup = false
      } catch (error) {
        
      }
     
    }
  }
  const context = createContext(userOptions);
  /* c8 ignore next 1 */
  if (context.iconFonts && context.iconFonts.length > 0) extendIconFonts(context.iconFonts);

  if (!context.snap) {
    context.snap = {
      toPng: (el, opts) => snapdom.toPng(el, opts),
      toImg: (el, opts) => snapdom.toImg(el, opts),
    };
  }

  return snapdom.capture(element, context, INTERNAL_TOKEN);
}

/**
 * Internal capture method that returns helper methods for transformation/export.
 * @private
 * @param {HTMLElement} el - The DOM element to capture.
 * @param {object} context - Normalized context options.
 * @param {symbol} _token - Internal security token.
 * @returns {Promise<object>} Exporter functions.
 */
snapdom.capture = async (el, context, _token) => {
  /* v8 ignore next */
  if (_token !== INTERNAL_TOKEN) throw new Error('[snapdom.capture] is internal. Use snapdom(...) instead.');
  const url = await captureDOM(el, context);

  const ensureContext = (opts) => ({ ...context, ...(opts || {}) });
  const withFormat = (format) => (opts) => {
    const next = ensureContext({ ...(opts || {}), format });
    const wantsJpeg = format === 'jpeg' || format === 'jpg';
    const noBg = next.backgroundColor == null || next.backgroundColor === 'transparent';
    if (wantsJpeg && noBg) {
      next.backgroundColor = '#ffffff';
    }
    return rasterize(url, next);
  };

  return {
    url,
    toRaw: () => url,
    toImg: (opts) => toImg(url, ensureContext(opts)),
    toCanvas: (opts) => toCanvas(url, ensureContext(opts)),
    toBlob: (opts) => toBlob(url, ensureContext(opts)),
    toPng: withFormat('png'),
    toJpg: withFormat('jpeg'),
    toWebp: withFormat('webp'),
    download: (opts) => download(url, ensureContext(opts)),
  };
};

/**
 * Returns the raw data URL from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<string>} Raw data URL.
 */
snapdom.toRaw = (el, options) => snapdom(el, options).then(result => result.toRaw());

/**
 * Returns an HTMLImageElement from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} Loaded image element.
 */
snapdom.toImg = (el, options) => snapdom(el, options).then(result => result.toImg());

/**
 * Returns a Canvas element from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLCanvasElement>} Rendered canvas element.
 */
snapdom.toCanvas = (el, options) => snapdom(el, options).then(result => result.toCanvas());

/**
 * Returns a Blob from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<Blob>} Image blob.
 */
snapdom.toBlob = (el, options) => snapdom(el, options).then(result => result.toBlob());

/**
 * Returns a PNG image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} PNG image element.
 */
snapdom.toPng = (el, options) => snapdom(el, { ...options, format: 'png' }).then(result => result.toPng());

/**
 * Returns a JPEG image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} JPEG image element.
 */
snapdom.toJpg = (el, options) => snapdom(el, { ...options, format: 'jpeg' }).then(result => result.toJpg());

/**
 * Returns a WebP image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} WebP image element.
 */
snapdom.toWebp = (el, options) => snapdom(el, { ...options, format: 'webp' }).then(result => result.toWebp());

/**
 * Downloads the captured image in the specified format.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} options - Download options including filename.
 * @param {string} options.filename - Name for the downloaded file.
 * @param {string} [options.format='png'] - Image format ('png', 'jpeg', 'webp', 'svg').
 * @returns {Promise<void>}
 */
snapdom.download = (el, options) => snapdom(el, options).then(result => result.download());

/**
 * Force Safari to decode fonts and images by doing an offscreen pre-capture.
 * - Creates a tiny offscreen <img> using the SVG data URL from captureDOM.
 * - Awaits decoding and paints to a 1×1 canvas to ensure full decode/composite.
 *
 * @param {HTMLElement} element
 * @param {object} baseOptions - user options
 * @returns {Promise<void>}
 */
async function safariWarmup(element, baseOptions) {
  if (_safariWarmup) return;
  const preflight = {
    ...baseOptions,
    fast: true,
    embedFonts: true,
    scale: 0.2
  };

  let url;
  try {
    url = await captureDOM(element, preflight);
  } catch {
    // Even if captureDOM fails here, don’t block the real capture.
    return;
  }

  await new Promise((resolve) => {
    // Build offscreen <img> to force decoding
    const img = new Image();
     img.decoding = 'sync'; 
     img.loading = 'eager';
    img.style.position ='fixed';
    img.style.left = 0;
    img.style.top = 0;
    img.style.width = '10px';
    img.style.height = '10px';
    img.style.opacity = '0.01';
    img.style.transform = 'translateZ(10px)';
   img.style.willChange = 'transform,opacity;'; 
    img.src = url;

    const cleanup = async () => {
      await new Promise(r => setTimeout(r, 100));
      if (img && img.parentNode) img.parentNode.removeChild(img);
      _safariWarmup = true;
      resolve();
    };

    document.body.appendChild(img);
   cleanup()
  });
}
