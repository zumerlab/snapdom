/**
 * Rasterize a capture's data URL into a canvas.
 *
 * Every raster export (toPng, toBlob, download, rasterize) ends here. The svg URL is decoded
 * ONCE, in a hidden throwaway iframe so the browser's image cache dies with it, and drawn at
 * the requested size. The WebKit paths (shadow rewrite in safariShadows.js, paint probe,
 * natural-size draw) exist because svg-as-image is where Safari's quirks live, and run on no
 * other engine. SVG text edits live in svgText.js. Size limits and banding are per engine.
 * @module exporters/toCanvas
 */
import { isSafari, isFirefox } from '../utils/browser'
import { sessionWarn, debugWarn } from '../utils/debug.js'
import { isHTMLEl, isTag } from '../utils/helpers.js'
import { markInternalNode } from '../utils/ownership.js'
import { cropSvgText, isSvgDataURL, decodeSvgFromDataURL, peekSvgHeader, patchSvgHeader, encodeSvgToDataURL } from './svgText.js'
import { fixSafariShadows } from './safariShadows.js'

// #425: past the decode or canvas limit img.decode() throws an opaque "EncodingError", so we
// clamp and warn instead. 16384 is WebKit's side only: Chromium and Gecko go to 32767, and the
// clamp path is slower (500-row table: 5.2 ms/Mpx clamped, 3.1 ms/Mpx just under).
// Pinned by __tests__/exporters.rasterLimit.test.js (skipped on webkit, which does cap at 16384).
export const MAX_RASTER_SIDE = isSafari() ? 16384 : 32767
export const MAX_RASTER_AREA = 16384 * 16384
// #536: WebP stores each side in 14 bits; past 16383px Chromium returns "data:," or a
// truncated blob, so a canvas bound for WebP is clamped to it.
export const WEBP_MAX_SIDE = 16383

/**
 * Downscale SVG text whose intrinsic width/height exceed the decode limits.
 * The SVG carries a viewBox, so shrinking width/height just renders the same content at a
 * lower resolution (no clipping). Operates on decoded text (no re-encode round trips).
 * @param {string} svg - decoded svg text
 * @param {object} options - the export options, read for `debug`
 * @param {ExportEnv} env - its log takes the clamp warning
 * @returns {string}
 */
function clampSvgTextRasterSize(svg, options, env) {
  try {
    const head = svg.match(/<svg\b[^>]*>/i)
    if (!head) return svg
    const tag = head[0]
    const w = parseFloat((tag.match(/\bwidth="([\d.]+)/i) || [])[1])
    const h = parseFloat((tag.match(/\bheight="([\d.]+)/i) || [])[1])
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return svg
    const f = Math.min(1, MAX_RASTER_SIDE / w, MAX_RASTER_SIDE / h, Math.sqrt(MAX_RASTER_AREA / (w * h)))
    if (f >= 1) return svg
    const nw = Math.max(1, Math.floor(w * f))
    const nh = Math.max(1, Math.floor(h * f))
    sessionWarn(env, 'raster-clamp', `capture ${Math.round(w)}x${Math.round(h)}px exceeds decode limits; downscaled to ${nw}x${nh}px`)
    debugWarn(options,
      `${Math.round(w)}×${Math.round(h)}px is too large for the browser to draw; scaled down to ${nw}×${nh}px. For full size, export ${typeof CompressionStream === 'function' ? 'a PNG or JPEG' : 'a JPEG'} blob, an SVG, or crop.`
    )
    return svg.replace(tag, tag
      .replace(/(\bwidth=")[\d.]+/i, `$1${nw}`)
      .replace(/(\bheight=")[\d.]+/i, `$1${nh}`))
  } catch {
    return svg
  }
}

// rAF with a timeout fallback: WebKit suspends rAF in occluded windows and background
// tabs, and a capture must not hang there.
const frame = () => new Promise(r => { requestAnimationFrame(r); setTimeout(r, 50) })

/**
 * The ink test for the Safari paint waits: strips of `img` drawn at the real draw's scale,
 * returning ink and a pixel signature. Keep that scale: a 16x16 probe left WebKit caching its
 * colour emoji at that size and every later draw lost them (Safari 27.0.1, d5's headings).
 * No test reproduces it; the live parity check holds it (d5 on WebKit, `npm run test:parity`).
 * @param {HTMLImageElement} img - decoded, so its natural size is known
 * @param {number} kx - device pixels per source pixel of the real draw, across
 * @param {number} ky - the same, down
 */
function inkProbe(img, kx, ky) {
  const w = img.naturalWidth, h = img.naturalHeight
  const rows = Math.min(8, h)
  const probe = document.createElement('canvas')
  probe.width = Math.max(1, Math.ceil(w * kx))
  probe.height = Math.max(1, Math.ceil(rows * 6 * ky))
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  if (!pctx || !(w > 0 && h > 0)) return null
  return () => {
    pctx.clearRect(0, 0, probe.width, probe.height)
    for (let s = 0; s < 6; s++) {
      const y = Math.floor((h - rows) * s / 5)
      pctx.drawImage(img, 0, y, w, rows, 0, s * rows * ky, w * kx, rows * ky)
    }
    const d = pctx.getImageData(0, 0, probe.width, probe.height).data
    let ink = false, sig = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) ink = true
      sig = (sig * 31 + d[i - 3] + d[i - 2] * 7 + d[i - 1] * 13 + d[i]) | 0
    }
    return { ink, sig }
  }
}

/**
 * WebKit resolves img.decode() before embedded @font-face fonts (#219770) and nested raster
 * images (#394) paint, so the first draw is blank or in a fallback font. Probe until ink
 * appears, bounded; a blind two-frame wait cost ~33ms on every Safari export.
 * @param {HTMLImageElement} img
 * @param {boolean} verify - Svg has fonts/nested images (longer deadline, stable reads)
 * @param {(() => {ink: boolean, sig: number}) | null} probe - from inkProbe()
 * @returns {Promise<boolean>} whether ink was seen (false on deadline, or when unknowable)
 */
async function waitForImgPaint(img, verify, probe) {
  markInternalNode(img)
  img.style.cssText = 'position:fixed;left:-99999px;top:-99999px;pointer-events:none'
  document.body.appendChild(img)
  try {
    if (!probe) {
      await frame()
      await frame()
      return false
    }
    // With nested images first ink is not enough: d449's iframe raster lands 12 ms into the
    // decode (Safari 27.0.1). Two equal reads cost +10 to 25 ms. Held by live parity (d449).
    const deadline = performance.now() + (verify ? 600 : 150)
    let last = null
    for (;;) {
      let read
      try { read = probe() } catch { return false }
      if (read.ink && (!verify || read.sig === last)) return true
      last = read.sig
      if (performance.now() > deadline) return read.ink
      await frame()
    }
  } finally {
    try { img.remove() } catch { /* ok */ }
  }
}

// Decode host (from @frostin/snapdom). A document caches every image URL for life, so a capture
// loop grows the renderer by one data: URL per frame. blob: URLs would be revocable, but
// Chromium taints a canvas drawing a foreignObject SVG from one. So decode in a throwaway
// iframe, recycled on a byte budget. Pinned by __tests__/exporter.toCanvas.decodeFrame.test.js.
const DECODE_FRAME_BUDGET_BYTES = 24 * 1024 * 1024
const DECODE_FRAME_IDLE_MS = 5000
let _decodeFrame = null
let _decodeFrameBytes = 0
let _decodeInFlight = 0
let _retireDecodeFrame = false
let _decodeFrameIdleMs = DECODE_FRAME_IDLE_MS
let _decodeFrameIdleTimer = 0

/** Remove the decode frame; its document's cached resources go with it. */
function dropDecodeFrame() {
  clearTimeout(_decodeFrameIdleTimer)
  _decodeFrame?.remove()
  _decodeFrame = null
  _decodeFrameBytes = 0
}

/** Test-only: shorten the idle release so a test need not wait five seconds. */
export function __setDecodeFrameIdleMs(ms) {
  _decodeFrameIdleMs = ms ?? DECODE_FRAME_IDLE_MS
}

/** An <img> to decode `src` with, owned by the throwaway frame when there is one. */
function acquireDecodeImage(src) {
  if (typeof document === 'undefined' || !document.body) return new Image()
  clearTimeout(_decodeFrameIdleTimer)
  // The page may have torn the frame out from under us (anything that empties document.body);
  // a disconnected frame's document is gone with it.
  if (_decodeFrame && !_decodeFrame.contentDocument) {
    dropDecodeFrame()
  }
  // Never recycle mid-decode: the pixels belong to the frame's document until the last drawImage.
  if (_decodeFrame && _decodeFrameBytes > DECODE_FRAME_BUDGET_BYTES && _decodeInFlight === 0) {
    dropDecodeFrame()
  }
  if (!_decodeFrame) {
    const frame = document.createElement('iframe')
    markInternalNode(frame)
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      'position:absolute;left:-9999px;top:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
    try { document.body.appendChild(frame) } catch { /* detached document */ }
    if (frame.contentDocument) {
      _decodeFrame = frame
      _decodeFrameBytes = 0
    } else {
      // Sandboxed or inert: decode in the main document.
      try { frame.remove() } catch { /* already gone */ }
      return new Image()
    }
  }
  _decodeFrameBytes += src.length
  _decodeInFlight += 1
  const img = _decodeFrame.contentDocument.createElement('img')
  // A flag, not ownerDocument: the Safari paint wait adopts the image into the main document.
  img.__snapdomDecodeFrame = true
  return img
}

/** Release the guard; tiled file exports retire their decoded resources after drawing.
 *  A concurrent draw keeps the shared document alive until its own release. */
function releaseDecodeImage(img, retire = false) {
  if (!img || !img.__snapdomDecodeFrame) return
  img.__snapdomDecodeFrame = false
  _decodeInFlight = Math.max(0, _decodeInFlight - 1)
  if (retire) _retireDecodeFrame = true
  if (_decodeInFlight > 0) return
  if (_retireDecodeFrame) {
    _retireDecodeFrame = false
    dropDecodeFrame()
  } else {
    // Users and tab-suspender extensions report a leftover iframe as a leak. Bursts and video
    // frames keep one document; recreating it after a gap costs 0-2 ms (2026-10-17).
    _decodeFrameIdleTimer = setTimeout(dropDecodeFrame, _decodeFrameIdleMs)
  }
}

/** Start the decode of `src` on `image`. */
function startDecode(image, src) {
  image.loading = 'eager'
  image.decoding = 'sync'
  image.crossOrigin = 'anonymous'
  image.src = src
  return image.decode()
}

// Chromium's svg-as-image draw is superlinear in size: the deep-tree bench (1232x13572) took
// 517 ms as one draw and 123 ms as 8 bands of the same decoded image. Bands sit on whole
// device rows at the whole draw's scale, so only Chromium's 256px tile seams can differ
// (68 of 16.7M pixels). More than 8 bands was slower.
const BAND_MIN_AREA = 4e6
const BAND_AREA = 2e6
const MAX_BANDS = 8

const MARKUP_MARKS = ['%3C', '%3E', '%20', '%7B', '%7D', '%3B']
/**
 * Guess, from 200 sampled windows, whether a payload is mostly embedded data. Such a payload
 * draws in one piece: every band re-reads it, ~1.8 ms per MB (a 19 MB photo took 42 ms in one
 * draw, 288 in eight). A wrong guess costs only time; exact counting took 359 ms on 300
 * thumbnails (6.7 MB).
 * @param {string} src
 * @returns {boolean}
 */
function resourceHeavy(src) {
  if (typeof src !== 'string') return false
  const start = src.indexOf(',') + 1
  const step = Math.max(48, Math.floor((src.length - start) / 200))
  let windows = 0
  let clean = 0
  for (let i = start; i + 48 <= src.length; i += step) {
    const w = src.slice(i, i + 48)
    windows++
    if (!MARKUP_MARKS.some((m) => w.includes(m))) clean++
  }
  return clean * 2 > windows
}

/**
 * Draw `img` into `ctx` at devW x devH, in bands past the area gate above unless `src` is
 * resource-heavy. Pinned by __tests__/exporter.toCanvas.bands.test.js, where a one-row band
 * shift differs by 760k pixels and a 5.8 Mpx photo has to land in one call.
 * @param {CanvasRenderingContext2D} ctx - identity transform, device pixels
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {number} devW
 * @param {number} devH
 * @param {string|HTMLCanvasElement} src - what `img` was decoded from, for resourceHeavy
 */
function drawBanded(ctx, img, devW, devH, src) {
  // A canvas source (engine capture) is a linear blit: one draw.
  if (!img.naturalWidth) {
    ctx.drawImage(img, 0, 0, devW, devH)
    return
  }
  const area = devW * devH
  const bands = area > BAND_MIN_AREA && !resourceHeavy(src) ? Math.min(MAX_BANDS, Math.ceil(area / BAND_AREA)) : 1
  if (bands === 1) {
    ctx.drawImage(img, 0, 0, devW, devH)
    return
  }
  const natW = img.naturalWidth
  const k = img.naturalHeight / devH
  for (let i = 0; i < bands; i++) {
    const y0 = Math.round(i * devH / bands)
    const y1 = i === bands - 1 ? devH : Math.round((i + 1) * devH / bands)
    ctx.drawImage(img, 0, y0 * k, natW, (y1 - y0) * k, 0, y0, devW, y1 - y0)
  }
}

/**
 * What an export takes besides its options. buildResult builds the first three once per
 * result; toBlob, download and rasterize add `codec`, toLargeImage tiles add
 * `retireDecodeFrame`. Pinned by __tests__/exporter.toCanvas.decodeFrame.test.js
 * (retireDecodeFrame) and __tests__/exporter.toCanvas.downscaledBorders.test.js (layoutZoom).
 * @typedef {object} ExportEnv
 * @property {Array<{code: string, message: string, detail?: unknown}>|null} [warnings] - the capture's log
 * @property {number} [layoutZoom] - the grid of the Firefox fine draw (#516); tiles pass none
 * @property {{zoomed: string[], flat: string[]}|null} [fileSvg] - the layout-zoom wrappers (#552)
 * @property {string} [codec] - the format the canvas will be encoded to (WebP side limit, #536)
 * @property {boolean} [retireDecodeFrame] - drop the decode frame once this draw releases it
 */

/**
 * Rasterize a capture (svg data URL, or any image URL) into a canvas.
 *
 * `width`/`height` win over `scale`, `dpr` multiplies device pixels. `crop` windows an svg's
 * viewBox before decode and throws for anything else. `canvas` draws into yours.
 * @param {string} url
 * @param {{
 *   width?:number,
 *   height?:number,
 *   scale?:number,
 *   dpr?:number,
 *   meta?:object,
 *   canvas?:HTMLCanvasElement,
 *   crop?:{x:number,y:number,width:number,height:number},
 *   backgroundColor?: string
 * }} options
 * @param {ExportEnv} [env]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function toCanvas(url, options, env = {}) {
  let { width: optW, height: optH, scale = 1, dpr = 1, meta = {}, backgroundColor, crop = null } = options

  // engine:'html-in-canvas' hands over its painted canvas: nothing to decode. A PNG round trip
  // cost 62 vs 4 ms on a card (2026-09-03).
  const srcCanvas = (typeof HTMLCanvasElement !== 'undefined' && url instanceof HTMLCanvasElement) ? url : null

  // Decode the payload at most once, only for a crop, clamp or Safari shadow fix. Must stay a
  // data: URL: Chromium taints a canvas drawing a foreignObject SVG from a blob: URL.
  let src = url
  let shadowNaturalOnly = false
  let needsPaintVerify = false
  // A crop is a viewBox rewrite; anything else would return the whole page silently.
  if (crop && !isSvgDataURL(url)) {
    throw new RangeError('[SnapDOM] Only SVG captures can be cropped.')
  }
  if (isSvgDataURL(url)) {
    const head = (peekSvgHeader(url).match(/<svg\b[^>]*>/i) || [])[0] || ''
    const w = parseFloat((head.match(/\bwidth="([\d.]+)/i) || [])[1])
    const h = parseFloat((head.match(/\bheight="([\d.]+)/i) || [])[1])
    const oversized = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 &&
      Math.min(1, MAX_RASTER_SIDE / w, MAX_RASTER_SIDE / h, Math.sqrt(MAX_RASTER_AREA / (w * h))) < 1
    const safari = isSafari()
    if (crop || oversized || safari) {
      try {
        // Off WebKit both rewrites touch only the root tag, so the payload is never decoded.
        const patched = !safari && patchSvgHeader(url, tag => clampSvgTextRasterSize(crop ? cropSvgText(tag, crop, { shiftContent: false }) : tag, options, env))
        if (patched) src = patched
        else {
          let svgText = decodeSvgFromDataURL(url)
          if (crop) svgText = cropSvgText(svgText, crop)
          if (safari) {
            const fixed = await fixSafariShadows(svgText)
            svgText = fixed.svg
            shadowNaturalOnly = fixed.naturalOnly
            // WebKit paints embedded fonts and nested raster images late (#219770/#394);
            // only then is the verified-draw ladder worth waiting on.
            needsPaintVerify = /@font-face|data:image\//i.test(svgText)
          }
          // Clamp the cropped header, not the full document's.
          if (oversized || crop) svgText = clampSvgTextRasterSize(svgText, options, env) // #425: keep within decode limits
          src = encodeSvgToDataURL(svgText)
        }
      } catch (error) {
        if (crop) throw error
        src = url
      }
    }
  }

  // Owned by the decode frame and held until the last drawImage. A canvas source skips it and
  // the Safari paint waits, which would move the caller's canvas into the document body.
  let img = srcCanvas || acquireDecodeImage(src)
  try {
    if (!srcCanvas) await startDecode(img, src)
  } catch (e) {
    if (!img.__snapdomDecodeFrame) throw e
    // Gecko swaps a new iframe's about:blank asynchronously and aborts loads begun on it; one
    // retry lands. Acquire before releasing, or a pending retire drops the settled frame.
    const failed = img
    img = acquireDecodeImage(src)
    releaseDecodeImage(failed)
    // Outside the finally below: a failed retry must release, or the frame is never recycled.
    try {
      await startDecode(img, src)
    } catch (retryErr) {
      releaseDecodeImage(img, env.retireDecodeFrame)
      throw retryErr
    }
  }

  try {
    // One task (a message, never timer-clamped) before drawing. Chromium resolves the decode
    // before embedded fonts load, and a microtask still misses glyphs (#506). Firefox resolves
    // it before an uncached nested svg image parses and draws it blank. `.` skips the outer
    // data:image/svg+xml. Pinned by __tests__/exporter.toCanvas.nestedSvg.test.js.
    if (!srcCanvas && !isSafari() && isSvgDataURL(src) &&
      (isFirefox() ? /.data(?:%3A|:)image(?:%2F|\/)svg/i : /(?:%40|@)font-face/i).test(src)) {
      await new Promise(resolve => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          channel.port2.close()
          resolve()
        }
        channel.port2.postMessage(0)
      })
    }
    const natW = srcCanvas ? srcCanvas.width : img.naturalWidth
    const natH = srcCanvas ? srcCanvas.height : img.naturalHeight

    // The post-bleed viewBox, not w0/h0: an asymmetric bleed changes the aspect ratio. A crop
    // is its own reference, or a one-sided crop takes the document's ratio.
    const refW = crop ? natW
      : Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : natW
    const refH = crop ? natH
      : Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : natH

    let outW, outH
    const hasW = Number.isFinite(optW)
    const hasH = Number.isFinite(optH)

    if (hasW && hasH) {
      outW = Math.max(1, optW)
      outH = Math.max(1, optH)
    } else if (hasW) {
      const k = optW / Math.max(1, refW)
      outW = optW
      outH = refH * k
    } else if (hasH) {
      const k = optH / Math.max(1, refH)
      outH = optH
      outW = refW * k
    } else {
      // An html-in-canvas result is painted at scale*dpr but its meta is in CSS pixels: start
      // from the meta or each factor lands twice. A plain canvas keeps its natural size.
      const logicalCanvas = srcCanvas && Number.isFinite(meta.vbW) && Number.isFinite(meta.vbH)
      outW = logicalCanvas ? meta.vbW : natW
      outH = logicalCanvas ? meta.vbH : natH
    }

    // ONE sizing rule across every exporter (v3): scale only when no width or height is set.
    if (!hasW && !hasH) {
      outW = outW * scale
      outH = outH * scale
    }

    // #425: dpr (devicePixelRatio by default) can push a capture past the canvas cap; clamp
    // the whole draw, keeping the aspect ratio.
    const devW = outW * dpr, devH = outH * dpr
    const overCanvas = Math.max(devW / MAX_RASTER_SIDE, devH / MAX_RASTER_SIDE, Math.sqrt((devW * devH) / MAX_RASTER_AREA))
    // Encoding exporters name their codec in `env.codec`.
    const overWebp = env.codec === 'webp' ? Math.max(devW, devH) / WEBP_MAX_SIDE : 0
    const over = Math.max(overCanvas, overWebp)
    if (over > 1) {
      const byWebp = overCanvas <= 1
      sessionWarn(env, 'canvas-clamp', `output ${Math.round(devW)}x${Math.round(devH)}px exceeds ${byWebp ? 'WebP' : 'canvas'} limits; downscaled`)
      debugWarn(options, byWebp
        ? `${Math.round(devW)}×${Math.round(devH)}px is larger than WebP can encode (${WEBP_MAX_SIDE}px per side); scaled down. For full size, export a PNG, an SVG, or crop.`
        : `${Math.round(devW)}×${Math.round(devH)}px is larger than a canvas allows; scaled down. For full size, export ${typeof CompressionStream === 'function' ? 'a PNG or JPEG' : 'a JPEG'} blob, an SVG, or crop.`
      )
      outW /= over
      outH /= over
    }

    // The caller's canvas when given (from @frostin/snapdom) saves a copy per frame in a loop;
    // setting width/height clears it. No instanceof: an iframe's canvas has another realm.
    const canvas = (isHTMLEl(options.canvas) && isTag(options.canvas, 'canvas'))
      ? options.canvas
      : document.createElement('canvas')
    // A subpixel size (1px divider at scale 0.5) truncates to zero and encodes to null.
    canvas.width = Math.max(1, outW * dpr)
    canvas.height = Math.max(1, outH * dpr)
    canvas.style.width = `${outW}px`
    canvas.style.height = `${outH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[SnapDOM] The canvas you passed has no 2D context (is it already used for WebGL?).')

    // #516: below the layout grid (a download at DPR 2.727, or scale 0.5 at DPR 1) Firefox drops
    // edges of snapped borders, so rasterize at the grid and resample. Chromium antialiases.
    // Pinned by __tests__/exporter.toCanvas.downscaledBorders.test.js.
    let fine = null
    const grid = env.layoutZoom || 1
    if (!srcCanvas && isFirefox()) {
      const f = grid * refW / (outW * dpr)
      const fw = Math.round(outW * dpr * f), fh = Math.round(outH * dpr * f)
      if (f > 1.01 && fw <= MAX_RASTER_SIDE && fh <= MAX_RASTER_SIDE && fw * fh <= MAX_RASTER_AREA) fine = { w: fw, h: fh }
    }

    // The Safari paint waits probe at the scale the draw below will use (see inkProbe).
    const naturalOnly = shadowNaturalOnly && (Math.round(outW * dpr) !== natW || Math.round(outH * dpr) !== natH)
    const drawW = naturalOnly ? natW : fine ? fine.w : outW * dpr
    const drawH = naturalOnly ? natH : fine ? fine.h : outH * dpr
    const probe = isSafari() && !srcCanvas ? inkProbe(img, drawW / Math.max(1, natW), drawH / Math.max(1, natH)) : null
    let inkBefore = false
    if (probe) {
      inkBefore = await waitForImgPaint(img, needsPaintVerify, probe)
    }

    const paint = () => {
      // Hand the canvas back untransformed: a leftover dpr scale moved callers' pixel draws.
      ctx.save()
      if (dpr !== 1) ctx.scale(dpr, dpr)

      if (backgroundColor) {
        ctx.save()
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, outW, outH)
        ctx.restore()
      }

      if (naturalOnly) {
        /* c8 ignore start -- WebKit only (shadowNaturalOnly); coverage runs on chromium */
        // WebKit corrupts box-/text-shadows at a non-natural svg scale: draw 1:1, then
        // resample the pixels (a canvas-to-canvas draw never re-rasterizes the svg).
        const tmp = document.createElement('canvas')
        tmp.width = natW
        tmp.height = natH
        drawBanded(tmp.getContext('2d'), img, natW, natH, src)
        ctx.drawImage(tmp, 0, 0, outW, outH)
        /* c8 ignore stop */
      } else {
        // Identity transform: bands are cut on whole device rows.
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (fine) {
          let tmp = document.createElement('canvas')
          tmp.width = fine.w
          tmp.height = fine.h
          drawBanded(tmp.getContext('2d'), img, fine.w, fine.h, src)
          // #516: bilinear resampling past 2x skips whole rows and the borders on them, so
          // halve first (DPR 2.727: 15404 of 98341 edge samples lost in one draw, 81 halved).
          while (tmp.width > outW * dpr * 2) {
            const half = document.createElement('canvas')
            half.width = Math.ceil(tmp.width / 2)
            half.height = Math.ceil(tmp.height / 2)
            half.getContext('2d').drawImage(tmp, 0, 0, half.width, half.height)
            tmp = half
          }
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(tmp, 0, 0, outW * dpr, outH * dpr)
        } else {
          drawBanded(ctx, img, outW * dpr, outH * dpr, src)
        }
        ctx.restore()
      }
      ctx.restore()
    }
    paint()

    if (probe && inkBefore && needsPaintVerify) {
      // #394: WebKit decodes a large nested raster asynchronously at a level picked from the
      // draw's scale, so the real draw can come out blank where the probe had ink. Only a probe
      // AFTER the draw sees it; then wait and redraw at the same scale (real Safari 26.5.1:
      // 100/100 identical). Pinned by the crop case in
      // __tests__/visual.fidelity.crossengine.test.js, which must stay that sprite's first capture.
      let ink = true
      try { ink = probe().ink } catch { /* keep the draw */ }
      if (!ink) {
        /* c8 ignore start -- the WebKit paint race (#219770); the probe exists only on Safari */
        const deadline = performance.now() + 600
        do {
          await frame()
          try { ink = probe().ink } catch { break }
        } while (!ink && performance.now() < deadline)
        canvas.width = canvas.width // eslint-disable-line no-self-assign -- resets the bitmap and the transform
        paint()
        /* c8 ignore stop */
      }
    }
    return canvas
  } finally {
    releaseDecodeImage(img, env.retireDecodeFrame)
  }
}
