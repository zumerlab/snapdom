import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let frame

afterEach(() => frame?.remove())

/** Captures the body of a page whose <html> has `zoom`, and finds the red box's first pixel. */
async function redOrigin(zoom) {
  frame = document.createElement('iframe')
  frame.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:300px;border:0'
  frame.srcdoc = `<!doctype html><html style="zoom:${zoom}"><body style="background:#fff">
    <p>text</p><div style="position:absolute;left:40px;top:60px;width:50px;height:30px;background:#f00"></div></body></html>`
  document.body.appendChild(frame)
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  const canvas = await (await snapdom(frame.contentDocument.body, { dpr: 1, scale: 1, embedFonts: false })).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] > 220 && data[i + 1] < 40 && data[i + 2] < 40) return [x, y]
    }
  }
  return null
}

describe('a page-anchored box in a body capture', () => {
  // The room between <html> and the body was measured in zoomed px and applied in the body's
  // own: with the default margins the box sat 1px left and 4px up at zoom 1.25.
  it('lands in the same place under a zoom on <html>', async () => {
    const plain = await redOrigin(1)
    frame.remove()
    expect(await redOrigin(1.25)).toEqual(plain)
  })
})
