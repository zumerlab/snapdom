// src/exporters/toImg.js
import { isSafari } from "../utils";
import { rasterize } from "../modules/rasterize";
/**
 * Converts a data URL to an HTMLImageElement.
 * @param {string} url - The data URL of the image.
 * @param {object} options - Context options including scale.
 * @param {number} [options.scale=1] - Scale factor for the image dimensions.
 * @returns {Promise<HTMLImageElement>} Resolves with the loaded Image element.
 */
export async function toImg(url, options) {
  const { scale = 1, width, height, meta = {} } = options;
  const hasW = Number.isFinite(width);
  const hasH = Number.isFinite(height);
  const wantsScale = (Number.isFinite(scale) && scale !== 1) || hasW || hasH;
  if (isSafari() && wantsScale) {
    const pngUrl = await rasterize(url, {...options, format: "png", quality: 1, meta});
   
    return pngUrl;
  }
const img = new Image();
  img.decoding = 'sync';
  img.loading = 'eager';
  img.src = url;
  await img.decode();
  if (hasW && hasH) {
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
  } else if (hasW) {
    const refW = Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth;
    const refH = Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight;
    const k = width / Math.max(1, refW);
    img.style.width = `${width}px`;
    img.style.height = `${Math.round(refH * k)}px`;
  } else if (hasH) {
    const refW = Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth;
    const refH = Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight;
    const k = height / Math.max(1, refH);
    img.style.height = `${height}px`;
    img.style.width = `${Math.round(refW * k)}px`;
  } else {
     const cssW = Math.round(img.naturalWidth * scale);
     const cssH = Math.round(img.naturalHeight * scale);
   img.style.width = `${cssW}px`;
   img.style.height = `${cssH}px`;
   if (typeof url === "string" && url.startsWith("data:image/svg+xml")) {
     try {
       const decoded = decodeURIComponent(url.split(",")[1]);
       const patched = decoded
         .replace(/width="[^"]*"/, `width="${cssW}"`)
         .replace(/height="[^"]*"/, `height="${cssH}"`);
       url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`;
       img.src = url;
     } catch {}
   }
 }
 return img;
}