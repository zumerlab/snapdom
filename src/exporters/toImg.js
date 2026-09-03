/**
 * The image exporter: a capture's data URL as a sized <img>. Also exported as `toSvg`.
 *
 * The output is the capture's own svg, sized, never a PNG of it. On WebKit that takes work:
 * a scaled svg-as-image corrupts shadows, so the svg text gets the same shadow rewrite
 * toCanvas uses and its own width/height patched to the display size, and only when that
 * fails does the PNG raster step in.
 * @module exporters/toImg
 */
import { isSafari, debugWarn } from '../utils'
import { sessionWarn } from '../utils/debug.js'
import { rasterize } from '../modules/rasterize'
import { fixSafariShadows, decodeSvgFromDataURL, encodeSvgToDataURL } from './toCanvas.js'
/**
 * Load a capture's data URL into an <img> sized by the shared exporter rule.
 *
 * `width`/`height` win, `scale` applies when neither is set, and the aspect reference is the
 * post-bleed viewBox (`meta.vbW/vbH`) rather than the element box, so an asymmetric
 * outerShadows bleed does not stretch the picture. With `scale` the svg's own width/height
 * are patched too, and the image is decoded AGAIN after that write: assigning src restarts
 * decoding, and the first decode says nothing about the new one. On Safari any scale or size
 * runs the vector path described above, with PNG rasterize as its error fallback.
 * Pinned by __tests__/exporter.toImg.test.js and __tests__/exporter.safariPaths.test.js.
 * @param {string} url - the capture's data URL
 * @param {object} options
 * @param {number} [options.scale=1]
 * @param {number} [options.width] - output width in CSS px
 * @param {number} [options.height] - output height in CSS px
 * @param {object} [options.meta] - capture geometry from the svg engine (vbW/vbH, w0/h0)
 * @returns {Promise<HTMLImageElement>} decoded, with style.width/height set
 */
export async function toImg(url, options) {
  const { scale = 1, width, height, meta = {} } = options
  const hasW = Number.isFinite(width)
  const hasH = Number.isFinite(height)
  const wantsScale = (Number.isFinite(scale) && scale !== 1) || hasW || hasH
  if (isSafari() && wantsScale) {
    // Keep the export VECTOR instead of rasterizing to PNG: WebKit's svg-as-image quirks
    // at non-natural scale are shadow quirks — fix those in the svg text (same rewrite
    // toCanvas uses) and patch the svg's OWN width/height to the display size, so it
    // renders at its natural scale and stays an SVG.
    try {
      const { svg } = await fixSafariShadows(decodeSvgFromDataURL(url))
      const head = (svg.match(/<svg\b[^>]*>/i) || [])[0] || ''
      const natW = parseFloat((head.match(/\bwidth="([\d.]+)/i) || [])[1])
      const natH = parseFloat((head.match(/\bheight="([\d.]+)/i) || [])[1])
      if (!Number.isFinite(natW) || !Number.isFinite(natH)) throw new Error('svg without dimensions')
      const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : natW
      const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : natH
      let cssW, cssH
      if (hasW && hasH) { cssW = width; cssH = height }
      else if (hasW) { cssW = width; cssH = Math.round(refH * (width / Math.max(1, refW))) }
      else if (hasH) { cssH = height; cssW = Math.round(refW * (height / Math.max(1, refH))) }
      else { cssW = Math.round(natW * scale); cssH = Math.round(natH * scale) }
      const patched = svg
        .replace(/width="[^"]*"/, `width="${cssW}"`)
        .replace(/height="[^"]*"/, `height="${cssH}"`)
      const img = new Image()
      img.decoding = 'sync'
      img.loading = 'eager'
      img.src = encodeSvgToDataURL(patched)
      await img.decode()
      img.style.width = `${cssW}px`
      img.style.height = `${cssH}px`
      return img
    } catch (e) {
      sessionWarn(options.__session, 'safari-png-fallback', 'safari vector toImg failed, falling back to PNG raster', e)
      debugWarn(options, 'safari vector toImg failed, falling back to PNG', e)
      return rasterize(url, { ...options, format: 'png', quality: 1, meta })
    }
  }
  const img = new Image()
  img.decoding = 'sync'
  img.loading = 'eager'
  img.src = url
  await img.decode()
  if (hasW && hasH) {
    img.style.width = `${width}px`
    img.style.height = `${height}px`
  } else if (hasW) {
    // Prefer the rasterized viewBox (vbW/vbH, post-bleed) over the pre-bleed
    // content box (w0/h0): under outerShadows an asymmetric shadow/blur/outline
    // bleeds unevenly, so w0/h0's aspect ratio no longer matches the actual
    // rasterized image and stretches it.
    const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth
    const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight
    const k = width / Math.max(1, refW)
    img.style.width = `${width}px`
    img.style.height = `${Math.round(refH * k)}px`
  } else if (hasH) {
    const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth
    const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight
    const k = height / Math.max(1, refH)
    img.style.height = `${height}px`
    img.style.width = `${Math.round(refW * k)}px`
  } else {
    const cssW = Math.round(img.naturalWidth * scale)
    const cssH = Math.round(img.naturalHeight * scale)
    img.style.width = `${cssW}px`
    img.style.height = `${cssH}px`
    if (typeof url === 'string' && url.startsWith('data:image/svg+xml')) {
      try {
        const decoded = decodeURIComponent(url.split(',')[1])
        const patched = decoded
          .replace(/width="[^"]*"/, `width="${cssW}"`)
          .replace(/height="[^"]*"/, `height="${cssH}"`)
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`
        // Assigning src RESTARTS decoding. The decode() above settled for the ORIGINAL
        // url and says nothing about this one, so toSvg({scale}) handed back an image
        // with `complete === false`: drawing it in the same tick — exactly what an
        // exporter or a caller does — painted nothing.
        await img.decode()
      } catch (e) {
        debugWarn(options, 'SVG width/height patch in toImg failed', e)
        // Hand back something drawable: the original url already decoded once.
        if (img.src !== url) {
          img.src = url
          await img.decode().catch(() => {})
        }
      }
    }
  }
  return img
}

/** toSvg is the same function: the output is the svg either way. */
export { toImg as toSvg }
