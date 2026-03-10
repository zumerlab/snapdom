// src/exporters/download.js
import { toBlob } from './toBlob.js'
import { toCanvas } from './toCanvas.js'
import { isIOS } from '../utils/browser.js'

/**
 * Attempts to share a file via the Web Share API (iOS fallback).
 * @param {Blob} blob - The image blob.
 * @param {string} filename - The filename to share.
 * @returns {Promise<boolean>} True if share was handled (including user cancel), false if unavailable.
 */
async function shareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type })
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: filename })
  } catch (error) {
    if (error.name !== 'AbortError') return false
  }
  return true
}

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
  const foundIOS = isIOS()

  if (normalizedFormat === 'svg') {
    const blob = await toBlob(url, { ...nextOptions, type: 'svg' })
    if (foundIOS && await shareFile(blob, filename)) return
    const objectURL = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectURL
    a.download = filename
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(objectURL)
    a.remove()
    return
  }

  const canvas = await toCanvas(url, nextOptions) // backgroundColor inline

  if (foundIOS) {
    const mimeType = `image/${normalizedFormat}`
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, options?.quality))
    if (blob && await shareFile(blob, filename)) return
  }

  const a = document.createElement('a')
  a.href = canvas.toDataURL(`image/${normalizedFormat}`, options?.quality)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
