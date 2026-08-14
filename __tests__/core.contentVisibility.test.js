// `content-visibility: hidden` is an authoring decision, not a rendering optimization:
// the browser paints the element's own box and skips its contents outright, and a
// descendant's `visibility: visible` does NOT bring them back (verified against real
// Chromium). `auto` is the opposite: its contents are only skipped while offscreen and
// must be forced visible before capture (#281).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted = null
afterEach(() => { mounted?.remove(); mounted = null })

function pixelAt(canvas, fx, fy) {
  const x = Math.min(canvas.width - 1, Math.floor(canvas.width * fx))
  const y = Math.min(canvas.height - 1, Math.floor(canvas.height * fy))
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data
  return `${d[0]},${d[1]},${d[2]},${d[3]}`
}

const PURPLE = 'rgb(124,58,237)'
const RED = 'rgb(220,38,38)'

/** host (purple, 120x80) > kid (red, bottom half). */
function build(hostCss = '', kidCss = '') {
  const host = document.createElement('div')
  host.style.cssText =
    `width:120px;height:80px;background:${PURPLE};display:flex;flex-direction:column;` +
    `justify-content:flex-end;${hostCss}`
  const kid = document.createElement('div')
  kid.style.cssText = `width:120px;height:40px;background:${RED};${kidCss}`
  host.appendChild(kid)
  document.body.appendChild(host)
  mounted = host
  return host
}

describe('content-visibility in the captured raster', () => {
  it('keeps the element box but skips its contents when hidden', async () => {
    const host = build('content-visibility:hidden')
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    // Own background still paints...
    expect(pixelAt(canvas, 0.5, 0.25)).toBe('124,58,237,255')
    // ...and the skipped child does not.
    expect(pixelAt(canvas, 0.5, 0.75)).toBe('124,58,237,255')
  })

  it('ignores a descendant that tries to restore visibility', async () => {
    const host = build('content-visibility:hidden', 'visibility:visible')
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(pixelAt(canvas, 0.5, 0.75)).toBe('124,58,237,255')
  })

  it('still renders contents for content-visibility:auto (#281)', async () => {
    const host = build('content-visibility:auto')
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(pixelAt(canvas, 0.5, 0.25)).toBe('124,58,237,255')
    expect(pixelAt(canvas, 0.5, 0.75)).toBe('220,38,38,255')
  })

  it('collapses an auto-height hidden box the way the live DOM does', async () => {
    // With contents skipped, the box sizes as if empty: only padding and border remain.
    const host = build('content-visibility:hidden;height:auto;padding:8px;box-sizing:content-box')
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(host.getBoundingClientRect().height).toBeCloseTo(16, 0)
    expect(canvas.height).toBeLessThanOrEqual(20)
    expect(pixelAt(canvas, 0.5, 0.5)).toBe('124,58,237,255')
  })
})
