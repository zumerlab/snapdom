// src/exporters/toBlob.js
import { toCanvas } from './toCanvas.js'

/**
 * Converts the rendered output to a Blob.
 * @param {string} url - Image data URL.
 * @param {object} options - Context including format and quality.
 * @param {string} [options.format='svg'] - Output format ('svg', 'png', 'jpeg', 'webp').
 *   `type` is accepted as a legacy alias for direct callers.
 * @param {number} [options.quality] - Image quality for lossy formats.
 * @param {string} [options.backgroundColor] - Optional background color.
 * @returns {Promise<Blob>} Resolves with the image Blob.
 */
export async function toBlob(url, options) {
  const format = options.format || options.type || 'svg'
  if (format === 'svg') {
    const svgText = decodeURIComponent(url.split(',')[1])
    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  const canvas = await toCanvas(url, options) // backgroundColor inline
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), `image/${format === 'jpg' ? 'jpeg' : format}`, options.quality)
  )
}
