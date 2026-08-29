// A caller-supplied canvas and the public capture geometry (imported from @frostin/snapdom).
//
// A live mirror loops captures into a canvas it owns; without these it pays a full-canvas
// copy per frame and cannot tell where the raster sits relative to the element it came from.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted
afterEach(() => { mounted?.remove(); mounted = null })

function mount(css = 'width:120px;height:60px;background:rgb(0,128,255)') {
  mounted = document.createElement('div')
  mounted.style.cssText = css
  document.body.appendChild(mounted)
  return mounted
}

const pixel = (canvas, x, y) => Array.from(
  canvas.getContext('2d').getImageData(x, y, 1, 1).data,
)

describe('toCanvas — caller-supplied canvas', () => {
  it('draws into the given canvas and returns it', async () => {
    const el = mount()
    const target = document.createElement('canvas')
    const result = await snapdom(el, { dpr: 1 })
    const out = await result.toCanvas({ canvas: target })

    expect(out).toBe(target)
    expect(out.width).toBeGreaterThan(0)
    expect(pixel(out, 5, 5).slice(0, 3)).toEqual([0, 128, 255])
  })

  it('is reachable through the snapdom.toCanvas shorthand', async () => {
    const el = mount()
    const target = document.createElement('canvas')
    const out = await snapdom.toCanvas(el, { dpr: 1, canvas: target })
    expect(out).toBe(target)
    expect(pixel(out, 5, 5).slice(0, 3)).toEqual([0, 128, 255])
  })

  it('leaves nothing of the previous frame behind when the canvas is reused', async () => {
    const el = mount('width:120px;height:60px;background:rgb(0,128,255)')
    const target = document.createElement('canvas')
    await snapdom.toCanvas(el, { dpr: 1, canvas: target })

    // Same canvas, a smaller and differently coloured source.
    el.style.cssText = 'width:60px;height:30px;background:rgb(255,0,0)'
    const out = await snapdom.toCanvas(el, { dpr: 1, canvas: target })
    expect(out).toBe(target)
    expect(out.width).toBe(60)
    expect(out.height).toBe(30)
    expect(pixel(out, 5, 5).slice(0, 3)).toEqual([255, 0, 0])
  })

  it('ignores a value that is not a canvas and returns a fresh one', async () => {
    const el = mount()
    const out = await snapdom.toCanvas(el, { dpr: 1, canvas: 'not a canvas' })
    expect(out).toBeInstanceOf(HTMLCanvasElement)
    expect(pixel(out, 5, 5).slice(0, 3)).toEqual([0, 128, 255])
  })
})

describe('result.meta — the geometry the capture decided on', () => {
  it('reports the element box, the viewBox and where the box starts inside it', async () => {
    const el = mount()
    const result = await snapdom(el, { dpr: 1 })

    expect(result.meta).toBeTruthy()
    expect(result.meta.w0).toBeCloseTo(120, 0)
    expect(result.meta.h0).toBeCloseTo(60, 0)
    expect(result.meta.vbW).toBeGreaterThanOrEqual(result.meta.w0)
    expect(result.meta.vbH).toBeGreaterThanOrEqual(result.meta.h0)
    expect(Number.isFinite(result.meta.contentX)).toBe(true)
    expect(Number.isFinite(result.meta.contentY)).toBe(true)
    expect(result.meta.clip).toBeNull()
  })

  // What a caller redrawing the raster over the live element actually needs: an asymmetric
  // bleed moves the element's box inside the raster, and by different amounts per side.
  it('places the element box inside a raster widened asymmetrically by a shadow', async () => {
    const el = mount('width:120px;height:60px;background:rgb(0,128,255);box-shadow:40px 0 0 rgb(0,0,0)')
    const result = await snapdom(el, { dpr: 1, outerShadows: true })

    expect(result.meta.vbW).toBeGreaterThan(result.meta.w0 + 30)
    // The shadow falls to the right, so the element's box stays near the left edge.
    expect(result.meta.contentX).toBeLessThan(result.meta.vbW - result.meta.w0)
  })

  it('is frozen, so an export cannot rewrite what the capture measured', async () => {
    const el = mount()
    const result = await snapdom(el, { dpr: 1 })
    expect(Object.isFrozen(result.meta)).toBe(true)
  })
})
