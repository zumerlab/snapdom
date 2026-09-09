// A caller-supplied canvas and the public capture geometry (imported from @zumer/snapdom).
//
// A live mirror loops captures into a canvas it owns; without these it pays a full-canvas
// copy per frame and cannot tell where the raster sits relative to the element it came from.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted
let iframe
afterEach(() => {
  mounted?.remove(); mounted = null
  iframe?.remove(); iframe = null
})

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

  it.each(['snapdom.toCanvas', 'result.toCanvas'])('%s paints and reuses a canvas from an iframe document', async (api) => {
    const el = mount()
    iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const target = iframe.contentDocument.createElement('canvas')
    expect(target instanceof HTMLCanvasElement).toBe(false)
    target.width = 5
    target.height = 7
    const ctx = target.getContext('2d')
    ctx.fillStyle = '#f00'
    ctx.fillRect(0, 0, target.width, target.height)

    const capture = async () => {
      if (api === 'snapdom.toCanvas') {
        return snapdom.toCanvas(el, { dpr: 1, canvas: target })
      }
      // The export-time target must override the capture-time target as well.
      const result = await snapdom(el, { dpr: 1, canvas: document.createElement('canvas') })
      return result.toCanvas({ canvas: target })
    }

    expect(await capture()).toBe(target)
    expect([target.width, target.height]).toEqual([120, 60])
    expect([target.style.width, target.style.height]).toEqual(['120px', '60px'])
    expect(pixel(target, 2, 2)).toEqual([0, 128, 255, 255])

    // Reusing the foreign canvas must resize it and clear the previous opaque frame.
    el.style.cssText = 'width:60px;height:30px;background:transparent'
    expect(await capture()).toBe(target)
    expect([target.width, target.height]).toEqual([60, 30])
    expect([target.style.width, target.style.height]).toEqual(['60px', '30px'])
    expect(pixel(target, 2, 2)).toEqual([0, 0, 0, 0])
  })

  it.each([
    ['string', () => 'not a canvas'],
    ['SVG canvas element', () => document.createElementNS('http://www.w3.org/2000/svg', 'canvas')],
  ])('ignores an invalid target (%s) and returns a fresh canvas', async (_label, makeTarget) => {
    const el = mount()
    const out = await snapdom.toCanvas(el, { dpr: 1, canvas: makeTarget() })
    expect(out).toBeInstanceOf(HTMLCanvasElement)
    expect(pixel(out, 5, 5).slice(0, 3)).toEqual([0, 128, 255])
  })
})

// The 'result.meta' describe that lived here was a payload-only duplicate of
// core.meta.test.js, which asserts the same geometry more tightly AND proves it in pixels —
// deleted per the v3 test-suite review; the caller-supplied-canvas coverage above is the
// part of this file no other test has.
