import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// A single-letter <mi> renders italic. WebKit chooses that glyph while computing the token's
// preferred width, which never ran once every MathML box carried a frozen width: the capture
// came out upright. Measured on an <mi>l</mi>: an upright l has the same left ink edge at its
// top and its bottom, an italic one leans right.

function lean(canvas, box) {
  const { data, width } = canvas.getContext('2d').getImageData(box.x, box.y, box.w, box.h)
  const leftInk = (row) => {
    for (let x = 0; x < width; x++) if (data[(row * width + x) * 4] < 110) return x
    return -1
  }
  const rows = []
  for (let y = 0; y < box.h; y++) if (leftInk(y) >= 0) rows.push(y)
  const span = rows.at(-1) - rows[0]
  return leftInk(rows[0] + Math.floor(span * 0.15)) - leftInk(rows.at(-1) - Math.floor(span * 0.15))
}

describe('MathML tokens', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('keeps the automatic italic of a single-letter <mi>', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:600px;display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#fff;color:#000;font:15px/1.45 Arial, sans-serif'
    host.innerHTML = '<details open><summary>Open</summary>Body</details><div style="font-size:20px">' +
      '<math display="block"><mrow><mi>l</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo>' +
      '<msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow>' +
      '<mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow></math></div>'
    document.body.appendChild(host)
    const r = host.querySelector('mi').getBoundingClientRect()
    const h = host.getBoundingClientRect()
    const scale = 4
    const canvas = await snapdom.toCanvas(host, { dpr: 1, scale, cache: 'disabled' })
    const box = {
      x: (Math.floor(r.left - h.left) - 2) * scale, y: Math.floor(r.top - h.top) * scale,
      w: (Math.ceil(r.width) + 6) * scale, h: Math.ceil(r.height) * scale,
    }
    expect(lean(canvas, box)).toBeGreaterThan(scale)
  })
})
