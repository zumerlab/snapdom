/**
 * Gradient text (`background-clip: text`) for Firefox, which paints no clipped background
 * inside an SVG foreignObject image (Firefox 141 and 157: 0 painted pixels for a hand-written
 * one). The style pass first swaps such text to the average of its gradient
 * (applyBgClipTextFallback in styles.js); this module then repaints it faithfully where it can.
 *
 * Every glyph is placed where the live layout put it, read through a Range, so wrapping,
 * alignment and letter-spacing need no re-layout. The glyphs become one SVG <text> per text
 * node, filled with a pattern whose image is the element's own CSS background painted in a
 * nested svg, so any gradient or layer stack comes through as authored. The clone keeps its
 * text, transparent, to hold the layout. On any doubt the solid fallback stays. #530, pinned
 * by __tests__/module.styles.bgClipText.test.js.
 * @module bgClipText
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const BG_PROPS = ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin']

/**
 * Repaint every recorded gradient-text clone with its live gradient.
 * @param {Array<[Element, HTMLElement]>} pairs - [source, clone] for each element styles.js swapped to the solid fallback
 */
export function paintClippedText(pairs) {
  for (const [source, clone] of pairs) {
    try { paintOne(source, clone) } catch { /* the solid fallback stays */ }
  }
}

function paintOne(source, clone) {
  const view = source.ownerDocument.defaultView
  const cs = view.getComputedStyle(source)
  const rects = [...source.getClientRects()]
  if (!rects.length) return
  // Origin: the padding box of the first fragment, where an absolute child of a relative box sits.
  const ox = rects[0].left + parseFloat(cs.borderLeftWidth)
  const oy = rects[0].top + parseFloat(cs.borderTopWidth)
  // Where the background is laid out. A block paints one padding box; a wrapped inline paints
  // its fragments as one strip cut into lines (box-decoration-break: slice), so every line
  // shows the stretch of the gradient that follows the previous line's.
  let frags
  if (cs.display === 'inline') {
    const total = rects.reduce((w, r) => w + r.width, 0)
    let off = 0
    frags = rects.map((r) => {
      const f = { x: r.left - ox - off, y: r.top - oy, w: total, h: r.height, top: r.top, bottom: r.bottom }
      off += r.width
      return f
    })
  } else {
    const w = source.clientWidth || rects[0].width
    const h = source.clientHeight || rects[0].height
    frags = [{ x: 0, y: 0, w, h, top: -Infinity, bottom: Infinity }]
  }
  const doc = clone.ownerDocument
  const id = `sd-bct-${Math.random().toString(36).slice(2, 9)}`
  const bg = BG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';').replace(/"/g, "'")
  let defs = ''
  frags.forEach((f, k) => {
    const painted = `<svg xmlns="${SVG_NS}" width="${f.w}" height="${f.h}"><foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${f.w}px;height:${f.h}px;${bg}"></div></foreignObject></svg>`
    defs += `<pattern id="${id}-${k}" patternUnits="userSpaceOnUse" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}">` +
      `<image width="${f.w}" height="${f.h}" preserveAspectRatio="none" href="data:image/svg+xml;charset=utf-8,${encodeURIComponent(painted)}"/></pattern>`
  })
  let texts = ''
  const ctx = doc.createElement('canvas').getContext('2d')
  const walker = source.ownerDocument.createTreeWalker(source, NodeFilter.SHOW_TEXT)
  const range = source.ownerDocument.createRange()
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const pcs = view.getComputedStyle(t.parentElement)
    ctx.font = pcs.font
    const ascent = ctx.measureText('X').fontBoundingBoxAscent
    if (!Number.isFinite(ascent)) return
    const font = pcs.font.replace(/"/g, "'")
    // One <text> per fragment the glyphs fall in, each filled with that fragment's pattern.
    const runs = frags.map(() => ({ xs: [], ys: [], chars: '' }))
    const data = t.data
    for (let i = 0; i < data.length; i++) {
      // A UTF-16 pair is one glyph: measure and emit it whole.
      const n = data.charCodeAt(i) >= 0xd800 && data.charCodeAt(i) <= 0xdbff ? 2 : 1
      range.setStart(t, i)
      range.setEnd(t, i + n)
      const r = range.getClientRects()[0]
      const ch = data.slice(i, i + n)
      i += n - 1
      // Collapsed whitespace has no box; a glyph that paints nothing needs no position.
      if (!r || !ch.trim()) continue
      const cy = (r.top + r.bottom) / 2
      let k = frags.findIndex((f) => cy >= f.top && cy <= f.bottom)
      if (k < 0) k = 0
      runs[k].xs.push(+(r.left - ox).toFixed(2))
      runs[k].ys.push(+(r.top - oy + ascent).toFixed(2))
      runs[k].chars += ch
    }
    runs.forEach((run, k) => {
      if (!run.chars) return
      const esc = run.chars.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      texts += `<text x="${run.xs.join(' ')}" y="${run.ys.join(' ')}" fill="url(#${id}-${k})" ` +
        `style="font:${font};font-kerning:none;letter-spacing:0;white-space:pre">${esc}</text>`
    })
  }
  if (!texts) return
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none')
  svg.innerHTML = `<defs>${defs}</defs>${texts}`
  if (cs.position === 'static') clone.style.setProperty('position', 'relative', 'important')
  clone.style.setProperty('color', 'transparent', 'important')
  clone.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
  clone.insertBefore(svg, clone.firstChild)
}
