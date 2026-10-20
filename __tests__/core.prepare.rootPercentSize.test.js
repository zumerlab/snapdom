// The capture root's percentage min/max sizes resolve against its containing block in the
// page, but against the foreignObject's own container in the capture, which is about as wide
// as the root itself. A popup with `max-width:30%` of an 800px host came out a third of its
// width, with a fixed-layout child table spilling out of its background and border.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const OPTS = { embedFonts: false, scale: 1, dpr: 1 }
const RED = [255, 0, 0]
const GREEN = [0, 128, 0]

/** An 800x400 host with a red, padded box inside it, holding a fixed-layout table whose one
 *  green cell (text in the same green) is 60px tall and would grow the box past 240px. */
function popup(css, hostCss = 'position:relative;width:800px;height:400px') {
  const host = document.createElement('div')
  host.style.cssText = hostCss
  const box = document.createElement('div')
  box.style.cssText = `background:rgb(255,0,0);padding:6px;border:0;box-sizing:content-box;${css}`
  box.innerHTML = '<table style="table-layout:fixed;width:100%;border-collapse:collapse;border-spacing:0">' +
    '<tr><td style="padding:0;height:60px;background:rgb(0,128,0);color:rgb(0,128,0);overflow:hidden;white-space:nowrap">' +
    'A long value that a fixed table clips instead of growing</td></tr></table>'
  host.appendChild(box)
  document.body.appendChild(host)
  mounted.push(host)
  return box
}

const pixel = (canvas, x, y) => [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data]
const rgbNear = (px, rgb) => px[3] > 200 && px.slice(0, 3).every((v, i) => Math.abs(v - rgb[i]) <= 12)

/** The root painted at its live size: padding (red) at the right edge, the table (green) up to it. */
async function expectLiveWidth(box) {
  const w = box.getBoundingClientRect().width
  const canvas = await snapdom.toCanvas(box, OPTS)
  expect(canvas.width).toBe(Math.round(w))
  const y = 6 + 30
  expect(rgbNear(pixel(canvas, canvas.width - 3, y), RED), 'right padding is the root background').toBe(true)
  expect(rgbNear(pixel(canvas, canvas.width - 10, y), GREEN), 'the table reaches the right padding').toBe(true)
}

describe('capture root with percentage sizes', () => {
  it('max-width in % (absolute popup)', async () => {
    const box = popup('position:absolute;left:20px;top:20px;max-width:30%')
    expect(Math.round(box.getBoundingClientRect().width)).toBe(252) // 240 + 2 * 6
    await expectLiveWidth(box)
  })

  it('max-width in % inside calc()', async () => {
    await expectLiveWidth(popup('position:absolute;left:20px;top:20px;max-width:calc(30% - 20px)'))
  })

  it('max-width in % in normal flow', async () => {
    await expectLiveWidth(popup('max-width:40%'))
  })

  it('max-width in % on a fixed-position root', async () => {
    const box = popup('position:fixed;left:20px;top:20px;max-width:25%')
    await expectLiveWidth(box)
  })

  it('width and min-width in %', async () => {
    await expectLiveWidth(popup('position:absolute;left:20px;top:20px;width:30%'))
    // width:% already computes to px; min-width:100% of a 300px block is 300 + padding. Both
    // guard that the fix keeps them exact.
    const box = popup('min-width:100%;width:fit-content', 'width:300px')
    expect(Math.round(box.getBoundingClientRect().width)).toBe(312)
    await expectLiveWidth(box)
  })

  it('max-height in % of a definite containing block', async () => {
    const box = popup('position:absolute;left:20px;top:20px;width:200px;max-height:8%;overflow:hidden')
    const h = box.getBoundingClientRect().height
    expect(Math.round(h)).toBe(44) // 8% of 400 + 2 * 6
    const canvas = await snapdom.toCanvas(box, OPTS)
    expect(canvas.height).toBe(Math.round(h))
    // overflow:hidden clips at the padding edge, so the 60px cell paints down to the bottom
    // of the 44px box. In the capture the box used to be 8% of its own height and end at 15px.
    expect(rgbNear(pixel(canvas, 100, canvas.height - 2), GREEN), 'cell reaches the bottom edge').toBe(true)
    expect(rgbNear(pixel(canvas, 100, 6 + 15), GREEN)).toBe(true)
  })

  it('min-height in % of an auto-height parent stays inactive', async () => {
    const box = popup('min-height:50%', 'width:300px')
    const h = box.getBoundingClientRect().height
    const canvas = await snapdom.toCanvas(box, OPTS)
    expect(canvas.height).toBe(Math.round(h))
    expect(rgbNear(pixel(canvas, 150, canvas.height - 3), RED)).toBe(true)
  })

  it('leaves a root without percentages untouched', async () => {
    const box = popup('position:absolute;left:20px;top:20px;max-width:252px')
    const result = await snapdom(box, OPTS)
    const svg = decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
    expect(svg).not.toMatch(/max-width:\s*240px/)
    await expectLiveWidth(box)
  })
})
