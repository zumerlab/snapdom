import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let frame
afterEach(() => frame?.remove())

const ROWS = '<div class="c">x</div>'.repeat(5)

async function captureBody(css, extra = '', dir = 'ltr') {
  frame = document.createElement('iframe')
  frame.style.cssText = 'width:800px;height:300px;border:0'
  frame.srcdoc = `<!doctype html><html dir="${dir}"><head><style>.c{height:100px;background:rgb(204,204,204)}${css}</style></head><body>${ROWS}${extra}</body></html>`
  await new Promise(resolve => { frame.onload = resolve; document.body.appendChild(frame) })
  const body = frame.contentDocument.body
  const box = body.getBoundingClientRect()
  const canvas = await snapdom.toCanvas(body, { dpr: 1, embedFonts: false, cache: 'disabled' })
  return { canvas, box }
}

describe('a body capture is sized from the body box, not the margins around it', () => {
  it('drops the margin-bottom that collapses through the body', async () => {
    const { canvas, box } = await captureBody('body{margin:0}.c{margin-bottom:8px}')
    expect(box.height).toBe(532)
    expect(canvas.height).toBe(532)
  })

  it('drops the default body margin on both axes', async () => {
    const { canvas, box } = await captureBody('')
    expect([canvas.width, canvas.height]).toEqual([box.width, box.height])
  })

  it('drops a first child margin-top that collapses through the body', async () => {
    const { canvas } = await captureBody('body{margin:0}.c:first-child{margin-top:20px}')
    expect(canvas.height).toBe(500)
  })

  it('keeps content that overflows the body', async () => {
    const abs = await captureBody('body{margin:0}', '<div style="position:absolute;top:700px;width:50px;height:50px;background:red"></div>')
    expect(abs.canvas.height).toBe(750)
    frame.remove()
    const fixed = await captureBody('html,body{margin:0;height:200px}')
    expect(fixed.canvas.height).toBe(500)
    frame.remove()
    const wide = await captureBody('.c{width:1200px}')
    expect(wide.canvas.width).toBe(1200)
  })

  it('keeps what a child paints into the body margin, bounded by that margin', async () => {
    const ring = await captureBody('.c:first-child{outline:1px solid rgb(255,0,0)}')
    expect([ring.canvas.width, ring.canvas.height]).toEqual([ring.box.width + 2, ring.box.height + 1])
    const px = (x, y) => [...ring.canvas.getContext('2d').getImageData(x, y, 1, 1).data]
    expect(px(0, 50)).toEqual([255, 0, 0, 255])
    expect(px(ring.canvas.width - 1, 50)).toEqual([255, 0, 0, 255])
    expect(px(1, 50)).toEqual([204, 204, 204, 255])
    frame.remove()
    const shadow = await captureBody('.c:last-child{box-shadow:0 0 0 30px rgb(0,0,255)}')
    expect([shadow.canvas.width, shadow.canvas.height]).toEqual([shadow.box.width + 16, shadow.box.height + 8])
  })

  describe('page-anchored boxes land where the page puts them', () => {
    // First opaque pixel of an exact colour, as [x, y] in capture pixels.
    const find = (canvas, [r, g, b]) => {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          if (d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === 255) return [x, y]
        }
      }
      return null
    }
    const BOXES = '<div class="c" style="position:relative"><i style="position:absolute;left:50px;top:10px;width:20px;height:20px;background:rgb(0,255,0)"></i></div>' +
      '<b class="abs"></b><u style="position:fixed;left:200px;top:40px;width:20px;height:20px;background:rgb(0,0,255)"></u>'
    const ABS = '.abs{position:absolute;left:100px;top:150px;width:20px;height:20px;background:rgb(255,0,0)}'
    const expectInPlace = async (css, dir) => {
      const { canvas, box } = await captureBody(ABS + css, BOXES, dir)
      const doc = frame.contentDocument
      // Where the body box sits in the capture: offset by any ink painted left of / above it.
      const gray = find(canvas, [204, 204, 204])
      const at = (sel) => {
        const r = doc.querySelector(sel).getBoundingClientRect()
        return [Math.round(r.left - box.left) + gray[0], Math.round(r.top - box.top) + gray[1]]
      }
      expect(find(canvas, [255, 0, 0])).toEqual(at('b'))
      expect(find(canvas, [0, 255, 0])).toEqual(at('i'))
      expect(find(canvas, [0, 0, 255])).toEqual(at('u'))
    }

    it('with the default body margin', () => expectInPlace(''))
    it('with uneven body margins', () => expectInPlace('body{margin:30px 0 0 40px}'))
    it('under a margin-top that collapses through the body', () => expectInPlace('body{margin:0}.c:first-child{margin-top:20px}'))
    it('when a child inks the margin left of the body', () => expectInPlace('.c:first-child{box-shadow:-6px 0 0 rgb(9,9,9)}'))
    it('when the body itself is positioned', () => expectInPlace('body{position:relative}'))
    it('on a right-to-left page', () => expectInPlace('', 'rtl'))
    it('on a right-to-left page with uneven margins', () => expectInPlace('body{margin:30px 40px 0 10px}', 'rtl'))
  })

  it('grows a right-to-left body capture on the left, where its content spills', async () => {
    const edges = '.c:first-child{width:1200px;background:linear-gradient(90deg,rgb(255,0,0) 0 50px,rgb(204,204,204) 50px)}'
    const { canvas, box } = await captureBody(edges, '', 'rtl')
    const px = (x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]
    expect(canvas.width).toBe(1200)
    expect(px(0, 50)).toEqual([255, 0, 0, 255])
    // The second row is as wide as the body and ends at the capture's right edge.
    expect(px(1200 - box.width - 1, 150)[3]).toBe(0)
    expect(px(1200 - box.width, 150)).toEqual([204, 204, 204, 255])
  })
})
