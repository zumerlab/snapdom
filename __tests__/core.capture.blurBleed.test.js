// filter: blur(R) sets R as the Gaussian STANDARD DEVIATION, so the element paints well past
// R. The bleed used to be R exactly, which sliced the halo where it is still clearly opaque
// and gave the raster a hard rectangular edge. No demo in the visual suite carries a blurred
// capture root, so this is the only thing pinning it.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const R = 10
const SIZE = 40

function blurredBox() {
  const el = document.createElement('div')
  el.style.cssText = `width:${SIZE}px;height:${SIZE}px;background:#000;filter:blur(${R}px)`
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

describe('filter: blur() bleed', () => {
  it('captures the halo out to where the ink actually dies', async () => {
    const canvas = await snapdom.toCanvas(blurredBox(), { embedFonts: false, scale: 1, dpr: 1, backgroundColor: '#fff' })
    // The capture is the box plus bleed on each side; the box sits centred in it.
    const pad = Math.round((canvas.width - SIZE) / 2)
    expect(pad).toBeGreaterThanOrEqual(2 * R)

    const row = canvas.getContext('2d').getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
    // Walk in from the left edge: the outermost pixels must be background (the bleed is wide
    // enough that the halo has died), and the halo must still be visibly dark by R px in —
    // which is exactly the ink the old one-sigma bleed cut off.
    const at = (x) => row[x * 4]
    expect(at(0)).toBeGreaterThan(245)
    expect(at(pad - R)).toBeLessThan(235)
  })
})
