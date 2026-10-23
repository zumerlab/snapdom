import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let frame
afterEach(() => frame?.remove())

const ROWS = '<div class="c">x</div>'.repeat(5)

async function captureBody(css, extra = '') {
  frame = document.createElement('iframe')
  frame.style.cssText = 'width:800px;height:300px;border:0'
  frame.srcdoc = `<!doctype html><html><head><style>.c{height:100px;background:rgb(204,204,204)}${css}</style></head><body>${ROWS}${extra}</body></html>`
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
})
