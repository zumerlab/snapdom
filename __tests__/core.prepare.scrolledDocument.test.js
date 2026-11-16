import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let frame

afterEach(() => frame?.remove())

/** A 1200px page in a 300px frame, scrolled 400px: red block on top, blue block at the end. */
async function scrolledPage() {
  frame = document.createElement('iframe')
  frame.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:300px;border:0'
  frame.srcdoc = `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="height:100px;background:#f00"></div><div style="height:1000px"></div>
    <div style="height:100px;background:#00f"></div>
    <div style="position:fixed;top:0;left:0;width:100px;height:20px;background:#0f0"></div></body></html>`
  document.body.appendChild(frame)
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  frame.contentWindow.scrollTo(0, 400)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  return frame.contentDocument
}

describe('capturing the document element of a scrolled window', () => {
  it('paints the whole page from its top, not the scrolled view', async () => {
    const doc = await scrolledPage()
    expect(doc.documentElement.scrollTop).toBe(400)
    const canvas = await (await snapdom(doc.documentElement, { dpr: 1, scale: 1, embedFonts: false })).toCanvas()
    expect(canvas.height).toBeGreaterThanOrEqual(1200)
    const ctx = canvas.getContext('2d')
    const at = (y) => Array.from(ctx.getImageData(150, y, 1, 1).data.slice(0, 3))
    expect(at(50)).toEqual([255, 0, 0])
    expect(at(1150)).toEqual([0, 0, 255])
  })

  // A fixed bar shows 400px down the page, where the viewport is, not at the page top.
  for (const root of ['body', 'documentElement']) {
    it(`paints a fixed bar where it shows, with ${root} as the root`, async () => {
      const doc = await scrolledPage()
      const canvas = await (await snapdom(doc[root], { dpr: 1, scale: 1, embedFonts: false })).toCanvas()
      const ctx = canvas.getContext('2d')
      const at = (y) => Array.from(ctx.getImageData(50, y, 1, 1).data.slice(0, 3))
      expect(at(410)).toEqual([0, 255, 0])
      expect(at(10)).toEqual([255, 0, 0])
    })
  }
})
