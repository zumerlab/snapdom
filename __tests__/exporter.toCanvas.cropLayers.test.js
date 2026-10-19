// toCanvas({ crop }) on content that paints through its own layers.
//
// WebKit draws the layered boxes of an svg-as-image foreignObject (position:relative/absolute,
// opacity, transform) as if the viewBox started at 0 0, so a crop that only moved the viewBox
// origin handed every window of a strip the first window's text. The solid-band crop cases
// in core.meta.test.js are normal-flow blocks, which WebKit does move, so they never saw it.
// Run with BROWSER=webkit to exercise the engine; the geometry cases hold on every engine.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { cropSvgText } from '../src/exporters/toCanvas.js'

const added = []
afterEach(() => { while (added.length) added.pop().remove() })

const SLIDES = [[192, 57, 43], [39, 174, 96], [41, 128, 185], [142, 68, 173]]
const css = ([r, g, b]) => `rgb(${r},${g},${b})`

function strip() {
  const root = document.createElement('div')
  root.style.cssText = 'display:flex;width:400px;height:100px;margin:0'
  SLIDES.forEach((color, i) => {
    const slide = document.createElement('div')
    // position:relative is the trigger: it gives the slide (and its marks) a layer.
    slide.style.cssText = `position:relative;flex:none;width:100px;height:100px;background:${css(color)}`
    const mark = document.createElement('div')
    // A black mark at a different x per slide, so a window that shows the wrong slide's
    // marks fails even if its background happened to match.
    mark.style.cssText = `position:absolute;top:60px;left:${10 + i * 20}px;width:15px;height:15px;background:#000`
    slide.appendChild(mark)
    root.appendChild(slide)
  })
  document.body.appendChild(root)
  added.push(root)
  return root
}

const pixel = (canvas, x, y) => [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data].slice(0, 3)
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8)

describe('toCanvas crop on layered content', () => {
  it('gives every window of a strip its own slide and marks', async () => {
    const result = await snapdom(strip(), { dpr: 1 })
    const { contentX, contentY } = result.meta
    for (let i = 0; i < SLIDES.length; i++) {
      const canvas = await result.toCanvas({ crop: { x: contentX + i * 100, y: contentY, width: 100, height: 100 }, scale: 1, dpr: 1 })
      expect(canvas.width).toBe(100)
      expect(near(pixel(canvas, 50, 20), SLIDES[i]), `slide ${i + 1} background`).toBe(true)
      expect(near(pixel(canvas, 17 + i * 20, 67), [0, 0, 0]), `slide ${i + 1} mark`).toBe(true)
      // Slide 1's mark position must NOT be black on the other slides.
      if (i > 0) expect(near(pixel(canvas, 17, 67), [0, 0, 0]), `slide ${i + 1} shows slide 1's mark`).toBe(false)
    }
  })

  it('crops a root with bleed on both axes', async () => {
    const root = strip()
    root.style.boxShadow = '12px 18px 0 #000'
    const result = await snapdom(root, { dpr: 1, outerShadows: true })
    const { contentX, contentY } = result.meta
    expect(contentX).toBeGreaterThan(0)
    const canvas = await result.toCanvas({ crop: { x: contentX + 200, y: contentY + 50, width: 100, height: 50 }, scale: 1, dpr: 1 })
    expect(near(pixel(canvas, 50, 5), SLIDES[2]), 'third slide, lower half').toBe(true)
    expect(near(pixel(canvas, 57, 17), [0, 0, 0]), 'third slide mark').toBe(true)
  })
})

describe('cropSvgText shiftContent', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">' +
    '<foreignObject x="0" y="-5" width="400" height="105"><div xmlns="http://www.w3.org/1999/xhtml"></div></foreignObject></svg>'

  it('moves the root foreignObject and keeps the window at the viewport origin', () => {
    const out = cropSvgText(svg, { x: 200, y: 10, width: 100, height: 50 }, { shiftContent: true })
    expect(out).toMatch(/^<svg [^>]*width="100" height="50" viewBox="0 0 100 50">/)
    expect(out).toMatch(/<foreignObject x="-200" y="-15" /)
  })

  it('keeps the viewBox rewrite where there is no root foreignObject to move', () => {
    const header = svg.match(/<svg\b[^>]*>/)[0]
    expect(cropSvgText(header, { x: 200, y: 10, width: 100, height: 50 }, { shiftContent: true }))
      .toMatch(/viewBox="200 10 100 50"/)
    const zoomed = svg.replace('">', '"><g transform="scale(0.5)">').replace('</svg>', '</g></svg>')
    const out = cropSvgText(zoomed, { x: 200, y: 10, width: 100, height: 50 }, { shiftContent: true })
    expect(out).toMatch(/viewBox="200 10 100 50"/)
    expect(out).toMatch(/<foreignObject x="0" y="-5" /)
  })

  it('is the old viewBox rewrite when off', () => {
    const out = cropSvgText(svg, { x: 200, y: 10, width: 100, height: 50 }, { shiftContent: false })
    expect(out).toMatch(/viewBox="200 10 100 50"/)
    expect(out).toMatch(/<foreignObject x="0" y="-5" /)
  })
})
