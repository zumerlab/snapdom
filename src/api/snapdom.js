import { capture } from '../core/capture';

/**
 * Captures an HTML element as an SVG data URL
 * and provides additional export formats.
 *
 * @param {Element} el - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {number} [options.scale=1] - Scale factor for the output image
 * @returns {Promise<string>} Promise that resolves to SVG data URL
 */

async function snapdom(element, options = {}) {
  return await capture(element, options);
}


/* 
snapdom.toSvg = async (el, opt = {}) => {
  const dataUrl = await capture(el, opt);
  const svgEncoded = dataUrl.split(',')[1];
  return decodeURIComponent(svgEncoded);
}; 
*/

snapdom.toImg = async (el, opt = {}) => {
  const url = await snapdom(el, opt);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
};

snapdom.toCanvas = async (el, opt = {}) => {
  const img = await snapdom.toImg(el, opt);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
};

snapdom.toPng = async (el, opt = {}) => {
  const canvas = await snapdom.toCanvas(el, opt);
  const img = new Image();
  img.src = canvas.toDataURL("image/png");
  await img.decode();
  return img;
};

snapdom.toJpg = async (el, opt = {}) => {
  const { backgroundColor = "#fff", quality = 0.92 } = opt;
  const canvas = await snapdom.toCanvas(el, opt);
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext("2d");
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(canvas, 0, 0);
  const img = new Image();
  img.src = temp.toDataURL("image/jpeg", quality);
  await img.decode();
  return img;
};

snapdom.toWebp = async (el, opt = {}) => {
  const { backgroundColor = "#fff", quality = 0.92 } = opt;
  const canvas = await snapdom.toCanvas(el, opt);
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext("2d");
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(canvas, 0, 0);
  const img = new Image();
  img.src = temp.toDataURL("image/webp", quality);
  await img.decode();
  return img;
};

snapdom.toBlob = async (el, opt = {}) => {
  const dataUrl = await snapdom(el, opt);
  const svgText = decodeURIComponent(dataUrl.split(',')[1]);
  return new Blob([svgText], { type: "image/svg+xml" });
};

export {
  snapdom
};
