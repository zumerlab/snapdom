/**
 * The download exporter: a capture saved to disk through an <a download> click, or on iOS
 * through the Web Share sheet. Pinned by __tests__/exporter.download.test.js.
 * @module exporters/download
 */
import { toBlob } from './toBlob.js'
import { toCanvas } from './toCanvas.js'
import { isIOS } from '../utils/browser.js'

/**
 * Offer the file through the Web Share sheet.
 *
 * On iOS the anchor download did not produce a file (#383), so the blob goes to the share
 * sheet first and the anchor is only the fallback when sharing is unavailable. A user who
 * cancels the sheet counts as handled: nothing else should pop up after that.
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
  // `format` is canonical. Deprecated `type` remains a compatibility alias, but only a
  // recognized image-format string may participate in download format selection.
  const IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'svg'])
  const rawType = (options?.type || '').toLowerCase()
  const typeAsFormat = IMAGE_FORMATS.has(rawType) ? rawType : ''
  const format = (options?.format || typeAsFormat || '').toLowerCase()
  const normalizedFormat = format === 'jpg' ? 'jpeg' : format || 'png'
  // `filename` is documented — and defaulted — as a name WITHOUT an extension, so a caller who
  // followed the docs (`{ filename: 'card' }`) got a file literally called `card`, which no OS
  // knows how to open. Supply the extension unless the name already carries one.
  const rawName = options?.filename || 'snapdom'
  const filename = /\.(png|jpe?g|webp|svg)$/i.test(rawName) ? rawName : `${rawName}.${normalizedFormat}`
  const nextOptions = { ...(options || {}), format: normalizedFormat, type: normalizedFormat }
  // A download is always dpr 1. The file has the capture's CSS size in pixels and does not
  // depend on the monitor it was captured on.
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
