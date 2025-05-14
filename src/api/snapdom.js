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

export async function snapdom(element, options = {}) {
  if (!element) {
    throw new Error('Element cannot be null or undefined');
  }
  return await captureDOM(element, options);
}
snapdom.toImg = async (el, options = {}) => {
  const url = await snapdom(el, options);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
};
snapdom.toCanvas = async (el, options = {}) => {
  const img = await snapdom.toImg(el, options);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
};
snapdom.toPng = async (el, options = {}) => {
  const canvas = await snapdom.toCanvas(el, options);
  const img = new Image();
  img.src = canvas.toDataURL("image/png");
  await img.decode();
  return img;
};
snapdom.toJpg = async (el, options = {}) => {
  const { backgroundColor = "#fff", quality = 1 } = options;
  const canvas = await snapdom.toCanvas(el, options);
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
snapdom.toWebp = async (el, options = {}) => {
  const { backgroundColor = "#fff", quality = 1 } = options;
  const canvas = await snapdom.toCanvas(el, options);
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
snapdom.toBlob = async (el, options = {}) => {
  const dataUrl = await snapdom(el, options);
  const svgText = decodeURIComponent(dataUrl.split(",")[1]);
  return new Blob([svgText], { type: "image/svg+xml" });
};
// advanced API - not tested
/* snapdom.capture = async (element, options = {}) => {
  const dataUrl = await snapdom(element, options);
  return {
    async toImg() {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      return img;
    },
    async toCanvas() {
      const img = await this.toImg();
      const canvas = document.createElement("canvas");
      const scale = window.devicePixelRatio || 1;
      const width =  img.width;
      const height = img.height;
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);
      
      return canvas;
    },
    async toPng() {
      const canvas = await this.toCanvas();
      const scale = window.devicePixelRatio || 1;
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = canvas.width;
      outputCanvas.height = canvas.height;
      outputCanvas.style.width = `${canvas.width / scale}px`;
      outputCanvas.style.height = `${canvas.height / scale}px`;
      
      const ctx = outputCanvas.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      
      const img = new Image();
      img.src = outputCanvas.toDataURL("image/png");
      await img.decode();

      img.style.width = `${canvas.width / scale}px`;
      img.style.height = `${canvas.height / scale}px`;
      
      return img;
    },
    async toJpg({ backgroundColor = "#fff", quality = 1 } = {}) {
      const canvas = await this.toCanvas();
      const scale = window.devicePixelRatio || 1;

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
      img.style.width = `${canvas.width / scale}px`;
      img.style.height = `${canvas.height / scale}px`;
      
      return img;
    },
    
    async toWebp({ backgroundColor = "#fff", quality = 0.95 } = {}) {
      const canvas = await this.toCanvas();
      const scale = window.devicePixelRatio || 1;
      
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
      
      img.style.width = `${canvas.width / scale}px`;
      img.style.height = `${canvas.height / scale}px`;
      
      return img;
    },
    async toBlob() {
      const svgText = decodeURIComponent(dataUrl.split(",")[1]);
      return new Blob([svgText], { type: "image/svg+xml" });
    }
  };
}; */
