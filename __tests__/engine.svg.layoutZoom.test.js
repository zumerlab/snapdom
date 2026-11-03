// #508: on Chromium and Firefox the svg engine lays the clone out at the live devicePixelRatio
// (`zoom` on the foreignObject's container, scale(1/zoom) on a <g> around it), so line boxes
// and borders round on the same device-pixel grid as the page. What that must NOT change is where
// content lands: viewBox, output size and every offset stay in CSS pixels.
//
// The runner's devicePixelRatio is 1, so these stub a real hi-DPI screen (stubHiDPI: the dpr and
// the finer live grid). A stubbed dpr alone is device emulation, which must not zoom. Pixel parity
// between the two runs is only meaningful on scenes without text or fractional borders, which do
// not depend on the grid; those are what these use.

import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { liveLayoutZoom } from '../src/engines/svg.js'
import { isSafari } from '../src/utils/browser.js'
import { stubHiDPI } from './helpers/hidpi.js'

const ZOOMS = !isSafari()
const mounted = []
const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
const ownGCS = window.getComputedStyle
function stubDPR(v) { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => v }) }
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
  if (own) Object.defineProperty(window, 'devicePixelRatio', own)
  else delete window.devicePixelRatio
  window.getComputedStyle = ownGCS
})
function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host.firstElementChild
}
const decode = (url) => decodeURIComponent(url.slice(url.indexOf(',') + 1))

/** Bounding box of the pure-red pixels, in output pixels. */
async function redBox(el, opts = {}) {
  return canvasRedBox(await (await snapdom(el, { dpr: 1, scale: 1, cache: 'disabled', burst: false, ...opts })).toCanvas())
}

/** Bounding box of the pure-red pixels of a canvas. */
function canvasRedBox(canvas) {
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x)
      if (data[i] > 220 && data[i + 1] < 40 && data[i + 2] < 40 && data[i + 3] > 220) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      }
    }
  }
  return { w: width, h: height, box: [x0, y0, x1, y1] }
}

describe('svg engine layout zoom (#508)', () => {
  it('wraps the foreignObject in scale(1/dpr) and zooms its container, not on WebKit', async () => {
    const el = mount('<div style="width:50px;height:30px;background:#f00"></div>')
    stubHiDPI(2.625)
    const svg = decode((await snapdom(el, { dpr: 1, cache: 'disabled', burst: false })).url)
    expect(svg).toMatch(/viewBox="0 0 50 30"/)
    if (ZOOMS) {
      expect(svg).toMatch(/<g transform="scale\(0\.38095\d*\)"><foreignObject[^>]* width="131\.25" height="78\.75"/)
      expect(svg).toMatch(/zoom: 2\.625 !important/)
    } else {
      expect(svg).not.toContain('<g transform=')
    }
  })

  it('changes nothing at a devicePixelRatio of 1', async () => {
    const el = mount('<div style="width:50px;height:30px;background:#f00"></div>')
    stubDPR(1)
    const svg = decode((await snapdom(el, { dpr: 1, cache: 'disabled', burst: false })).url)
    expect(svg).not.toContain('<g transform=')
    expect(svg).not.toMatch(/zoom: [\d.]+ !important/)
  })

  it('keeps content where it lands at 1x: shadow bleed moves it by padding', async () => {
    const el = mount(
      '<div style="position:relative;width:60px;height:40px;background:#fff;box-shadow:0 0 0 8px #00f">' +
      '<i style="position:absolute;left:10px;top:12px;width:20px;height:16px;background:#f00"></i></div>')
    const flat = await redBox(el, { outerShadows: true })
    stubHiDPI(2.625)
    const zoomed = await redBox(el, { outerShadows: true })
    expect(flat.box[0]).toBeGreaterThan(10) // the bleed offset is really there
    expect([zoomed.w, zoomed.h]).toEqual([flat.w, flat.h])
    for (let k = 0; k < 4; k++) expect(Math.abs(zoomed.box[k] - flat.box[k])).toBeLessThanOrEqual(1)
  })

  it('keeps content where it lands at 1x: a clip window moves it by foreignObject x/y', async () => {
    const el = mount(
      '<div style="position:relative;width:300px;height:200px;background:#fff">' +
      '<i style="position:absolute;left:150px;top:110px;width:24px;height:18px;background:#f00"></i></div>')
    const r = el.getBoundingClientRect()
    const clip = { x: r.left + scrollX + 120, y: r.top + scrollY + 90, width: 100, height: 60 }
    const flat = await redBox(el, { clip })
    stubHiDPI(2.625)
    const zoomed = await redBox(el, { clip })
    expect(flat.box).toEqual([30, 20, 53, 37])
    expect([zoomed.w, zoomed.h]).toEqual([flat.w, flat.h])
    for (let k = 0; k < 4; k++) expect(Math.abs(zoomed.box[k] - flat.box[k])).toBeLessThanOrEqual(1)
  })
})

// #552: the zoom only pays off when the browser rasterizes the svg. A file is opened by other
// renderers too (macOS Preview drew an inline <svg> under the container's zoom at twice its
// size), so toBlob svg, download svg and svgString hand out the 1x wrapper, while url and
// every raster export keep the zoomed one.
describe('svg files drop the layout zoom (#552)', () => {
  const RED = '<div style="width:50px;height:30px;background:#f00"></div>'
  const expectUnzoomed = (svg) => {
    expect(svg).not.toMatch(/zoom: [\d.]+ !important/)
    expect(svg).not.toContain('scale(')
  }

  it.skipIf(!ZOOMS)('toBlob svg is the 1x wrapper; url keeps the zoom', async () => {
    const el = mount(RED)
    stubHiDPI(2.625)
    const res = await snapdom(el, { cache: 'disabled', burst: false })
    const file = await (await res.toBlob({ format: 'svg' })).text()
    expectUnzoomed(file)
    expect(file).toMatch(/viewBox="0 0 50 30" font-size="[\d.]+px"><foreignObject[^>]* width="50" height="30"/)
    expect(decode(res.url)).toMatch(/zoom: 2\.625 !important/)
  })

  it.skipIf(!ZOOMS)('the static shortcut gets the same file', async () => {
    const el = mount(RED)
    stubHiDPI(2)
    expectUnzoomed(await (await snapdom.toBlob(el, { format: 'svg', cache: 'disabled', burst: false })).text())
  })

  it.skipIf(!ZOOMS)('svgString for plugins is the 1x wrapper', async () => {
    const el = mount(RED)
    stubHiDPI(2)
    let svgString = null
    const probe = { name: 'svg-string-probe', beforeExport(ctx) { svgString = ctx.export.svgString() } }
    await (await snapdom(el, { plugins: [probe], cache: 'disabled', burst: false })).toCanvas()
    expectUnzoomed(svgString)
    expect(svgString).toMatch(/<foreignObject[^>]* width="50" height="30"/)
  })

  it.skipIf(!ZOOMS)('draws what the page shows at 1x, clip window included', async () => {
    const el = mount(
      '<div style="position:relative;width:300px;height:200px;background:#fff">' +
      '<i style="position:absolute;left:150px;top:110px;width:24px;height:18px;background:#f00"></i></div>')
    const r = el.getBoundingClientRect()
    const clip = { x: r.left + scrollX + 120, y: r.top + scrollY + 90, width: 100, height: 60 }
    const flat = await redBox(el, { clip })
    stubHiDPI(2.625)
    const file = await (await snapdom.toBlob(el, { format: 'svg', clip, cache: 'disabled', burst: false })).text()
    expectUnzoomed(file)
    // A browser draws the zoomed file correctly too, so this pins the geometry of the swapped
    // wrapper (clip translate, foreignObject x/y, padding), not the viewer bug itself.
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }))
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    URL.revokeObjectURL(img.src)
    const fromFile = canvasRedBox(canvas)
    expect([fromFile.w, fromFile.h]).toEqual([flat.w, flat.h])
    for (let k = 0; k < 4; k++) expect(Math.abs(fromFile.box[k] - flat.box[k])).toBeLessThanOrEqual(1)
  })

  it('leaves a 1x capture untouched', async () => {
    const el = mount(RED)
    stubDPR(1)
    const res = await snapdom(el, { cache: 'disabled', burst: false })
    expect(await (await res.toBlob({ format: 'svg' })).text()).toBe(decode(res.url))
  })
})

// The live layout grid, not devicePixelRatio, decides the default. CDP device emulation
// (Playwright/Puppeteer deviceScaleFactor, DevTools device mode) reports dpr 2 and lays out at
// 1x; there the zoomed clone re-wrapped text and moved `line-height: normal` lines against the
// page it captured. A stubbed dpr on this 1x runner is that same situation.
describe('svg engine layout zoom follows the live layout grid', () => {
  const zoomOf = (svg) => (svg.match(/zoom: ([\d.]+) !important/) || [])[1] || null

  it('does not zoom when the page is laid out at 1x whatever dpr says', async () => {
    const el = mount('<div style="width:50px;height:30px;background:#f00"></div>')
    stubDPR(2)
    if (ZOOMS) expect(liveLayoutZoom(window)).toBe(1)
    const svg = decode((await snapdom(el, { dpr: 1, cache: 'disabled', burst: false })).url)
    expect(svg).not.toContain('<g transform=')
    expect(zoomOf(svg)).toBe(null)
  })

  it.skipIf(!ZOOMS)('zooms when the live grid is finer than CSS pixels', () => {
    // A zoomed root is a finer layout grid this runner can really produce: a 0.5px border then
    // computes to 0.5px, as it does on a real 2x screen.
    const root = document.documentElement
    const prev = root.style.zoom
    root.style.zoom = '2'
    try {
      stubDPR(2)
      expect(liveLayoutZoom(window)).toBe(2)
    } finally {
      root.style.zoom = prev
    }
  })

  it('zooms by devicePixelRatio on a real hi-DPI screen', async () => {
    const el = mount('<div style="width:50px;height:30px;background:#f00"></div>')
    stubHiDPI(2)
    const svg = decode((await snapdom(el, { dpr: 1, cache: 'disabled', burst: false })).url)
    expect(zoomOf(svg)).toBe(ZOOMS ? '2' : null)
  })

  it('leaves no probe behind in the document', () => {
    stubDPR(2)
    const before = document.body.childElementCount
    liveLayoutZoom(window)
    expect(document.body.childElementCount).toBe(before)
  })
})
