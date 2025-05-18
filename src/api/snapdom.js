import { captureDOM } from '../core/capture';

/**
 * Captures an HTML element as an SVG data URL
 * and provides additional export formats.
 *
 * @param {Element} el - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @returns {Promise<string>} Promise that resolves to SVG data URL
 * 
 *  options = {
 *   compress: true,
 *   fast: true,
 *   embedFonts: false,
 *   scale: 1,
 *   backgroundColor: "#fff",
 *   quality: 1
 *   }
 * 
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

 async function toBlob(url) {
  const svgText = decodeURIComponent(url.split(",")[1]);
  return new Blob([svgText], { type: "image/svg+xml" });
}

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

 async function toRasterImg(url, { dpr = 1, scale = 1, backgroundColor, quality }, format = "png") {
  const canvas = await createBackground(url, { dpr, scale }, backgroundColor);
  const img = new Image();
  img.src = canvas.toDataURL(`image/${format}`, quality);
  await img.decode();

  img.style.width = `${canvas.width / dpr}px`;
  img.style.height = `${canvas.height / dpr}px`;

  return img;
}

 async function download(url,{ dpr = 1, scale = 1, backgroundColor, format = "png", filename = "capture"} = {}) {
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

export async function snapdom(element, options = {}) {
  options = { scale: 1, ...options };
  if (!element) throw new Error("Element cannot be null or undefined");
  return await snapdom.capture(element, options);
}

snapdom.capture = async (el, options = {}) => {
  const url = await captureDOM(el, options);
  const dpr = window.devicePixelRatio || 1;
  const scale = options.scale || 1;

  return {
    url,
    options,
    toImg: () => toImg(url, { dpr, scale }),
    toCanvas: () => toCanvas(url, { dpr, scale }),
    toBlob: () => toBlob(url),
    toPng: () => toRasterImg(url, { dpr, scale }, "png"),
    toJpg: (opts) => toRasterImg(url, { dpr, scale, ...opts }, "jpeg"),
    toWebp: (opts) => toRasterImg(url, { dpr, scale, ...opts }, "webp"),
    download: ({ format = "png", filename = "capture", backgroundColor } = {}) => download(url, { dpr, scale, backgroundColor, format, filename})
  };
};

// Compatibilidad
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