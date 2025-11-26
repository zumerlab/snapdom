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
  const format = (options?.format || options?.type || '').toLowerCase()
  const normalizedFormat = format === 'jpg' ? 'jpeg' : format || 'png'
  const filename = options?.filename || `snapdom.${normalizedFormat}`
  const nextOptions = { ...(options || {}), format: normalizedFormat, type: normalizedFormat }
  nextOptions.dpr = 1

  if (normalizedFormat === 'svg') {
    const blob = await toBlob(url, { ...nextOptions, type: 'svg' })
    const objectURL = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectURL
    a.download = filename
    a.click()
    URL.revokeObjectURL(objectURL)
    return
  }

  const canvas = await toCanvas(url, nextOptions) // backgroundColor inline
  const a = document.createElement('a')
  a.href = canvas.toDataURL(`image/${normalizedFormat}`, options?.quality)
  a.download = filename
  a.click()
}
