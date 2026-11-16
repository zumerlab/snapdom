/**
 * Edits of a capture's SVG as text: decode and encode the data URL, read or rewrite the root
 * `<svg>` tag without touching the payload, crop to a window, scale to an output size. The
 * exporters share them so a size or a crop never costs a second render.
 * @module exporters/svgText
 */
import { isSafari } from '../utils/browser'

/**
 * Window an SVG before decode, in viewBox units (result.meta), so a document exporter can
 * rasterize a long capture page by page under the decode limits.
 *
 * WebKit draws every foreignObject box with its own layer (position, opacity, transform) as
 * if the viewBox started at 0 0, ignoring min-x/min-y and an ancestor <g> translate; only
 * the foreignObject's x/y moves it. Normal-flow blocks do move, so solid bands look right
 * while text stays put: windows 2-4 of a 4-slide strip showed window 1's text (Playwright
 * WebKit). There the root foreignObject is shifted instead, viewBox `0 0 w h`. A header-only
 * svg (toLargeImage's sizing) has no foreignObject and keeps the viewBox rewrite.
 * @param {string} svg - decoded svg text
 * @param {{x:number,y:number,width:number,height:number}} crop - in viewBox units
 * @param {{shiftContent?: boolean}} [opts] - move the root foreignObject instead of the
 *   viewBox origin; defaults to WebKit, the engine that needs it
 * @returns {string}
 */
export function cropSvgText(svg, crop, { shiftContent = isSafari() } = {}) {
  const nums = ['x', 'y', 'width', 'height'].map(k => Number(crop?.[k]))
  if (!nums.every(Number.isFinite) || nums[2] <= 0 || nums[3] <= 0) {
    throw new RangeError('[SnapDOM] crop needs finite x/y and a positive width/height.')
  }
  const head = svg.match(/<svg\b[^>]*>/i)
  if (!head) throw new Error('[SnapDOM] Only SVG captures can be cropped.')
  const tag = head[0]
  const vb = (tag.match(/\bviewBox="([^"]+)"/i) || [])[1]
  const parts = String(vb || '').trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error('[SnapDOM] Can\'t crop: the SVG has no valid viewBox.')
  }
  const [vx, vy, vw, vh] = parts
  const left = Math.max(vx, nums[0])
  const top = Math.max(vy, nums[1])
  const right = Math.min(vx + vw, nums[0] + nums[2])
  const bottom = Math.min(vy + vh, nums[1] + nums[3])
  if (!(right > left) || !(bottom > top)) {
    throw new RangeError('[SnapDOM] The crop area does not intersect the capture.')
  }
  // The header's width/height may already be a scaled output size: keep that density so a
  // page slice rasterizes at the same resolution as the whole capture would.
  const attrW = parseFloat((tag.match(/\bwidth="([\d.]+)/i) || [])[1])
  const attrH = parseFloat((tag.match(/\bheight="([\d.]+)/i) || [])[1])
  const densityX = Number.isFinite(attrW) && attrW > 0 ? attrW / vw : 1
  const densityY = Number.isFinite(attrH) && attrH > 0 ? attrH / vh : 1
  const width = Math.max(1, (right - left) * densityX)
  const height = Math.max(1, (bottom - top) * densityY)
  const sized = tag
    .replace(/(\bwidth=")[^"]*/i, `$1${width}`)
    .replace(/(\bheight=")[^"]*/i, `$1${height}`)
  const shifted = shiftContent ? shiftRootForeignObject(svg, tag, left, top) : null
  if (shifted) {
    const next = sized.replace(/(\bviewBox=")[^"]*/i, (_, attr) => `${attr}0 0 ${right - left} ${bottom - top}`)
    return next + shifted.slice(tag.length)
  }
  const next = sized.replace(/(\bviewBox=")[^"]*/i, `$1${left} ${top} ${right - left} ${bottom - top}`)
  return svg.replace(tag, next)
}

/**
 * `svg` with the foreignObject that directly follows its root tag moved by (-dx, -dy), or
 * null when there is none to move (header-only input, or a wrapper such as the layout-zoom
 * <g> in between, whose foreignObject is not in viewBox units).
 * @param {string} svg - starts with `tag`
 * @param {string} tag - the root <svg ...> tag
 * @param {number} dx
 * @param {number} dy
 * @returns {string|null}
 */
function shiftRootForeignObject(svg, tag, dx, dy) {
  if (!svg.startsWith(tag)) return null
  const m = /^\s*<foreignObject\b[^>]*>/i.exec(svg.slice(tag.length, tag.length + 2048))
  if (!m) return null
  const fo = m[0]
  const move = (s, name, d) => {
    const re = new RegExp(`(\\s${name}=")([^"]*)`)
    const at = s.match(re)
    const v = at ? parseFloat(at[2]) : 0
    if (!Number.isFinite(v)) return null
    return at
      ? s.replace(re, (_, attr) => `${attr}${v - d}`)
      : s.replace(/^(\s*<foreignObject\b)/i, (_, open) => `${open} ${name}="${-d}"`)
  }
  const moved = move(fo, 'x', dx)
  const next = moved && move(moved, 'y', dy)
  if (!next) return null
  return tag + next + svg.slice(tag.length + fo.length)
}

/**
 * Size an svg to `w` x `h` the way WebKit can draw it: viewBox at the output size, the root
 * foreignObject scaled and `zoom` on its wrapper. WebKit draws every box with its own layer
 * (position, opacity, transform) without the viewBox scale (WebKit bug 23113): a card exported
 * at 2x put its positioned layer at half size in the corner (LodyAI/Lody#2250). The zoom lays
 * out at k times every length, so layout and layers agree. Uniform, centred, like `xMidYMid
 * meet`. Null when there is nothing to scale; the caller keeps the plain patch.
 * Pinned by __tests__/exporter.webkitLayerScale.test.js.
 * @param {string} svg - decoded svg text
 * @param {number} w - output width in CSS px
 * @param {number} h - output height in CSS px
 * @returns {string|null}
 */
export function zoomSvgText(svg, w, h) {
  const head = svg.match(/<svg\b[^>]*>/i)
  if (!head) return null
  const tag = head[0]
  const parts = String((tag.match(/\bviewBox="([^"]+)"/i) || [])[1] || '').trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) return null
  const k = Math.min(w / parts[2], h / parts[3])
  const m = /^\s*<foreignObject\b[^>]*>/i.exec(svg.slice(tag.length, tag.length + 2048))
  if (!m) return null
  let fo = m[0]
  const offset = { x: (w - k * parts[2]) / 2, y: (h - k * parts[3]) / 2 }
  for (const name of ['x', 'y', 'width', 'height']) {
    const re = new RegExp(`(\\s${name}=")([^"]*)`)
    const at = fo.match(re)
    const v = at ? parseFloat(at[2]) : 0
    if (!Number.isFinite(v)) return null
    const next = v * k + (offset[name] || 0)
    fo = at ? fo.replace(re, (_, attr) => `${attr}${next}`) : fo.replace(/^(\s*<foreignObject\b)/i, (_, open) => `${open} ${name}="${next}"`)
  }
  // The wrapper is the first element after the engine's <style>, whose text the serializer
  // escaped, so the first literal `<div` past it is the wrapper itself.
  const body = svg.slice(tag.length + m[0].length)
  const styleEnd = body.indexOf('</style>')
  const div = /<div\b[^>]*?( style=")([^"]*)"/i.exec(body.slice(styleEnd < 0 ? 0 : styleEnd))
  if (!div) return null
  const at = (styleEnd < 0 ? 0 : styleEnd) + div.index
  const zoomed = body.slice(0, at) + div[0].slice(0, -1) + `;zoom:${k} !important"` + body.slice(at + div[0].length)
  const sized = tag
    .replace(/(\bwidth=")[^"]*/i, `$1${w}`)
    .replace(/(\bheight=")[^"]*/i, `$1${h}`)
    .replace(/(\bviewBox=")[^"]*/i, `$10 0 ${w} ${h}`)
  return sized + fo + zoomed
}

// ——— helpers ———
export function isSvgDataURL(u) {
  return typeof u === 'string' && /^data:image\/svg\+xml/i.test(u)
}
/**
 * The svg text behind a data URL. Decodes the WHOLE payload, so a caller that only needs
 * the header uses peekSvgHeader instead.
 * @param {string} u - data:image/svg+xml URL
 * @returns {string}
 */
export function decodeSvgFromDataURL(u) {
  const i = u.indexOf(',')
  return i >= 0 ? decodeURIComponent(u.slice(i + 1)) : ''
}
/** Decode only the leading chunk of an SVG data URL — enough to read the <svg ...> header
 *  without paying a full decodeURIComponent on a multi-MB payload. */
export function peekSvgHeader(u) {
  const i = u.indexOf(',')
  if (i < 0) return ''
  // Trim a trailing incomplete %-escape so decodeURIComponent can't throw on the cut.
  const chunk = u.slice(i + 1, i + 1201).replace(/%[0-9A-Fa-f]?$/, '')
  try { return decodeURIComponent(chunk) } catch { return '' }
}
/**
 * Rewrite the root `<svg>` tag of a data URL without decoding the payload: encodeURIComponent
 * maps character by character and the tag ends at an ASCII `>`, so the encoded tail is reused
 * as is. Null unless the payload starts with the canonical encoding of the tag (no prolog, tag
 * within the peek); the caller then decodes the whole text.
 * Pinned by __tests__/exporter.patchSvgHeader.test.js.
 * @param {string} u - data:image/svg+xml URL
 * @param {(head: string) => string} fn - the new root tag from the old one
 * @returns {string|null}
 */
export function patchSvgHeader(u, fn) {
  const i = u.indexOf(',') + 1
  const head = peekSvgHeader(u).match(/<svg\b[^>]*>/i)?.[0]
  const enc = head && encodeURIComponent(head)
  if (!enc || !u.startsWith(enc, i)) return null
  return u.slice(0, i) + encodeURIComponent(fn(head)) + u.slice(i + enc.length)
}
/**
 * The inverse of decodeSvgFromDataURL. A data: URL on purpose: Chromium taints a canvas that
 * draws a foreignObject svg fetched from a blob: URL, and a tainted canvas cannot be read.
 * @param {string} svgText
 * @returns {string}
 */
export function encodeSvgToDataURL(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}
