// src/exporters/download.js
import { toBlob } from './toBlob.js'
import { toCanvas } from './toCanvas.js'

/**
 * Triggers download of the generated image.
 * @param {string} url - Image data URL.
 * @param {object} options - Context including format, quality, filename.
 * @param {string} options.format - Output format ('png', 'jpeg', 'webp', 'svg').
 * @param {string} options.filename - Download filename.
 * @param {number} [options.quality] - Image quality for lossy formats.
 * @param {string} [options.backgroundColor] - Optional background color.
 * @returns {Promise<void>}
 */
export async function download(url, options) {
  options.dpr = 1
  if (options.format === 'svg') {
    const blob = await toBlob(url, { ...options, type: 'svg' })
    const objectURL = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectURL
    a.download = options.filename
    a.click()
    URL.revokeObjectURL(objectURL)
    return
  }

  const canvas = await toCanvas(url, options) // backgroundColor inline
  const a = document.createElement('a')
  a.href = canvas.toDataURL(`image/${options.format}`, options.quality)
  a.download = options.filename
  a.click()
}
