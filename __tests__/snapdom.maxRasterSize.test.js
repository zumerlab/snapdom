// #425 — oversized captures (large element × scale × dpr) must not throw the opaque
// "EncodingError: The source image cannot be decoded"; snapdom clamps to the browser
// raster limit (16384px/side) and still returns a usable canvas.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const MAX = 16384

describe('#425 raster size clamping', () => {
  let el
  beforeEach(() => {
    el = document.createElement('div')
    el.style.cssText = 'width:1000px;height:1000px;background:#3366cc'
    document.body.appendChild(el)
  })
  afterEach(() => el.remove())

  it('clamps an oversized canvas instead of throwing', async () => {
    // 1000 × scale 20 = 20000px → over the 16384 cap.
    const canvas = await snapdom.toCanvas(el, { scale: 20, dpr: 1 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBeLessThanOrEqual(MAX)
    expect(canvas.height).toBeLessThanOrEqual(MAX)
    // aspect ratio preserved (square element → square canvas)
    expect(Math.abs(canvas.width - canvas.height)).toBeLessThanOrEqual(2)
  })

  it('clamps when dpr alone pushes past the limit', async () => {
    // 1000 × scale 10 × dpr 2 = 20000 device px.
    const canvas = await snapdom.toCanvas(el, { scale: 10, dpr: 2 })
    expect(canvas.width).toBeLessThanOrEqual(MAX)
    expect(canvas.height).toBeLessThanOrEqual(MAX)
  })

  it('leaves in-limit captures untouched', async () => {
    const canvas = await snapdom.toCanvas(el, { scale: 2, dpr: 1 })
    expect(canvas.width).toBe(2000)
    expect(canvas.height).toBe(2000)
  })
})
