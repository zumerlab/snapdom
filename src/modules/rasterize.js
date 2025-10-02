// src/exporters/rasterize.js
import { toCanvas } from '../exporters/toCanvas.js'
import { createBackground } from '../utils/index.js'

/**
 * Converts to an HTMLImageElement with raster format.
 * @param {string} url - Image data URL.
 * @param {object} options - Context including format and dpr.
 * @param {string} options.format - Output format ('png', 'jpeg', 'webp').
 * @param {number} options.dpr - Device pixel ratio.
 * @param {number} [options.quality] - Image quality for lossy formats.
 * @param {string} [options.backgroundColor] - Optional background color.
 * @returns {Promise<HTMLImageElement>} Resolves with the rasterized Image element.
 */
export async function rasterize(url, options) {
  const canvas = await toCanvas(url, options)
  const finalCanvas = options.backgroundColor
    ? createBackground(canvas, options.backgroundColor)
    : canvas

  const img = new Image()
  img.src = finalCanvas.toDataURL(`image/${options.format}`, options.quality)
  await img.decode()

  img.style.width = `${finalCanvas.width / options.dpr}px`
  img.style.height = `${finalCanvas.height / options.dpr}px`

  return img
}
