/**
 * The image exporter: a capture's data URL as a sized <img>. Also exported as `toSvg`.
 *
 * The output is the capture's own svg, sized. On WebKit a scaled svg-as-image corrupts
 * shadows, so the svg text gets toCanvas's shadow rewrite and is sized to the display size;
 * a PNG raster steps in only when that fails.
 * @module exporters/toImg
 */
import { isSafari, debugWarn } from '../utils'
import { sessionWarn } from '../utils/debug.js'
import { rasterize } from '../modules/rasterize'
import { zoomSvgText, decodeSvgFromDataURL, encodeSvgToDataURL, patchSvgHeader } from './svgText.js'
import { fixSafariShadows } from './safariShadows.js'
/**
 * Load a capture's data URL into an <img> sized by the shared exporter rule.
 *
 * `width`/`height` win, `scale` applies when neither is set, and the aspect reference is the
 * post-bleed viewBox (`meta.vbW/vbH`), so an asymmetric bleed does not stretch the picture.
 * A `scale` patches the svg header before decode. The final URL must always finish decoding.
 * On Safari any scale or size takes the vector path above, falling back to a PNG.
 * Pinned by __tests__/exporter.toImg.test.js, __tests__/exporter.safariPaths.test.js and
 * __tests__/exporter.webkitLayerScale.test.js (the positioned-layer geometry of the vector path).
 * @param {string} url - the capture's data URL
 * @param {object} options
 * @param {number} [options.scale=1]
 * @param {number} [options.width] - output width in CSS px
 * @param {number} [options.height] - output height in CSS px
 * @param {object} [options.meta] - capture geometry from the svg engine (vbW/vbH, w0/h0)
 * @param {import('./toCanvas.js').ExportEnv} [env] - the PNG fallback warns through it and draws with it
 * @returns {Promise<HTMLImageElement>} decoded, with style.width/height set
 */
export async function toImg(url, options, env = {}) {
  const { scale = 1, width, height, meta = {} } = options
  const hasW = Number.isFinite(width)
  const hasH = Number.isFinite(height)
  const wantsScale = (Number.isFinite(scale) && scale !== 1) || hasW || hasH
  if (isSafari() && wantsScale) {
    // Stay VECTOR: WebKit's quirks at a non-natural scale are shadow quirks, so fix those in
    // the svg text and size the svg itself to the display size.
    try {
      const { svg } = await fixSafariShadows(decodeSvgFromDataURL(url))
      const head = (svg.match(/<svg\b[^>]*>/i) || [])[0] || ''
      const natW = parseFloat((head.match(/\bwidth="([\d.]+)/i) || [])[1])
      const natH = parseFloat((head.match(/\bheight="([\d.]+)/i) || [])[1])
      if (!Number.isFinite(natW) || !Number.isFinite(natH)) throw new Error('The SVG has no size.')
      const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : natW
      const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : natH
      let cssW, cssH
      if (hasW && hasH) { cssW = width; cssH = height }
      else if (hasW) { cssW = width; cssH = Math.max(1, Math.round(refH * (width / Math.max(1, refW)))) }
      else if (hasH) { cssH = height; cssW = Math.max(1, Math.round(refW * (height / Math.max(1, refH)))) }
      else { cssW = Math.max(1, Math.round(natW * scale)); cssH = Math.max(1, Math.round(natH * scale)) }
      // The viewBox goes to the output size and the clone is zoomed (zoomSvgText): a size
      // over the natural viewBox leaves every positioned layer at 1x (WebKit bug 23113).
      const patched = zoomSvgText(svg, cssW, cssH) || svg
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
      sessionWarn(env, 'safari-png-fallback', 'Safari vector toImg failed; using PNG', e)
      debugWarn(options, 'Safari couldn\'t show the SVG; used a PNG.', e)
      return rasterize(url, { ...options, format: 'png', quality: 1, meta }, env)
    }
  }
  // Resolve a scale from the header before loading, so a large payload decodes once at its
  // final size, patching the root tag in the URL when it can. SVGs with relative or missing
  // dimensions keep the measured fallback below.
  let source = url
  let scaledSvg = false
  if (!hasW && !hasH && scale !== 1 && typeof url === 'string' && url.startsWith('data:image/svg+xml')) {
    try {
      const rescale = head => {
        const w = Number((head.match(/\bwidth="([\d.]+)"/i) || [])[1])
        const h = Number((head.match(/\bheight="([\d.]+)"/i) || [])[1])
        if (!(w > 0 && h > 0)) return head
        scaledSvg = true
        return head.replace(/\bwidth="[^"]*"/i, `width="${Math.max(1, Math.round(w * scale))}"`)
          .replace(/\bheight="[^"]*"/i, `height="${Math.max(1, Math.round(h * scale))}"`)
      }
      const next = patchSvgHeader(url, rescale)
      if (next) source = next
      else {
        const svg = decodeSvgFromDataURL(url)
        const head = (svg.match(/<svg\b[^>]*>/i) || [])[0] || ''
        const resized = rescale(head)
        if (scaledSvg) source = encodeSvgToDataURL(svg.replace(head, resized))
      }
    } catch { /* resolve unusual inputs from the decoded image below */ }
  }
  const img = new Image()
  img.decoding = 'sync'
  img.loading = 'eager'
  img.src = source
  try { await img.decode() } catch (error) {
    if (!scaledSvg) throw error
    img.src = url
    scaledSvg = false
    await img.decode()
  }
  if (hasW && hasH) {
    img.style.width = `${width}px`
    img.style.height = `${height}px`
  } else if (hasW) {
    // Post-bleed viewBox, not w0/h0: an asymmetric bleed changes the aspect ratio.
    const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth
    const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight
    const k = width / Math.max(1, refW)
    img.style.width = `${width}px`
    img.style.height = `${Math.max(1, Math.round(refH * k))}px`
  } else if (hasH) {
    const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : img.naturalWidth
    const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : img.naturalHeight
    const k = height / Math.max(1, refH)
    img.style.height = `${height}px`
    img.style.width = `${Math.max(1, Math.round(refW * k))}px`
  } else {
    const cssW = Math.max(1, Math.round(img.naturalWidth * (scaledSvg ? 1 : scale)))
    const cssH = Math.max(1, Math.round(img.naturalHeight * (scaledSvg ? 1 : scale)))
    img.style.width = `${cssW}px`
    img.style.height = `${cssH}px`
    if (!scaledSvg && scale !== 1 && typeof url === 'string' && url.startsWith('data:image/svg+xml')) {
      try {
        const decoded = decodeURIComponent(url.split(',')[1])
        const patched = decoded
          .replace(/width="[^"]*"/, `width="${cssW}"`)
          .replace(/height="[^"]*"/, `height="${cssH}"`)
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`
        // Assigning src RESTARTS decoding: without this wait toSvg({scale}) returned an
        // image with `complete === false` that painted nothing when drawn at once.
        await img.decode()
      } catch (e) {
        debugWarn(options, 'Couldn\'t size the SVG image.', e)
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
