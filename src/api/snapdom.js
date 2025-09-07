// src/api/snapdom.js
import { captureDOM } from '../core/capture';
import { extendIconFonts } from '../modules/iconFonts.js';
import { createContext } from '../core/context';
import { toImg } from '../exporters/toImg.js';
import { toCanvas } from '../exporters/toCanvas.js';
import { toBlob } from '../exporters/toBlob.js';
import { rasterize } from '../modules/rasterize.js';
import { download } from '../exporters/download.js';

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal');

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

  const context = createContext(userOptions);

  if (context.iconFonts && context.iconFonts.length > 0) extendIconFonts(context.iconFonts);

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
  if (_token !== INTERNAL_TOKEN) {
    throw new Error('[snapdom.capture] is internal. Use snapdom(...) instead.');
  }
  const url = await captureDOM(el, context);

  const ensureContext = (opts) => ({ ...context, ...(opts || {}) });
  const withFormat = (format) => (opts) =>
    rasterize(url, ensureContext({ ...(opts || {}), format }));

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

// Compatibility methods — all normalize options through snapdom first

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

