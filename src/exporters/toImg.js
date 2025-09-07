// src/exporters/toImg.js
/**
 * Converts a data URL to an HTMLImageElement.
 * @param {string} url - The data URL of the image.
 * @param {object} options - Context options including scale.
 * @param {number} [options.scale=1] - Scale factor for the image dimensions.
 * @returns {Promise<HTMLImageElement>} Resolves with the loaded Image element.
 */
export async function toImg(url, options) {
  const img = new Image();
  img.src = url;
  await img.decode();

  if (options.scale !== 1) {
    img.style.width = `${img.naturalWidth * options.scale}px`;
    img.style.height = `${img.naturalHeight * options.scale}px`;
  }

  return img;
}