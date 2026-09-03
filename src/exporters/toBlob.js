/**
 * The Blob exporter. `svg` hands back the decoded svg text as a Blob with no raster step;
 * every other format goes through toCanvas and the canvas encoder.
 * @module exporters/toBlob
 */
import { toCanvas } from './toCanvas.js'

/**
 * Converts the rendered output to a Blob.
 * @param {string} url - Image data URL.
 * @param {object} options - Context including format and quality.
 * @param {string} [options.format='svg'] - Output format ('svg', 'png', 'jpeg', 'webp').
 *   `type` is the documented alias callers actually use (result.toBlob({type:'png'}));
 *   it is live API, not a compat shim. See __tests__/api.export.contract.test.js.
 * @param {number} [options.quality] - Image quality for lossy formats.
 * @param {string} [options.backgroundColor] - Optional background color.
 * @returns {Promise<Blob>} Resolves with the image Blob.
 */
export async function toBlob(url, options) {
  const format = options.format || options.type || 'svg'
  if (format === 'svg') {
    // An engine:'html-in-canvas' capture is raster from birth: base64-decoding its PNG and
    // labeling the bytes image/svg+xml would hand back a corrupt file. Fail with the reason.
    if (typeof HTMLCanvasElement !== 'undefined' && url instanceof HTMLCanvasElement) {
      throw new Error("[snapdom] toBlob: engine:'html-in-canvas' produces a raster capture; ask for png/jpeg/webp")
    }
    const svgText = decodeURIComponent(url.split(',')[1])
    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  const canvas = await toCanvas(url, options) // backgroundColor inline
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), `image/${format === 'jpg' ? 'jpeg' : format}`, options.quality)
  )
}
