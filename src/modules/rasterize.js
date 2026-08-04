// src/exporters/rasterize.js
import { toCanvas } from '../exporters/toCanvas.js'

/**
 * Converts to an HTMLImageElement with raster format.
 * @param {string} url
 * @param {{ format:'png'|'jpeg'|'webp', dpr:number, quality?:number, backgroundColor?:string }} options
 * @returns {Promise<HTMLImageElement>}
 */
export async function rasterize(url, options) {
  const canvas = await toCanvas(url, options) // backgroundColor ya aplicado si existe

  // canvas.toBlob encodes off the main thread; the synchronous toDataURL blocked it for
  // hundreds of ms on large captures. img.src must remain a data: URL (public contract), so
  // the blob is base64'd via FileReader — cheap next to the codec work toBlob already did.
  const dataURL = await new Promise((resolve) => {
    /* c8 ignore start -- toBlob's null/error paths only fire on encoder failure or an
       unsupported mime, which no browser reaches for the formats we pass. The fallback
       exists so a quirky engine degrades instead of throwing; forcing it would assert on
       a mock, not on behavior. */
    const fallback = () => resolve(canvas.toDataURL(`image/${options.format}`, options.quality))
    /* c8 ignore stop */
    try {
      canvas.toBlob((blob) => {
        if (!blob) return fallback()
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || ''))
        fr.onerror = fallback
        fr.readAsDataURL(blob)
      }, `image/${options.format}`, options.quality)
    } catch { fallback() }
  })

  const img = new Image()
  img.src = dataURL
  await img.decode()

  img.style.width = `${canvas.width / options.dpr}px`
  img.style.height = `${canvas.height / options.dpr}px`
  return img
}
