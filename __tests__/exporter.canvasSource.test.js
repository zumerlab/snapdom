// engine:'html-in-canvas' hands buildResult the painted canvas itself and the pixel
// exporters consume it directly — the PNG round trip it replaces (toDataURL + decode)
// costs 15-22x the direct draw (62 vs 4 ms on a card, 4.2 s vs 210 ms at 29 Mpx, measured
// 2026-09-03). The engine cannot run in CI browsers (no drawElementImage), but the seam it
// feeds — toCanvas/toBlob taking an HTMLCanvasElement source — is plain code, tested here.
//
// Proven to fail: flipping the width-only aspect math turns the sizing test red; removing
// the toBlob svg guard turns its test red (a Blob of base64 garbage comes back instead).
import { describe, it, expect } from 'vitest'
import { toCanvas } from '../src/exporters/toCanvas.js'
import { toBlob } from '../src/exporters/toBlob.js'

/** A painted source: red left half, blue right half, transparent bottom stripe. */
function paintedSource(w = 200, h = 100) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')
  x.fillStyle = '#e33'
  x.fillRect(0, 0, w / 2, h - 20)
  x.fillStyle = '#33e'
  x.fillRect(w / 2, 0, w / 2, h - 20)
  return c
}

const px = (canvas, x, y) =>
  Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data)

describe('toCanvas — HTMLCanvasElement source (engine handoff)', () => {
  it('draws the source pixels without any decode round trip', async () => {
    const out = await toCanvas(paintedSource(), { scale: 1, dpr: 1 })
    expect([out.width, out.height]).toEqual([200, 100])
    expect(px(out, 50, 40)).toEqual([238, 51, 51, 255])
    expect(px(out, 150, 40)).toEqual([51, 51, 238, 255])
  })

  it('honors the one sizing rule: width is absolute and keeps aspect', async () => {
    const out = await toCanvas(paintedSource(), { width: 100, scale: 3, dpr: 1 })
    // width wins, scale is ignored when width/height are set, aspect 2:1 preserved
    expect([out.width, out.height]).toEqual([100, 50])
    expect(px(out, 25, 20)).toEqual([238, 51, 51, 255])
  })

  it('dpr multiplies device pixels; scale applies when no width/height', async () => {
    const out = await toCanvas(paintedSource(), { scale: 2, dpr: 2 })
    expect([out.width, out.height]).toEqual([800, 400])
    expect(out.style.width).toBe('400px')
    expect(px(out, 700, 100)).toEqual([51, 51, 238, 255])
  })

  it('reuses a caller-provided target canvas', async () => {
    const target = document.createElement('canvas')
    const out = await toCanvas(paintedSource(), { scale: 1, dpr: 1, canvas: target })
    expect(out).toBe(target)
    expect(px(target, 50, 40)).toEqual([238, 51, 51, 255])
  })

  it('flattens backgroundColor behind transparent source pixels', async () => {
    const out = await toCanvas(paintedSource(), { scale: 1, dpr: 1, backgroundColor: '#0a0' })
    // the bottom 20px stripe of the source is transparent → background shows
    expect(px(out, 100, 95).slice(0, 3)).toEqual([0, 170, 0])
    // painted pixels stay on top
    expect(px(out, 50, 40)).toEqual([238, 51, 51, 255])
  })

  it('toBlob: raster formats work from a canvas source, svg fails with the reason', async () => {
    const blob = await toBlob(paintedSource(), { format: 'png' })
    expect(blob.type).toBe('image/png')
    await expect(toBlob(paintedSource(), { format: 'svg' }))
      .rejects.toThrow(/raster capture/)
  })
})
