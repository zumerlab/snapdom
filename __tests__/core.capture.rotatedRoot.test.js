import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/index.js'

async function rasterize(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { ctx, w: c.width, h: c.height }
}

function boundsOf(ctx, w, h, test) {
  const d = ctx.getImageData(0, 0, w, h).data
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (test(d, (y * w + x) * 4)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, maxX, maxY }
}

// d31: fractional-size root with rotate() — the rotated bbox has a fractional extent that the
// svg raster size must not truncate, and the corners rotate outside the foreignObject box so
// the fo must be sized to the bbox far edge (browsers don't reliably paint fo overflow).
describe('rotated root capture', () => {
  it('renders the full rotated bbox without cutting edges', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;top:150px;left:150px;width:289.601px;height:287.994px;'
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'width:100%;height:100%;transform:rotate(5deg);'
    const content = document.createElement('div')
    content.style.cssText = 'width:100%;height:100%;border:2px solid rgb(255,0,0);background:rgb(0,128,0);'
    wrapper.appendChild(content)
    host.appendChild(wrapper)
    document.body.appendChild(host)

    try {
      const rect = wrapper.getBoundingClientRect()
      const result = await snapdom(wrapper)
      const { ctx, w, h } = await rasterize(result.url)
      // svg raster size must cover the full (fractional) rotated bbox
      expect(w).toBeGreaterThanOrEqual(Math.ceil(rect.width))
      expect(h).toBeGreaterThanOrEqual(Math.ceil(rect.height))
      // painted = red border or green fill; must reach all four edges
      const painted = boundsOf(ctx, w, h, (d, i) =>
        (d[i] > 180 && d[i + 1] < 100) || (d[i + 1] > 90 && d[i] < 100 && d[i + 2] < 100))
      expect(painted.minX).toBeLessThanOrEqual(2)
      expect(painted.minY).toBeLessThanOrEqual(2)
      expect(painted.maxX).toBeGreaterThanOrEqual(w - 3)
      expect(painted.maxY).toBeGreaterThanOrEqual(h - 3)
    } finally {
      host.remove()
    }
  })
})
