/** PNG file export beyond the canvas/decode limits. Ordinary exports keep the native path. */
import { toCanvas, peekSvgHeader, cropSvgText, decodeSvgFromDataURL, encodeSvgToDataURL, MAX_RASTER_SIDE, MAX_RASTER_AREA } from './toCanvas.js'
import { isSafari } from '../utils/browser.js'

/**
 * Return null for an ordinary export, otherwise encode windows of the frozen SVG into
 * one PNG. The synchronous gate avoids an extra promise/task on the native encode path.
 * @param {string|HTMLCanvasElement} url
 * @param {object} options
 * @returns {Promise<Blob>|null}
 */
export function toLargePng(url, options) {
  if (typeof url !== 'string' || !url.startsWith('data:image/svg+xml')) return null
  const originalHeader = peekSvgHeader(url).match(/<svg\b[^>]*>/i)?.[0]
  if (!originalHeader) return null
  const header = options.crop ? cropSvgText(originalHeader, options.crop) : originalHeader
  const sw = parseFloat(header.match(/\bwidth="([^"]+)/i)?.[1])
  const sh = parseFloat(header.match(/\bheight="([^"]+)/i)?.[1])
  const vb = (header.match(/\bviewBox="([^"]+)/i)?.[1] || '').trim().split(/[\s,]+/).map(Number)
  if (!(sw > 0 && sh > 0) || vb.length !== 4 || !vb.every(Number.isFinite) || !(vb[2] > 0 && vb[3] > 0)) return null

  const hasW = Number.isFinite(options.width), hasH = Number.isFinite(options.height)
  const meta = options.meta || {}
  const nw = Math.max(1, Math.floor(sw)), nh = Math.max(1, Math.floor(sh))
  const rw = options.crop ? nw : Number.isFinite(meta.vbW) ? meta.vbW : Number.isFinite(meta.w0) ? meta.w0 : nw
  const rh = options.crop ? nh : Number.isFinite(meta.vbH) ? meta.vbH : Number.isFinite(meta.h0) ? meta.h0 : nh
  const dpr = options.dpr ?? 1
  const scale = options.scale ?? 1
  // Preserve the floating-point draw size as well as the integer backing size: rounding
  // the former would stretch the last partial pixel and shift every later tile boundary.
  const dw = (hasW && hasH ? Math.max(1, options.width) : hasW ? options.width : hasH ? options.height * rw / Math.max(1, rh) : nw * scale) * dpr
  const dh = (hasW && hasH ? Math.max(1, options.height) : hasH ? options.height : hasW ? options.width * rh / Math.max(1, rw) : nh * scale) * dpr
  if (Math.max(sw, sh, dw, dh) <= MAX_RASTER_SIDE &&
      sw * sh <= MAX_RASTER_AREA && dw * dh <= MAX_RASTER_AREA) return null
  // Older browsers retain the existing clamp and its diagnostic.
  if (typeof CompressionStream !== 'function') return null

  return encode()

  async function encode() {
    const { encodePng } = await import('../modules/png.js')
    const width = Math.max(1, Math.floor(dw)), height = Math.max(1, Math.floor(dh))
    const svg = decodeSvgFromDataURL(url)
    const body = svg.slice(svg.indexOf(originalHeader) + originalHeader.length, svg.lastIndexOf('</svg>'))
    // Keep the original viewBox so percentage geometry retains its basis. Reproduce its
    // viewport transform explicitly: nesting another SVG would apply author svg opacity,
    // filters and descendant selectors a second time.
    const par = header.match(/\bpreserveAspectRatio="([^"]*)"/i)?.[1] || 'xMidYMid meet'
    let ax = sw / vb[2], ay = sh / vb[3], ex = 0, ey = 0
    if (!/\bnone\b/.test(par)) {
      ax = ay = /\bslice\b/.test(par) ? Math.max(ax, ay) : Math.min(ax, ay)
      ex = (sw - vb[2] * ax) * (/xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5)
      ey = (sh - vb[3] * ay) * (/YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5)
    }
    ex -= vb[0] * ax
    ey -= vb[1] * ay
    const tileHeader = header.replace(/\s(?:width|height|preserveAspectRatio)="[^"]*"/gi, '').slice(0, -1)
    // WebKit shadows require a natural-size SVG draw, then canvas resampling (toCanvas's
    // shadowNaturalOnly path). Scaling inside the SVG would evade that workaround. Keep
    // natural windows on a single pixel grid with one interpolation pixel around each edge.
    const naturalShadows = isSafari() && /(?:box-shadow|text-shadow)\s*:[^;"}]*px/i.test(svg)
    const ux = sw / dw, uy = sh / dh
    // Bound a full-width RGBA row block to ~16 MiB. A wide image uses horizontal tiles too;
    // none of its canvases has the full (oversized) width. PNG output bytes remain in the Blob.
    const rowsPerBand = Math.max(1, Math.min(8192, Math.floor(4 * 1024 * 1024 / width), naturalShadows ? Math.floor(2046 / uy) : 8192))
    const tileWidth = Math.max(1, Math.min(8192, width, naturalShadows ? Math.floor(2046 / ux) : 8192))
    async function* rows() {
      for (let y = 0; y < height; y += rowsPerBand) {
        const h = Math.min(rowsPerBand, height - y)
        const pixels = new Uint8Array(width * h * 4)
        for (let x = 0; x < width; x += tileWidth) {
          const w = Math.min(tileWidth, width - x)
          const left = naturalShadows ? Math.max(0, Math.floor(x * ux) - 1) : x * ux
          const top = naturalShadows ? Math.max(0, Math.floor(y * uy) - 1) : y * uy
          const rw = naturalShadows ? Math.min(nw, Math.ceil((x + w) * ux) + 1) - left : w
          const rh = naturalShadows ? Math.min(nh, Math.ceil((y + h) * uy) + 1) - top : h
          const bx = rw / vb[2], by = rh / vb[3]
          const sx = naturalShadows ? 1 : 1 / ux, sy = naturalShadows ? 1 : 1 / uy
          const transform = `matrix(${ax * sx / bx},0,0,${ay * sy / by},${(ex - left) * sx / bx + vb[0]},${(ey - top) * sy / by + vb[1]})`
          // Captured author styles remain active. The synthetic group must only inherit
          // the root's paint/font properties, never acquire author g opacity or transforms.
          const windowSvg = `${tileHeader} width="${rw}" height="${rh}" preserveAspectRatio="none"><g style="all:unset!important;transform:${transform}!important;transform-origin:0 0!important">${body}</g></svg>`
          const canvas = await toCanvas(encodeSvgToDataURL(windowSvg), {
            width: rw, height: rh, dpr: 1, backgroundColor: naturalShadows ? null : options.backgroundColor,
            __session: options.__session, __releaseDecodeFrame: true,
          })
          let sampled = canvas
          try {
            if (naturalShadows) {
              sampled = document.createElement('canvas')
              sampled.width = w
              sampled.height = h
              const ctx = sampled.getContext('2d')
              if (options.backgroundColor) {
                ctx.fillStyle = options.backgroundColor
                ctx.fillRect(0, 0, w, h)
              }
              ctx.drawImage(canvas, x * ux - left, y * uy - top, w * ux, h * uy, 0, 0, w, h)
            }
            const data = sampled.getContext('2d').getImageData(0, 0, w, h).data
            for (let row = 0; row < h; row++) {
              pixels.set(data.subarray(row * w * 4, (row + 1) * w * 4), (row * width + x) * 4)
            }
          } finally {
            canvas.width = canvas.height = 0
            if (sampled !== canvas) sampled.width = sampled.height = 0
          }
        }
        yield pixels
      }
    }
    return encodePng(width, height, rows())
  }
}
