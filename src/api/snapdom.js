import { capture } from '../core/capture';

/**
 * Captures an HTML element as an SVG data URL
 * and provides additional export formats.
 *
 * @param {Element} el - DOM element to capture
 * @param {number} [scale=1] - Scale factor for the output image
 * @returns {Promise<string>} Promise that resolves to SVG data URL
 */
async function snapdom(el, scale = 1) {
  return await capture(el, scale);
}

snapdom.toImg = async function (el, scale = 1) {
  const dataURL = await snapdom(el, scale);
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  return img;
};

snapdom.toCanvas = async function (el, scale = 1) {
  const img = await snapdom.toImg(el, scale);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas;
};

snapdom.toPng = async function (el, scale = 1) {
  const canvas = await snapdom.toCanvas(el, scale);
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  await img.decode();
  return img;
};

snapdom.toJpg = async function (el, scale = 1, quality = 0.92) {
  const canvas = await snapdom.toCanvas(el, scale);
  const img = new Image();
  img.src = canvas.toDataURL('image/jpeg', quality);
  await img.decode();
  return img;
};

snapdom.toWebp = async function (el, scale = 1, quality = 0.92) {
  const canvas = await snapdom.toCanvas(el, scale);
  const img = new Image();
  img.src = canvas.toDataURL('image/webp', quality);
  await img.decode();
  return img;
};

snapdom.toBlob = async function (el, scale = 1) {
  const dataURL = await snapdom(el, scale);
  const svgXml = decodeURIComponent(dataURL.split(",")[1]);
  return new Blob([svgXml], { type: "image/svg+xml" });
};

export { snapdom };
