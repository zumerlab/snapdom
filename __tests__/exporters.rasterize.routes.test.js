// rasterize() picks its encode route by output size: the synchronous canvas.toDataURL below
// the threshold (faster end to end, and the main-thread block is about one frame), the
// off-thread canvas.toBlob above it (slower, but it does not freeze the page — measured at
// ~10.7ms of block per megapixel, so a large capture would stall visibly).
// Both routes must produce the same thing: a decoded <img> carrying a PNG data: URL.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function box(w, h) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;background:linear-gradient(to right, rgb(255,0,0), rgb(0,0,255))`
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

// The threshold is 2e6 device pixels.
const UNDER = [900, 700]   // 0.63 Mpx  -> synchronous route
const OVER = [1800, 1400]  // 2.52 Mpx  -> off-thread route

describe('rasterize encode routes', () => {
  for (const [label, [w, h]] of [['under the threshold', UNDER], ['over the threshold', OVER]]) {
    it(`produces a decoded PNG <img> ${label}`, async () => {
      const img = await snapdom.toPng(box(w, h), { scale: 1, dpr: 1, embedFonts: false })
      expect(img.tagName).toBe('IMG')
      expect(img.src.startsWith('data:image/png')).toBe(true)
      // decoded: naturalWidth is only populated once the bitmap exists, and the Safari paths
      // downstream depend on it.
      expect(img.naturalWidth).toBe(w)
      expect(img.naturalHeight).toBe(h)
    })

    it(`paints the same pixels ${label}`, async () => {
      const img = await snapdom.toPng(box(w, h), { scale: 1, dpr: 1, embedFonts: false })
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const at = (fx) => {
        const d = ctx.getImageData(Math.round((c.width - 1) * fx), Math.floor(c.height / 2), 1, 1).data
        return [d[0], d[2], d[3]]
      }
      const [lr, lb, la] = at(0)
      const [rr, rb, ra] = at(1)
      expect(la).toBe(255)
      expect(ra).toBe(255)
      expect(lr).toBeGreaterThan(200)  // red end
      expect(rb).toBeGreaterThan(200)  // blue end
      expect(rr).toBeLessThan(60)
      expect(lb).toBeLessThan(60)
    })
  }

  it('honours a non-PNG format on the synchronous route', async () => {
    const img = await snapdom.toJpg(box(...UNDER), { scale: 1, dpr: 1, embedFonts: false, quality: 0.8 })
    expect(img.src.startsWith('data:image/jpeg')).toBe(true)
  })
})
