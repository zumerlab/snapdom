// src/exporters/toCanvas.js
import { isSafari } from '../utils/browser'
import { sessionWarn } from '../utils/debug.js'

// #425: browsers cap how large an image they will decode and how large a canvas they
// will back. Chrome/Firefox reject > 16384px on a side and a total decoded-image area
// (~268M px). An oversized capture (large element × scale × dpr — and dpr silently
// doubles on Retina) throws an opaque async "EncodingError: The source image cannot be
// decoded" deep in img.decode(). We clamp instead so the capture still succeeds (slightly
// downscaled) and warn, naming the knobs to adjust.
const MAX_RASTER_SIDE = 16384
const MAX_RASTER_AREA = 16384 * 16384

/**
 * Downscale SVG text whose intrinsic width/height exceed the decode limits.
 * The SVG carries a viewBox, so shrinking width/height just renders the same content at a
 * lower resolution (no clipping). Operates on decoded text (no re-encode round trips).
 * @param {string} svg @returns {string}
 */
function clampSvgTextRasterSize(svg, session) {
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
    sessionWarn(session, 'raster-clamp', `capture ${Math.round(w)}x${Math.round(h)}px exceeds decode limits; downscaled to ${nw}x${nh}px`)
    console.warn(
      `[snapDOM] Capture ${Math.round(w)}×${Math.round(h)}px exceeds the browser image-decode ` +
      `limit (${MAX_RASTER_SIDE}px/side); downscaling to ${nw}×${nh}px. Lower \`scale\` or set ` +
      '`width`/`height` to control output size.'
    )
    return svg.replace(tag, tag
      .replace(/(\bwidth=")[\d.]+/i, `$1${nw}`)
      .replace(/(\bheight=")[\d.]+/i, `$1${nh}`))
  } catch {
    return svg
  }
}

/**
 * Window an SVG before decode. The crop is expressed in the serialized SVG's viewBox
 * coordinates (result.meta), so a document exporter can rasterize a long capture page by
 * page instead of allocating one bitmap past the browser decode limits.
 * @param {string} svg @param {{x:number,y:number,width:number,height:number}} crop
 * @returns {string}
 */
function cropSvgText(svg, crop) {
  const nums = ['x', 'y', 'width', 'height'].map(k => Number(crop?.[k]))
  if (!nums.every(Number.isFinite) || nums[2] <= 0 || nums[3] <= 0) {
    throw new RangeError('[snapdom] canvas crop requires finite x/y and positive width/height')
  }
  const head = svg.match(/<svg\b[^>]*>/i)
  if (!head) throw new Error('[snapdom] cannot crop a non-SVG capture')
  const tag = head[0]
  const vb = (tag.match(/\bviewBox="([^"]+)"/i) || [])[1]
  const parts = String(vb || '').trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error('[snapdom] cannot crop an SVG without a finite viewBox')
  }
  const [vx, vy, vw, vh] = parts
  const left = Math.max(vx, nums[0])
  const top = Math.max(vy, nums[1])
  const right = Math.min(vx + vw, nums[0] + nums[2])
  const bottom = Math.min(vy + vh, nums[1] + nums[3])
  if (!(right > left) || !(bottom > top)) {
    throw new RangeError('[snapdom] canvas crop does not intersect the SVG viewBox')
  }
  // The header's width/height may already be a scaled output size: keep that density so a
  // page slice rasterizes at the same resolution as the whole capture would.
  const attrW = parseFloat((tag.match(/\bwidth="([\d.]+)/i) || [])[1])
  const attrH = parseFloat((tag.match(/\bheight="([\d.]+)/i) || [])[1])
  const densityX = Number.isFinite(attrW) && attrW > 0 ? attrW / vw : 1
  const densityY = Number.isFinite(attrH) && attrH > 0 ? attrH / vh : 1
  const width = Math.max(1, (right - left) * densityX)
  const height = Math.max(1, (bottom - top) * densityY)
  const next = tag
    .replace(/(\bwidth=")[^"]*/i, `$1${width}`)
    .replace(/(\bheight=")[^"]*/i, `$1${height}`)
    .replace(/(\bviewBox=")[^"]*/i, `$1${left} ${top} ${right - left} ${bottom - top}`)
  return svg.replace(tag, next)
}

/**
 * Converts a data URL to a Canvas element.
 * Safari: render offscreen in a per-call temporary slot to avoid flicker, then remove it.
 *
 * @param {string} url - The image data URL.
 * @param {{ scale: number, dpr: number }} options - Context including scale and dpr (already normalized upstream).
 * @returns {Promise<HTMLCanvasElement>} Resolves with the rendered Canvas element.
 */
// ——— helpers ———
function isSvgDataURL(u) {
  return typeof u === 'string' && /^data:image\/svg\+xml/i.test(u)
}
export function decodeSvgFromDataURL(u) {
  const i = u.indexOf(',')
  return i >= 0 ? decodeURIComponent(u.slice(i + 1)) : ''
}
/** Decode only the leading chunk of an SVG data URL — enough to read the <svg ...> header
 *  without paying a full decodeURIComponent on a multi-MB payload. */
function peekSvgHeader(u) {
  const i = u.indexOf(',')
  if (i < 0) return ''
  // Trim a trailing incomplete %-escape so decodeURIComponent can't throw on the cut.
  const chunk = u.slice(i + 1, i + 1201).replace(/%[0-9A-Fa-f]?$/, '')
  try { return decodeURIComponent(chunk) } catch { return '' }
}
export function encodeSvgToDataURL(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}
function splitDecls(s) {
  let parts = [], buf = '', depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) { parts.push(buf); buf='' } else buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts.map(x => x.trim()).filter(Boolean)
}
function boxShadowToDropShadow(value) {
  // split by layer without breaking the parentheses of color functions
  const layers = []
  let buf = '', depth = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { layers.push(buf.trim()); buf = '' }
    else buf += ch
  }
  if (buf.trim()) layers.push(buf.trim())

  const fns = []
  for (const layer of layers) {
    // CSS inset box-shadows have no SVG filter equivalent (drop-shadow only supports outer shadows).
    // They are intentionally omitted from the canvas export rather than rendered incorrectly.
    if (/\binset\b/i.test(layer)) continue
    const nums = layer.match(/-?\d+(?:\.\d+)?px/gi) || []
    let [ox='0px', oy='0px', blur='0px'] = nums // spread no existe en drop-shadow
    // WebKit renders drop-shadow at ~2x the radius (radius taken as sigma): halve
    // so the fallback shadow matches the live box-shadow width.
    blur = `${parseFloat(blur) / 2}px`
    // color is roughly whatever is left after removing px values and 'inset'
    let color = layer.replace(/-?\d+(?:\.\d+)?px/gi, '')
                     .replace(/\binset\b/ig, '')
                     .trim().replace(/\s{2,}/g, ' ')
    const hasColor = !!color && color !== ',' // muy tolerante
    fns.push(`drop-shadow(${ox} ${oy} ${blur}${hasColor ? ` ${color}` : ''})`)
  }
  return fns.join(' ')
}
function rewriteDeclList(list) {
  const decls = splitDecls(list)
  let filter = null, wfilter = null, box = null
  const rest = []
  for (const d of decls) {
    const idx = d.indexOf(':')
    if (idx < 0) continue
    const prop = d.slice(0, idx).trim().toLowerCase()
    const val  = d.slice(idx + 1).trim()
    if (prop === 'box-shadow') box = val
    else if (prop === 'filter') filter = val
    else if (prop === '-webkit-filter') wfilter = val
    else rest.push([prop, val])
  }
  if (box) {
    const ds = boxShadowToDropShadow(box)
    if (ds) {
      filter = filter ? `${filter} ${ds}` : ds
      wfilter = wfilter ? `${wfilter} ${ds}` : ds
      // optional: drop the original box-shadow so it cannot come back
      // (not strictly required inside the SVG)
    }
  }
  const out = [...rest]
  if (filter) out.push(['filter', filter])
  if (wfilter) out.push(['-webkit-filter', wfilter])
  return out.map(([k, v]) => `${k}:${v}`).join(';')
}
function rewriteCssBlock(css) {
  return css.replace(/([^{}]+)\{([^}]*)\}/g, (_m, sel, body) => `${sel}{${rewriteDeclList(body)}}`)
}
function rewriteSvgBoxShadowToDropShadow(svgText) {
  // 1) <style>…</style>
  svgText = svgText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) =>
    m.replace(css, rewriteCssBlock(css))
  )
  // 2) style="…"
  svgText = svgText.replace(/style=(['"])([\s\S]*?)\1/gi, (m, q, body) =>
    `style=${q}${rewriteDeclList(body)}${q}`
  )
  return svgText
}
// Modern WebKit paints box-shadow natively inside svg-as-image (correct blur and
// spread — the drop-shadow rewrite below is only for engines that don't, renders
// ~2x wider and loses spread) BUT flips the shadow's Y offset (box- and
// text-shadow; drop-shadow is fine). Probe both facts once per session with a
// tiny svg: a black box whose only other paint is its own offset box-shadow.
let _svgShadowProbe = null
function probeSvgShadowSupport() {
  if (_svgShadowProbe) return _svgShadowProbe
  _svgShadowProbe = (async () => {
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="20">' +
        '<foreignObject width="8" height="20"><div xmlns="http://www.w3.org/1999/xhtml" ' +
        'style="width:4px;height:4px;margin-top:8px;background:#000;box-shadow:0 8px 0 0 #000"></div></foreignObject></svg>'
      const img = new Image()
      img.decoding = 'sync'
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 20
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const below = ctx.getImageData(2, 18, 1, 1).data[3] > 128
      const above = ctx.getImageData(2, 2, 1, 1).data[3] > 128
      return { native: below || above, flippedY: above && !below }
    } catch {
      return { native: false, flippedY: false }
    }
  })()
  return _svgShadowProbe
}

/** Negates the 2nd top-level px length (the Y offset) of each shadow layer. */
function negateShadowY(value) {
  const layers = []
  let depth = 0, start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) { layers.push(value.slice(start, i)); start = i + 1 }
  }
  layers.push(value.slice(start))
  return layers.map((seg) => {
    let d = 0, count = 0, out = '', i = 0
    while (i < seg.length) {
      const ch = seg[i]
      if (ch === '(') d++
      else if (ch === ')') d = Math.max(0, d - 1)
      if (d === 0 && (i === 0 || seg[i - 1] === ' ')) {
        const m = /^-?\d*\.?\d+px/.exec(seg.slice(i))
        if (m) {
          count++
          out += count === 2 ? `${-parseFloat(m[0])}px` : m[0]
          i += m[0].length
          continue
        }
      }
      out += ch
      i++
    }
    return out
  }).join(',')
}

/** Rewrites box-/text-shadow declarations in the svg, negating their Y offsets. */
function rewriteSvgShadowOffsets(svgText, includeBoxShadow) {
  const rewriteList = (list) => splitDecls(list).map((d) => {
    const idx = d.indexOf(':')
    if (idx < 0) return d
    const prop = d.slice(0, idx).trim().toLowerCase()
    if (prop === 'text-shadow' || (includeBoxShadow && prop === 'box-shadow')) {
      return `${prop}:${negateShadowY(d.slice(idx + 1))}`
    }
    return d
  }).join(';')
  svgText = svgText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) =>
    m.replace(css, css.replace(/([^{}]+)\{([^}]*)\}/g, (_m, sel, body) => `${sel}{${rewriteList(body)}}`))
  )
  svgText = svgText.replace(/style=(['"])([\s\S]*?)\1/gi, (m, q, body) => `style=${q}${rewriteList(body)}${q}`)
  return svgText
}

/**
 * Safari shadow handling on decoded svg text. Returns the (possibly rewritten)
 * text plus whether it carries box-/text-shadows: WebKit only rasterizes those
 * consistently at the svg's natural size (any other rasterization scale corrupts
 * offset direction and magnitude, or drops blurred shadows entirely), so the
 * caller must then draw 1:1 and resample the raster instead of letting WebKit
 * re-rasterize the svg scaled.
 */
export async function fixSafariShadows(svg) {
  // Real shadows carry px lengths; `text-shadow:none` defaults must not match.
  const hasShadows = /(?:box-shadow|text-shadow)\s*:[^;"}]*px/i.test(svg)
  if (!hasShadows) return { svg, naturalOnly: false }
  const { native, flippedY } = await probeSvgShadowSupport()
  try {
    let out = svg
    // No native box-shadow: emulate via drop-shadow (correct Y, ~2x blur → halved).
    if (!native) out = rewriteSvgBoxShadowToDropShadow(out)
    // Flipped Y: pre-negate box-shadow (only while still native) and text-shadow.
    if (flippedY) out = rewriteSvgShadowOffsets(out, native)
    return { svg: out, naturalOnly: true }
  } catch {
    return { svg, naturalOnly: true }
  }
}

/**
 * WebKit paints svg-as-image resources late: img.decode() resolves before embedded
 * @font-face fonts (#219770) and nested raster images (#394) are ready, so the first
 * drawImage comes out blank or with fallback-font text. Attach offscreen and probe-draw
 * a tiny canvas until ink appears (bounded) — probing first instead of a blind
 * two-frame wait, because the common case already has ink on the first draw and the
 * fixed wait cost two frames (~33ms) on every Safari export. Svgs that carry
 * fonts/nested images get the longer deadline; a genuinely blank capture just runs
 * out the short one.
 * @param {HTMLImageElement} img
 * @param {boolean} verify - Svg has fonts/nested images (longer probe deadline)
 */
async function waitForImgPaint(img, verify) {
  img.setAttribute('data-snapdom-internal', '')
  img.style.cssText = 'position:fixed;left:-99999px;top:-99999px;pointer-events:none'
  document.body.appendChild(img)
  try {
    const probe = document.createElement('canvas')
    probe.width = 16
    probe.height = 16
    // rAF with a timeout fallback: WebKit suspends rAF in occluded windows and
    // background tabs, and a capture must not hang there.
    const frame = () => new Promise(r => { requestAnimationFrame(r); setTimeout(r, 50) })
    const pctx = probe.getContext('2d', { willReadFrequently: true })
    if (!pctx) {
      await frame()
      await frame()
      return
    }
    const deadline = performance.now() + (verify ? 600 : 150)
    for (;;) {
      pctx.clearRect(0, 0, 16, 16)
      try { pctx.drawImage(img, 0, 0, 16, 16) } catch { return }
      const d = pctx.getImageData(0, 0, 16, 16).data
      let ink = false
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) { ink = true; break } }
      if (ink || performance.now() > deadline) return
      await frame()
    }
  } finally {
    try { img.remove() } catch { /* ok */ }
  }
}

// ——— Decode host for per-capture data URLs ———
// Imported from @frostin/snapdom (element-mirror). A browser keeps an internal resource-cache
// entry for every unique image URL for the lifetime of the document that fetched it, and there
// is no API to evict one (releasing the Image's src does not release the entry). A one-shot
// capture never notices; a loop that captures the same element mints a fresh multi-megabyte
// data: URL per frame, and the renderer grows by that much per frame, for good. blob: URLs are
// revocable, but Chromium taints a canvas that draws a foreignObject SVG fetched from one, and
// a tainted capture can be neither read back nor uploaded to WebGL. So the URLs stay data: and
// the decode happens in a hidden throwaway iframe instead: cached resources die with the
// document that fetched them, so recycling the iframe on a byte budget hands the memory back.
//
// Recycling only happens while no capture is mid-decode: an image's pixels belong to its
// document's resource, so tearing that document down under an in-flight decode, or before the
// final drawImage, would pull the bitmap out from under it.
const DECODE_FRAME_BUDGET_BYTES = 24 * 1024 * 1024
let _decodeFrame = null
let _decodeFrameBytes = 0
let _decodeInFlight = 0

/** An <img> to decode `src` with, owned by the throwaway frame when there is one. */
function acquireDecodeImage(src) {
  if (typeof document === 'undefined' || !document.body) return new Image()
  // The page may have torn the frame out from under us (anything that empties document.body);
  // a disconnected frame's document is gone with it.
  if (_decodeFrame && !_decodeFrame.contentDocument) {
    try { _decodeFrame.remove() } catch { /* already gone */ }
    _decodeFrame = null
  }
  if (_decodeFrame && _decodeFrameBytes > DECODE_FRAME_BUDGET_BYTES && _decodeInFlight === 0) {
    try { _decodeFrame.remove() } catch { /* already gone */ }
    _decodeFrame = null
  }
  if (!_decodeFrame) {
    const frame = document.createElement('iframe')
    frame.setAttribute('data-snapdom-internal', '')
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

/** Release the in-flight guard taken by acquireDecodeImage. */
function releaseDecodeImage(img) {
  if (!img || !img.__snapdomDecodeFrame) return
  img.__snapdomDecodeFrame = false
  _decodeInFlight = Math.max(0, _decodeInFlight - 1)
}

/** Start the decode of `src` on `image`. */
function startDecode(image, src) {
  image.loading = 'eager'
  image.decoding = 'sync'
  image.crossOrigin = 'anonymous'
  image.src = src
  return image.decode()
}

/**
 * Rasterize SVG (o data URL) en un canvas respetando width/height + scale.
 * Supports flattening a background color with no intermediate canvas.
 * @param {string} url
 * @param {{
 *   width?:number,
 *   height?:number,
 *   scale?:number,
 *   dpr?:number,
 *   meta?:object,
 *   canvas?:HTMLCanvasElement,
 *   crop?:{x:number,y:number,width:number,height:number},
 *   backgroundColor?: string // optional color used to flatten the background
 * }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function toCanvas(url, options) {
  let { width: optW, height: optH, scale = 1, dpr = 1, meta = {}, backgroundColor, crop = null } = options

  // SVG payloads: the old path decoded the whole multi-MB data URL just to read the <svg>
  // header (#425 clamp check) and again for the Safari box-shadow rewrite, re-encoding after
  // each. Peek the header without decoding the payload; only when a transform is actually
  // needed (oversize clamp or Safari shadow fix) decode ONCE, transform on text, re-encode ONCE.
  // NOTE: must stay a data: URL — Chromium taints the canvas when a foreignObject SVG is
  // drawn from a blob: URL, which would break every toDataURL/toBlob export downstream.
  let src = url
  let shadowNaturalOnly = false
  let needsPaintVerify = false
  // Cropping IS a viewBox rewrite, so it only exists for the serialized SVG payload. Any
  // other source would rasterize whole, handing a document exporter a full bitmap where it
  // asked for one page: fail as loudly as a malformed window instead of degrading silently.
  if (crop && !isSvgDataURL(url)) {
    throw new RangeError('[snapdom] canvas crop requires an SVG capture payload')
  }
  if (isSvgDataURL(url)) {
    const head = (peekSvgHeader(url).match(/<svg\b[^>]*>/i) || [])[0] || ''
    const w = parseFloat((head.match(/\bwidth="([\d.]+)/i) || [])[1])
    const h = parseFloat((head.match(/\bheight="([\d.]+)/i) || [])[1])
    const oversized = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 &&
      Math.min(1, MAX_RASTER_SIDE / w, MAX_RASTER_SIDE / h, Math.sqrt(MAX_RASTER_AREA / (w * h))) < 1
    if (crop || oversized || isSafari()) {
      try {
        let svgText = decodeSvgFromDataURL(url)
        if (crop) svgText = cropSvgText(svgText, crop)
        if (isSafari()) {
          const fixed = await fixSafariShadows(svgText)
          svgText = fixed.svg
          shadowNaturalOnly = fixed.naturalOnly
          // Embedded fonts / nested raster images are the resources WebKit paints late
          // (#219770/#394) — only then is the verified-draw ladder worth waiting on.
          needsPaintVerify = /@font-face|data:image\//i.test(svgText)
        }
        // A crop can turn an oversized source into a safe page-sized decode: clamp the
        // TRANSFORMED header, not the original full document.
        if (oversized || crop) svgText = clampSvgTextRasterSize(svgText, options.__session) // #425: keep within decode limits
        src = encodeSvgToDataURL(svgText)
      } catch (error) {
        if (crop) throw error
        src = url
      }
    }
  }

  // Fetched from the throwaway decode frame and held until the last drawImage: recycling the
  // frame frees this image's pixels along with everything else its document fetched.
  let img = acquireDecodeImage(src)
  try {
    await startDecode(img, src)
  } catch (e) {
    if (!img.__snapdomDecodeFrame) throw e
    // Gecko replaces a freshly inserted iframe's initial about:blank document asynchronously,
    // aborting loads started against it. By the time the abort surfaces the settled document
    // is in place, so one retry lands.
    releaseDecodeImage(img)
    img = acquireDecodeImage(src)
    await startDecode(img, src)
  }

  try {
    if (isSafari()) {
      await waitForImgPaint(img, needsPaintVerify)
    }

    const natW = img.naturalWidth
    const natH = img.naturalHeight

    // Prefer the rasterized viewBox (vbW/vbH, post-bleed) over the pre-bleed
    // content box (w0/h0): under outerShadows an asymmetric shadow/blur/outline
    // bleeds unevenly, so w0/h0's aspect ratio no longer matches the actual
    // rasterized image and stretches it.
    // A crop rewrote the SVG's intrinsic size and viewBox before decode, so its decoded
    // bitmap is the authoritative aspect reference: the full capture's meta would make a
    // width-only/height-only crop inherit the whole document's ratio and stretch the page.
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
      outW = natW
      outH = natH
    }

    // ONE sizing rule across every exporter (v3): width/height are the absolute output CSS
    // size and win; scale applies only when neither is set; dpr multiplies device pixels.
    // (toCanvas used to multiply width×scale while toImg/toSvg ignored scale — same options,
    // different geometry.)
    if (!hasW && !hasH) {
      outW = outW * scale
      outH = outH * scale
    }

    // #425: the device canvas is outW*dpr × outH*dpr; dpr (which defaults to devicePixelRatio,
    // i.e. 2 on Retina) can push a within-decode-limit capture past the canvas cap. Clamp the
    // whole draw so allocation/drawImage don't fail, preserving aspect ratio.
    const devW = outW * dpr, devH = outH * dpr
    const over = Math.max(devW / MAX_RASTER_SIDE, devH / MAX_RASTER_SIDE, Math.sqrt((devW * devH) / MAX_RASTER_AREA))
    if (over > 1) {
      sessionWarn(options.__session, 'canvas-clamp', `output ${Math.round(devW)}x${Math.round(devH)}px exceeds canvas limits; downscaled`)
      console.warn(
        `[snapDOM] Output ${Math.round(devW)}×${Math.round(devH)}px exceeds the browser canvas ` +
        `limit (${MAX_RASTER_SIDE}px/side); downscaling. Lower \`scale\`/\`dpr\` or set \`width\`/\`height\`.`
      )
      outW /= over
      outH /= over
    }

    // Draw into the caller's canvas when it gave one (imported from @frostin/snapdom): a
    // caller looping captures otherwise pays a full-canvas copy per frame to move the pixels
    // onto its own. Assigning width/height resets the canvas state and clears it, so a reused
    // canvas starts as clean as a fresh one.
    const canvas = (typeof HTMLCanvasElement !== 'undefined' && options.canvas instanceof HTMLCanvasElement)
      ? options.canvas
      : document.createElement('canvas')
    canvas.width = outW * dpr
    canvas.height = outH * dpr
    canvas.style.width = `${outW}px`
    canvas.style.height = `${outH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[snapdom] toCanvas: the target canvas has no 2d context')
    if (dpr !== 1) ctx.scale(dpr, dpr)

    if (backgroundColor) {
      ctx.save()
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, outW, outH)
      ctx.restore()
    }

    if (shadowNaturalOnly && (Math.round(outW * dpr) !== natW || Math.round(outH * dpr) !== natH)) {
      // WebKit corrupts box-/text-shadows when the svg rasterizes at a non-natural
      // scale: render 1:1 first, then resample pixels (canvas→canvas draws never
      // re-rasterize the svg). Trades a bit of sharpness for correct shadows.
      const tmp = document.createElement('canvas')
      tmp.width = natW
      tmp.height = natH
      tmp.getContext('2d').drawImage(img, 0, 0)
      ctx.drawImage(tmp, 0, 0, outW, outH)
    } else {
      ctx.drawImage(img, 0, 0, outW, outH)
    }
    return canvas
  } finally {
    releaseDecodeImage(img)
  }
}
