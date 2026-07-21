// src/exporters/toCanvas.js
import { isSafari } from '../utils/browser'

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
function clampSvgTextRasterSize(svg) {
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
function decodeSvgFromDataURL(u) {
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
function encodeSvgToDataURL(svgText) {
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
  // divide por capas sin romper paréntesis de colores
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
    // color ≈ lo que quede tras quitar px e 'inset'
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
      // opcional: eliminar el box-shadow original para evitar que reaparezca
      // (no es estrictamente necesario dentro del SVG)
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
async function fixSafariShadows(svg) {
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
 * Rasterize SVG (o data URL) en un canvas respetando width/height + scale.
 * Soporta aplanar un background color sin canvas intermedio.
 * @param {string} url
 * @param {{
 *   width?:number,
 *   height?:number,
 *   scale?:number,
 *   dpr?:number,
 *   meta?:object,
 *   backgroundColor?: string // <- NUEVO: color opcional para aplanar fondo
 * }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function toCanvas(url, options) {
  let { width: optW, height: optH, scale = 1, dpr = 1, meta = {}, backgroundColor } = options

  // SVG payloads: the old path decoded the whole multi-MB data URL just to read the <svg>
  // header (#425 clamp check) and again for the Safari box-shadow rewrite, re-encoding after
  // each. Peek the header without decoding the payload; only when a transform is actually
  // needed (oversize clamp or Safari shadow fix) decode ONCE, transform on text, re-encode ONCE.
  // NOTE: must stay a data: URL — Chromium taints the canvas when a foreignObject SVG is
  // drawn from a blob: URL, which would break every toDataURL/toBlob export downstream.
  let src = url
  let shadowNaturalOnly = false
  if (isSvgDataURL(url)) {
    const head = (peekSvgHeader(url).match(/<svg\b[^>]*>/i) || [])[0] || ''
    const w = parseFloat((head.match(/\bwidth="([\d.]+)/i) || [])[1])
    const h = parseFloat((head.match(/\bheight="([\d.]+)/i) || [])[1])
    const oversized = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 &&
      Math.min(1, MAX_RASTER_SIDE / w, MAX_RASTER_SIDE / h, Math.sqrt(MAX_RASTER_AREA / (w * h))) < 1
    if (oversized || isSafari()) {
      try {
        let svgText = decodeSvgFromDataURL(url)
        if (isSafari()) {
          const fixed = await fixSafariShadows(svgText)
          svgText = fixed.svg
          shadowNaturalOnly = fixed.naturalOnly
        }
        if (oversized) svgText = clampSvgTextRasterSize(svgText) // #425: keep within decode limits
        src = encodeSvgToDataURL(svgText)
      } catch { src = url }
    }
  }

  const img = new Image()
  img.loading = 'eager'
  img.decoding = 'sync'
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()

  // #394: on Safari, img.decode() resolves before <img> tags nested in the
  // foreignObject finish compositing, producing blank raster exports. Attach
  // offscreen and wait two animation frames so the compositor catches up.
  if (isSafari()) {
    img.setAttribute('data-snapdom-internal', '')
    img.style.cssText = 'position:fixed;left:-99999px;top:-99999px;pointer-events:none'
    document.body.appendChild(img)
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    } finally {
      try { img.remove() } catch { /* ok */ }
    }
  }

  const natW = img.naturalWidth
  const natH = img.naturalHeight

  // Prefer the rasterized viewBox (vbW/vbH, post-bleed) over the pre-bleed
  // content box (w0/h0): under outerShadows an asymmetric shadow/blur/outline
  // bleeds unevenly, so w0/h0's aspect ratio no longer matches the actual
  // rasterized image and stretches it.
  const refW = Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : natW
  const refH = Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : natH

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

  outW = outW * scale
  outH = outH * scale

  // #425: the device canvas is outW*dpr × outH*dpr; dpr (which defaults to devicePixelRatio,
  // i.e. 2 on Retina) can push a within-decode-limit capture past the canvas cap. Clamp the
  // whole draw so allocation/drawImage don't fail, preserving aspect ratio.
  const devW = outW * dpr, devH = outH * dpr
  const over = Math.max(devW / MAX_RASTER_SIDE, devH / MAX_RASTER_SIDE, Math.sqrt((devW * devH) / MAX_RASTER_AREA))
  if (over > 1) {
    console.warn(
      `[snapDOM] Output ${Math.round(devW)}×${Math.round(devH)}px exceeds the browser canvas ` +
      `limit (${MAX_RASTER_SIDE}px/side); downscaling. Lower \`scale\`/\`dpr\` or set \`width\`/\`height\`.`
    )
    outW /= over
    outH /= over
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW * dpr
  canvas.height = outH * dpr
  canvas.style.width = `${outW}px`
  canvas.style.height = `${outH}px`

  const ctx = canvas.getContext('2d')
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
}
