// src/exporters/toBlob.js
import { toCanvas } from './toCanvas.js'

/**
 * Converts the rendered output to a Blob.
 * @param {string} url - Image data URL.
 * @param {object} options - Context including type and quality.
 * @param {string} options.type - Image type ('png', 'jpeg', 'webp', 'svg').
 * @param {number} [options.quality] - Image quality for lossy formats.
 * @param {string} [options.backgroundColor] - Optional background color.
 * @returns {Promise<Blob>} Resolves with the image Blob.
 */
export async function toBlob(url, options) {
  const type = options.type
  if (type === 'svg') {
    const svgText = decodeURIComponent(url.split(',')[1])
    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  const canvas = await toCanvas(url, options) // backgroundColor inline
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), `image/${type}`, options.quality)
  )
}
