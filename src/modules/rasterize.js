/**
 * PNG, JPEG and WebP export as an <img>: toCanvas, encode, load. The encode route is picked
 * by pixel count, see the note in `rasterize`. Pinned by
 * __tests__/exporters.rasterize.routes.test.js.
 * @module rasterize
 */
import { toCanvas } from '../exporters/toCanvas.js'
import { isSafari } from '../utils/browser'

/**
 * Rasterize a capture and hand it back as an <img> in the requested format.
 * @param {string|HTMLCanvasElement} url
 * @param {{ format:'png'|'jpeg'|'webp', dpr:number, quality?:number, backgroundColor?:string }} options
 * @param {import('../exporters/toCanvas.js').ExportEnv} [env]
 * @returns {Promise<HTMLImageElement>}
 */
export async function rasterize(url, options, env = {}) {
  const canvas = await toCanvas(url, options, { ...env, codec: options.format }) // backgroundColor, when set, is already flattened here

  // Two encode routes, by output size. toDataURL blocks the page for the whole encode
  // (~10.7ms/Mpx, 77ms at 7.2Mpx); toBlob encodes off the main thread but the FileReader trip
  // to a data: URL costs ~4ms more on a small canvas (category benchmark, 1200x800: 16.6ms
  // with toBlob, 12.8ms with toDataURL). Under the threshold the block is about one frame.
  // Move this number with a measurement, not a guess.
  const SYNC_ENCODE_MAX_PIXELS = 2e6
  const SYNC = (canvas.width * canvas.height) <= SYNC_ENCODE_MAX_PIXELS
  const dataURL = SYNC
    ? canvas.toDataURL(`image/${options.format}`, options.quality)
    : await new Promise((resolve) => {
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
  // A bare load fills naturalWidth/Height; decode() re-decodes what we just encoded (23.8ms
  // vs 8.5ms at 8.2Mpx). Safari keeps it: WebKit resolves load before paint-readiness
  // (#219770-class), and the Safari paths downstream assume decoded pixels.
  if (isSafari()) await img.decode()
  else {
    await new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth) return resolve()
      img.onload = resolve
      img.onerror = reject
    })
  }

  img.style.width = `${canvas.width / options.dpr}px`
  img.style.height = `${canvas.height / options.dpr}px`
  return img
}
