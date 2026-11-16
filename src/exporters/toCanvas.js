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

// #425: browsers cap the image they will decode and the canvas they will back. Past either, a
// capture (element x scale x dpr, and dpr doubles on Retina) throws an opaque async
// "EncodingError" from img.decode(), so we clamp, downscale slightly and warn instead.
// 16384 is WebKit's side limit only. Chromium decodes an svg at 640x32768 and Gecko's canvas
// side limit is 32767, so a 16384 clamp there downscaled a 640x17298 page for nothing, and the
// clamp path is slower (500-row table: 5.2 ms/Mpx clamped against 3.1 ms/Mpx just under). The
// AREA cap still catches what a browser will not allocate.
// Pinned by __tests__/exporters.rasterLimit.test.js (skipped on webkit, which does cap at 16384).
export const MAX_RASTER_SIDE = isSafari() ? 16384 : 32767
export const MAX_RASTER_AREA = 16384 * 16384
// #536: WebP stores each side in 14 bits, so nothing encodes past 16383px. Chromium answers a
// larger canvas with "data:," from toDataURL and a truncated blob from toBlob. A canvas bound
// for WebP is clamped to it like any other limit.
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
 * The ink test for the Safari paint waits: six full-width strips of `img`, eight source rows
 * each, drawn at the scale of the real draw. Returns whether any pixel has alpha plus a pixel
 * signature, so a wait can tell when they stop changing. Null without a 2d context.
 *
 * Keep the draw's own scale. A 16x16 probe left WebKit caching its colour emoji at that size,
 * keyed by the URL, and every later draw lost them (Safari 27.0.1, d5's headings). Another
 * scale still costs sharpness (1155 coloured pixels against 1195 at 2x). No test iframe
 * reproduces it; the live parity check holds it (d5 on WebKit, `npm run test:parity`),
 * verified in Safari 27.0.1 on 2026-10-23.
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
 * WebKit paints svg-as-image resources late: img.decode() resolves before embedded
 * @font-face fonts (#219770) and nested raster images (#394) are ready, so the first draw
 * comes out blank or in a fallback font. Attach offscreen and probe until ink appears,
 * bounded. A blind two-frame wait cost ~33ms on every Safari export, and most have ink at
 * once. Svgs with fonts or nested images get the longer deadline and must read the same
 * twice; a truly blank capture runs out the short one.
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
    // With fonts or nested images, ink is not enough: text paints at once and a nested image
    // lands later (d449's iframe raster, 12 ms into the decode, Safari 27.0.1), so wait for two
    // equal reads in a row. Costs +10 to 25 ms on such an export in Safari (d5, d449). The
    // live parity check holds it (d449 on WebKit).
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

// Decode host for per-capture data URLs (from @frostin/snapdom, element-mirror).
// A browser keeps a cache entry for every image URL for the life of the document that fetched
// it, with no way to evict it, so a capture loop grows the renderer by one multi-MB data: URL
// per frame. blob: URLs are revocable, but Chromium taints a canvas that draws a foreignObject
// SVG from one. So the URLs stay data: and decode in a hidden throwaway iframe, recycled on a
// byte budget: its cached resources die with it.
// Recycle only while nothing is mid-decode: an image's pixels belong to its document, and
// tearing it down before the final drawImage pulls the bitmap away.
// Idle release: users and tab-suspender extensions report a leftover iframe as a leak, so it
// goes after DECODE_FRAME_IDLE_MS without a decode. An acquire cancels the timer and the
// release that reaches zero in flight re-arms it, so bursts and GIF/video frames keep one
// document. Recreating it after a gap costs 0-2 ms on the three engines (2026-10-17).
// Pinned by __tests__/exporter.toCanvas.decodeFrame.test.js.
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
      // Sandboxed or otherwise inert: fall back to the main document, which only costs the
      // old behaviour.
      try { frame.remove() } catch { /* already gone */ }
      return new Image()
    }
  }
  _decodeFrameBytes += src.length
  _decodeInFlight += 1
  const img = _decodeFrame.contentDocument.createElement('img')
  // Flagged rather than checked by ownerDocument at release: the Safari paint wait appends the
  // image to the main body, which adopts it into the main document, and the guard must still
  // be released for it.
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

// Chromium's svg-as-image draw is superlinear in destination size: the deep-tree bench
// (1232x13572, ~20k boxes) took 517 ms as one draw and 123 ms as 8 horizontal bands from the
// one decoded image into the same canvas (WebKit 71 to 15, Firefox flat). A 640x17298 table
// does not move, so the gate is area: one draw below 4 Mpx, above it a band per ~2 Mpx, at
// most 8 (16 was slower). Bands sit on whole device rows with the whole draw's scale, so only
// Chromium's own 256px tile seams can differ (68 of 16.7M pixels, one grey level).
// `crop` is not this: it re-decodes the svg per window.
// Every band re-reads the whole payload, ~1.8 ms per MB of embedded data: resources
// (chromium, 2026-09-03), so a 19 MB photo took 42 ms in one draw and 288 in eight. Bands stay
// off when the payload looks resource-dominated (resourceHeavy).
const BAND_MIN_AREA = 4e6
const BAND_AREA = 2e6
const MAX_BANDS = 8

const MARKUP_MARKS = ['%3C', '%3E', '%20', '%7B', '%7D', '%3B']
/**
 * Guess whether an encoded payload is mostly embedded data rather than markup: sample 200
 * 48-character windows and count those with no encoded markup delimiter. Not a parser on
 * purpose: a wrong guess only costs time, never content. Exact counting took 359 ms on 300
 * thumbnails (6.7 MB); the sample costs microseconds at any size.
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
 * Sizing: `width`/`height` are the output size in CSS px and win, `scale` applies only when
 * neither is set, `dpr` multiplies device pixels. `backgroundColor` is filled in the same
 * draw. `crop` windows the svg's viewBox before decode (svg payloads only, throws otherwise),
 * so a document exporter can go page by page. `canvas` draws into yours, saving a copy.
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

  // engine:'html-in-canvas' hands over the painted canvas, so nothing below decodes. A PNG
  // round trip instead cost 62 vs 4 ms on a card (2026-09-03), slower than the svg path.
  // The string-only guards below already pass a canvas through.
  const srcCanvas = (typeof HTMLCanvasElement !== 'undefined' && url instanceof HTMLCanvasElement) ? url : null

  // Peek the <svg> header (#425 clamp check) without decoding the payload; decode and
  // re-encode ONCE only when a crop, clamp or Safari shadow fix needs the text.
  // Must stay a data: URL: Chromium taints the canvas when a foreignObject SVG is drawn from a
  // blob: URL, and every toDataURL/toBlob export breaks.
  let src = url
  let shadowNaturalOnly = false
  let needsPaintVerify = false
  // A crop is a viewBox rewrite. Any other source would hand a document exporter the whole
  // bitmap where it asked for one page, so fail loudly.
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
          // A crop can turn an oversized source into a safe page-sized decode: clamp the
          // TRANSFORMED header, not the original full document.
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
    // Gecko swaps a new iframe's about:blank document asynchronously, aborting loads started
    // on it; by then the settled document is in place, so one retry lands. Acquire before
    // releasing: a release reaching zero after a tiled export asked to retire would remove
    // the settled frame and the retry would abort again in a fresh one.
    const failed = img
    img = acquireDecodeImage(src)
    releaseDecodeImage(failed)
    // Outside the try/finally below: a failed retry must release its guard, or the in-flight
    // count never reaches zero and the decode frame grows for the page's lifetime.
    try {
      await startDecode(img, src)
    } catch (retryErr) {
      releaseDecodeImage(img, env.retireDecodeFrame)
      throw retryErr
    }
  }

  try {
    // #506: Chromium resolves the decode before embedded fonts load; a microtask still paints
    // missing glyphs, so give it one task (a message, which timer clamps do not delay).
    // Firefox resolves it before a nested svg image not yet in its cache has parsed, and the
    // first export drew that layer blank; one task paints it (up to 40 nested svgs in 2.8 MB).
    // `.` skips the outer data:image/svg+xml at index 0. WebKit has its own ladder below.
    // Pinned by __tests__/exporter.toCanvas.nestedSvg.test.js.
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

    // Prefer the post-bleed viewBox (vbW/vbH) to the content box (w0/h0): an asymmetric
    // shadow, blur or outline under outerShadows changes the aspect ratio. A crop's decoded
    // bitmap is its own reference, or a one-sided crop takes the whole document's ratio.
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
    // The exporters that encode the canvas name the codec in `env.codec`; a plain
    // toCanvas() is held to the canvas limits only.
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
    // Positive CSS sizes may become subpixel after downscaling (e.g. a 1px divider at
    // scale: 0.5). Canvas truncates those to zero, producing null Blobs/data:, URLs.
    canvas.width = Math.max(1, outW * dpr)
    canvas.height = Math.max(1, outH * dpr)
    canvas.style.width = `${outW}px`
    canvas.style.height = `${outH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[SnapDOM] The canvas you passed has no 2D context (is it already used for WebGL?).')

    // #516: an export smaller than the device-pixel grid the svg laid out on (a download is dpr
    // 1, the grid the live devicePixelRatio) shrinks snapped borders below one output pixel,
    // and Firefox drops some edges (DPR 2.727: 1px boxes lost their sides at 1x; at DPR 1,
    // scale 0.5 lost 18 of 40 edges). Rasterize at the grid and resample. Chromium antialiases
    // and needs nothing. Pinned by __tests__/exporter.toCanvas.downscaledBorders.test.js.
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
      // save/restore hands the canvas back with an identity transform: a dpr scale left on it
      // put a caller's bitmap-pixel draws (a badge at canvas.width - 20) off a 2x canvas.
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
        // WebKit corrupts box-/text-shadows when the svg rasterizes at a non-natural
        // scale: render 1:1 first, then resample pixels (canvas→canvas draws never
        // re-rasterize the svg). Trades a bit of sharpness for correct shadows.
        const tmp = document.createElement('canvas')
        tmp.width = natW
        tmp.height = natH
        drawBanded(tmp.getContext('2d'), img, natW, natH, src)
        ctx.drawImage(tmp, 0, 0, outW, outH)
        /* c8 ignore stop */
      } else {
        // Device pixels, identity transform: the bands are cut on whole device rows, and the
        // dpr scale is folded into the destination size instead of the transform.
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (fine) {
          let tmp = document.createElement('canvas')
          tmp.width = fine.w
          tmp.height = fine.h
          drawBanded(tmp.getContext('2d'), img, fine.w, fine.h, src)
          // #516: bilinear resampling without mipmaps reads 2x2 source pixels per output
          // pixel, so past 2x it skips rows and columns and the 1-2px borders on them vanish.
          // Halve until the last draw is under 2x (100 bordered boxes at DPR 2.727: 15404 of
          // 98341 edge samples lost in one draw, 81 halved first).
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
      // #394, the other half: WebKit decodes a large nested raster ASYNCHRONOUSLY at a
      // subsampling level picked from the draw's scale, so the real draw can ask for a finer
      // level than the probe saw and paint blank until it lands (measured: probe ink, full
      // draw 0, both correct 100ms later). So probe AFTER the draw too: blank means wait and
      // redraw at the same scale. A check before the draw cannot see this. Pinned by the crop
      // case in __tests__/visual.fidelity.crossengine.test.js, which must stay the first
      // capture of that sprite in the page (the first decode is the trigger). Real Safari
      // 26.5.1, 2026-09-02: 100/100 captures identical.
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
