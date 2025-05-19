/**
 * Main API for snapDOM: capture DOM elements as SVG and raster images.
 * Provides utilities for exporting, downloading, and converting DOM captures.
 * @module snapdom
 */

import { captureDOM } from '../core/capture';
import { isSafari } from '../utils/helpers.js';

/**
 * Converts an SVG data URL to an HTMLImageElement.
 *
 * @param {string} url - SVG data URL
 * @param {Object} options
 * @param {number} [options.dpr=1] - Device pixel ratio
 * @param {number} [options.scale=1] - Scale multiplier
 * @returns {Promise<HTMLImageElement>} The resulting image
 */

 async function toImg(url, { dpr = 1, scale = 1 }) {
  const img = new Image();
  img.src = url;
  await img.decode();
  if (isSafari) {
  img.width = img.width * scale ;
 img.height = img.height * scale ;
  } else {
    img.width = img.width / scale ;
 img.height = img.height / scale ;
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

 async function toCanvas(url, { dpr = 1, scale = 1 }) {
  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  const width = img.width * scale * dpr;
  const height = img.height * scale * dpr;

  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale * dpr, scale * dpr);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Converts an SVG data URL to a Blob.
 *
 * @param {string} url - SVG data URL
 * @returns {Promise<Blob>} The resulting SVG Blob
 */

 async function toBlob(url) {
  const svgText = decodeURIComponent(url.split(",")[1]);
  return new Blob([svgText], { type: "image/svg+xml" });
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

  const temp = document.createElement("canvas");
  temp.width = baseCanvas.width;
  temp.height = baseCanvas.height;
  const ctx = temp.getContext("2d");

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

 async function toRasterImg(url, { dpr = 1, scale = 1, backgroundColor =  "#fff", quality }, format = "png") {
  const canvas = await createBackground(url, { dpr, scale }, backgroundColor);
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

 async function download(url,{ dpr = 1, scale = 1, backgroundColor =  "#fff", format = "png", filename = "capture"} = {}) {
  if (format === "svg") {
    const blob = await toBlob(url);
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectURL;
    a.download = `${filename}.svg`;
    a.click();
    URL.revokeObjectURL(objectURL);
    return;
  }

  const defaultBg = ["jpg", "jpeg", "webp"].includes(format) ? "#fff" : undefined;
  const finalBg = backgroundColor ?? defaultBg;

  const canvas = await createBackground(url, { dpr, scale }, finalBg);
  const mime = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  }[format] || "image/png";

  const dataURL = canvas.toDataURL(mime);

  const a = document.createElement("a");
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
  if (!element) throw new Error("Element cannot be null or undefined");
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
  const dpr = window.devicePixelRatio || 1;
  const scale = options.scale || 1;

  return {
    url,
    options,
    toRaw: () => url,
    toImg: () => toImg(url, { dpr, scale }),
    toCanvas: () => toCanvas(url, { dpr, scale }),
    toBlob: () => toBlob(url),
    toPng: () => toRasterImg(url, { dpr, scale }, "png"),
    toJpg: (options) => toRasterImg(url, { dpr, scale, ...options }, "jpeg"),
    toWebp: (options) => toRasterImg(url, { dpr, scale, ...options }, "webp"),
    download: ({ format = "png", filename = "capture", backgroundColor } = {}) => download(url, { dpr, scale, backgroundColor, format, filename})
  };
};

// Compatibilidad
snapdom.toRaw = async (el, options) => (await snapdom.capture(el, options)).toRaw();
snapdom.toImg = async (el, options) => (await snapdom.capture(el, options)).toImg();
snapdom.toCanvas = async (el, options) => (await snapdom.capture(el, options)).toCanvas();
snapdom.toBlob = async (el, options) => (await snapdom.capture(el, options)).toBlob();
snapdom.toPng = async (el, options) => (await snapdom.capture(el, options)).toPng(options);
snapdom.toJpg = async (el, options) => (await snapdom.capture(el, options)).toJpg(options);
snapdom.toWebp = async (el, options) => (await snapdom.capture(el, options)).toWebp(options);
snapdom.download = async (el, options = {}) => {
  const {
    format = "png",
    filename = "capture",
    backgroundColor,
    ...rest
  } = options;

  const capture = await snapdom.capture(el, rest);
  return await capture.download({ format, filename, backgroundColor });
};