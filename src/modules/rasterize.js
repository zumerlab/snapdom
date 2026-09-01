// src/exporters/rasterize.js
import { toCanvas } from '../exporters/toCanvas.js'
import { isSafari } from '../utils/browser'

/**
 * Converts to an HTMLImageElement with raster format.
 * @param {string} url
 * @param {{ format:'png'|'jpeg'|'webp', dpr:number, quality?:number, backgroundColor?:string }} options
 * @returns {Promise<HTMLImageElement>}
 */
export async function rasterize(url, options) {
  const canvas = await toCanvas(url, options) // backgroundColor ya aplicado si existe

  // Two encode routes, chosen by output size.
  //
  // toBlob encodes off the main thread, which is why it is here: the synchronous toDataURL
  // freezes the page for the whole encode, and on a large capture that is a visible stall
  // (measured: 41ms at 3.8Mpx, 77ms at 7.2Mpx, scaling linearly at ~10.7ms/Mpx).
  //
  // But it is not free. The blob has to be base64'd back through FileReader to satisfy the
  // data:-URL contract, and end to end that route costs ~4ms MORE than toDataURL on a small
  // canvas — enough to lose the category benchmark's 1200x800 scenario outright (16.6ms →
  // 12.8ms when switched, measured over three runs each). Below the threshold the block is
  // about one frame and nobody can see it, so take the faster route; above it, keep the page
  // responsive. Move this number with a measurement, not a guess.
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
  // A bare load is all the contract needs (naturalWidth/naturalHeight populated): decode()
  // here re-decodes the raster we JUST encoded — 23.8ms vs 8.5ms at 8.2Mpx, measured — and
  // the browser decodes lazily on first paint/draw anyway. Safari keeps the eager decode:
  // its image pipeline resolves load before paint-readiness (#219770-class), and the Safari
  // ceremonies downstream assume decoded pixels.
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
