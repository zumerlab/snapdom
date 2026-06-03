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
 * Downscale an SVG data URL whose intrinsic width/height exceed the decode limits.
 * The SVG carries a viewBox, so shrinking width/height just renders the same content at a
 * lower resolution (no clipping). Returns the original url when it already fits or on parse
 * failure. @param {string} url @returns {string}
 */
function clampSvgRasterSize(url) {
  if (!isSvgDataURL(url)) return url
  try {
    const svg = decodeSvgFromDataURL(url)
    const head = svg.match(/<svg\b[^>]*>/i)
    if (!head) return url
    const tag = head[0]
    const w = parseFloat((tag.match(/\bwidth="([\d.]+)/i) || [])[1])
    const h = parseFloat((tag.match(/\bheight="([\d.]+)/i) || [])[1])
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return url
    const f = Math.min(1, MAX_RASTER_SIDE / w, MAX_RASTER_SIDE / h, Math.sqrt(MAX_RASTER_AREA / (w * h)))
    if (f >= 1) return url
    const nw = Math.max(1, Math.floor(w * f))
    const nh = Math.max(1, Math.floor(h * f))
    console.warn(
      `[snapDOM] Capture ${Math.round(w)}×${Math.round(h)}px exceeds the browser image-decode ` +
      `limit (${MAX_RASTER_SIDE}px/side); downscaling to ${nw}×${nh}px. Lower \`scale\` or set ` +
      '`width`/`height` to control output size.'
    )
    const fixed = svg.replace(tag, tag
      .replace(/(\bwidth=")[\d.]+/i, `$1${nw}`)
      .replace(/(\bheight=")[\d.]+/i, `$1${nh}`))
    return encodeSvgToDataURL(fixed)
  } catch {
    return url
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
    const [ox='0px', oy='0px', blur='0px'] = nums // spread no existe en drop-shadow
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
function maybeConvertBoxShadowForSafari(url) {
  if (!isSafari() || !isSvgDataURL(url)) return url
  try {
    const svg = decodeSvgFromDataURL(url)
    const fixed = rewriteSvgBoxShadowToDropShadow(svg)
    return encodeSvgToDataURL(fixed)
  } catch {
    return url
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
  url = maybeConvertBoxShadowForSafari(url)
  url = clampSvgRasterSize(url) // #425: keep the SVG within decode limits

  const img = new Image()
  img.loading = 'eager'
  img.decoding = 'sync'
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()

  // #394: on Safari, img.decode() resolves before <img> tags nested in the
  // foreignObject finish compositing, producing blank raster exports. Attach
  // offscreen and wait two animation frames so the compositor catches up.
  if (isSafari()) {
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

  const refW = Number.isFinite(meta.w0) ? meta.w0 : natW
  const refH = Number.isFinite(meta.h0) ? meta.h0 : natH

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

  ctx.drawImage(img, 0, 0, outW, outH)
  return canvas
}
