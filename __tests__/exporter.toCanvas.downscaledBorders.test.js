import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// A 1px border exported at scale 0.5 is half a pixel wide. Chromium and WebKit antialias it to
// a fainter line; Firefox snaps each edge on its own and dropped some outright at DPR 1, where
// the #516 grid raster did not run. Every side must leave ink, the way a screenshot of the page
// scaled down keeps it.

describe('1px borders in an export smaller than the layout', () => {
  let host
  afterEach(() => host?.remove())

  it('keeps every vertical edge at scale 0.5', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:relative;width:300px;height:40px;background:#fff'
    const boxes = []
    for (let i = 0; i < 20; i++) {
      const b = document.createElement('div')
      // Fractional lefts land the edges on both pixel parities of the half-size output.
      b.style.cssText = `position:absolute;top:8px;left:${4 + i * 14.3}px;width:9px;height:24px;border:1px solid #000;box-sizing:border-box`
      host.appendChild(b)
      boxes.push(b)
    }
    document.body.appendChild(host)
    const origin = host.getBoundingClientRect()
    const scale = 0.5
    const canvas = await snapdom.toCanvas(host, { dpr: 1, scale, cache: 'disabled' })
    const ctx = canvas.getContext('2d')
    const y = Math.round(20 * scale)
    const row = ctx.getImageData(0, y, canvas.width, 1).data
    const inkNear = (x) => {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x * scale) + dx
        if (px >= 0 && px < canvas.width && row[px * 4] < 215) return true
      }
      return false
    }
    const lost = []
    for (const [i, b] of boxes.entries()) {
      const r = b.getBoundingClientRect()
      if (!inkNear(r.left - origin.left)) lost.push(`${i}L`)
      if (!inkNear(r.right - origin.left - 1)) lost.push(`${i}R`)
    }
    expect(lost).toEqual([])
  })
})
