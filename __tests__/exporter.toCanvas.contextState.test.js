// toCanvas scaled its context by dpr to paint the background and the WebKit shadow resample
// in CSS pixels, and returned the canvas with that scale still set. A caller drawing on the
// result in bitmap pixels, the only coordinates a canvas exposes, landed dpr times too far:
// a badge at (width - 20, height - 20) on a 2x capture fell outside the canvas.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function card(css = 'background:rgb(0,0,255)') {
  const el = document.createElement('div')
  el.style.cssText = `width:100px;height:50px;${css}`
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

const BASE = { embedFonts: false }
const px = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data]
const isIdentity = (t) => [t.a, t.b, t.c, t.d, t.e, t.f].join() === '1,0,0,1,0,0'

/** Stamp a 10x10 red badge in the bottom-right corner, in canvas pixels, and read it back. */
function stamp(canvas) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgb(255,0,0)'
  ctx.fillRect(canvas.width - 10, canvas.height - 10, 10, 10)
  return px(ctx, canvas.width - 5, canvas.height - 5)
}

describe('toCanvas returns a canvas with an identity transform', () => {
  it.each([
    ['dpr 2', { dpr: 2 }, [200, 100]],
    ['dpr 2 with scale 1.5', { dpr: 2, scale: 1.5 }, [300, 150]],
    ['dpr 1.5', { dpr: 1.5 }, [150, 75]],
    ['dpr 2 with a crop', { dpr: 2, crop: { x: 0, y: 0, width: 50, height: 50 } }, [100, 100]],
  ])('%s', async (_, { crop, ...opts }, size) => {
    const result = await snapdom(card(), { ...BASE, ...opts })
    const canvas = await result.toCanvas(crop ? { crop } : undefined)
    expect([canvas.width, canvas.height]).toEqual(size)
    expect(isIdentity(canvas.getContext('2d').getTransform())).toBe(true)
    expect(stamp(canvas)).toEqual([255, 0, 0, 255])
  })

  it('still fills backgroundColor over the whole bitmap at dpr 2', async () => {
    const canvas = await snapdom.toCanvas(card('background:transparent'), { ...BASE, dpr: 2, backgroundColor: 'rgb(0,255,0)' })
    const ctx = canvas.getContext('2d')
    expect(isIdentity(ctx.getTransform())).toBe(true)
    expect(px(ctx, 1, 1)).toEqual([0, 255, 0, 255])
    expect(px(ctx, canvas.width - 1, canvas.height - 1)).toEqual([0, 255, 0, 255])
  })

  it('draws the capture over the whole bitmap at dpr 2', async () => {
    const canvas = await snapdom.toCanvas(card(), { ...BASE, dpr: 2 })
    const ctx = canvas.getContext('2d')
    expect(px(ctx, 1, 1)).toEqual([0, 0, 255, 255])
    expect(px(ctx, canvas.width - 1, canvas.height - 1)).toEqual([0, 0, 255, 255])
  })

  it('hands back a caller-provided canvas the same way', async () => {
    const target = document.createElement('canvas')
    const canvas = await snapdom.toCanvas(card(), { ...BASE, dpr: 2, canvas: target })
    expect(canvas).toBe(target)
    expect(isIdentity(target.getContext('2d').getTransform())).toBe(true)
    // A second capture into the same canvas does not compound anything.
    await snapdom.toCanvas(card(), { ...BASE, dpr: 2, canvas: target })
    expect(isIdentity(target.getContext('2d').getTransform())).toBe(true)
    expect(stamp(target)).toEqual([255, 0, 0, 255])
  })
})
