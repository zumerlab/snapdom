// src/exporters/toImg.js
import { isSafari, debugWarn } from '../utils'
import { rasterize } from '../modules/rasterize'
import { fixSafariShadows, decodeSvgFromDataURL, encodeSvgToDataURL } from './toCanvas.js'
/**
 * Converts a data URL to an HTMLImageElement.
 * @param {string} url - The data URL of the image.
 * @param {object} options - Context options including scale.
 * @param {number} [options.scale=1] - Scale factor for the image dimensions.
 * @returns {Promise<HTMLImageElement>} Resolves with the loaded Image element.
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
       url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`
       img.src = url
     } catch (e) {
       debugWarn(options, 'SVG width/height patch in toImg failed', e)
     }
   }
 }
 return img
}

export { toImg as toSvg }
