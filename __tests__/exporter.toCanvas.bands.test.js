// toCanvas draws a large capture as horizontal bands from ONE decoded image (drawBanded):
// Chromium's svg-as-image draw is superlinear in the destination size (deep tree 517 → 123 ms
// at 8 bands), WebKit gains too, Firefox is flat. The bands must be invisible: same pixels as
// the single draw the exporter used to make, at scale 1 and under dpr.
//
// Proven to fail: shifting a band's source rect by one row (`y0 * k + 1`) turns the parity
// tests red by thousands of pixels; raising BAND_MIN_AREA above the scene turns the
// call-count test red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { toCanvas } from '../src/exporters/toCanvas.js'
import { isSafari } from '../src/utils/browser.js'

let el = null
afterEach(() => { el?.remove(); el = null; vi.restoreAllMocks() })

/** ~5.1 Mpx of nested boxes with borders and text: past the 4 Mpx band gate, with edges on
 *  every row so a misaligned band cannot hide. */
function mountTall() {
  el = document.createElement('div')
  el.style.cssText = 'width:1020px;font:11px Arial,sans-serif;color:#333;background:#fafafa'
  let rows = ''
  for (let i = 0; i < 250; i++) {
    rows += '<div style="display:flex;gap:2px;padding:2px;border:1px solid rgba(0,0,0,.2);height:14px">' +
      `<div style="flex:1;background:hsl(${(i * 17) % 360},60%,85%);border-radius:2px">${i}</div>` +
      `<div style="flex:2;border-left:1px dashed #888">row ${i}</div></div>`
  }
  el.innerHTML = rows
  document.body.appendChild(el)
  return el
}

/** The single draw toCanvas used to do, on the same decoded image. */
async function wholeDraw(url, dpr) {
  const img = new Image()
  img.decoding = 'sync'
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth * dpr
  c.height = img.naturalHeight * dpr
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (dpr !== 1) ctx.scale(dpr, dpr)
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)
  return c
}

function differing(a, b) {
  expect(a.width).toBe(b.width)
  expect(a.height).toBe(b.height)
  const da = a.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, a.width, a.height).data
  const db = b.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, b.width, b.height).data
  let n = 0
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) n++
  }
  return n
}

describe('toCanvas — banded draw of large captures', () => {
  it('is drawn in bands past the area gate, and in one draw below it', async () => {
    const url = await snapdom.toRaw(mountTall(), { burst: false })
    // Safari's waitForImgPaint probe-draws the image into a 16x16 canvas first: count only
    // the draws that land on the output canvas.
    const spy = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
    const outputDraws = () => spy.mock.instances.filter((c) => c.canvas.width > 16).length
    await toCanvas(url, { scale: 1, dpr: 1 })
    const big = outputDraws()
    spy.mockClear()
    // A quarter of the height: ~1.3 Mpx, one draw.
    await toCanvas(url, { scale: 1, dpr: 1, crop: { x: 0, y: 0, width: 1020, height: 1250 } })
    const small = outputDraws()
    expect(big).toBeGreaterThanOrEqual(2)
    expect(small).toBe(1)
  }, 60_000)

  // WebKit: the exporter's output differs from a main-document whole draw by 0.9% of the pixels
  // here (24% on a 300-row table in real Safari 26.5) WITH THE BANDS OFF — the same counts to
  // the pixel with them on (173,283 / 1,542,836 vs 1,542,837, measured through safaridriver).
  // That difference belongs to the decode-frame path and predates this; the parity these two
  // tests pin is band geometry, which is engine-independent code, so they run where the
  // baseline is the exporter's own raster.
  const parity = isSafari() ? it.skip : it
  parity('matches the single draw pixel for pixel at scale 1 (tile-seam tolerance only)', async () => {
    const url = await snapdom.toRaw(mountTall(), { burst: false })
    const banded = await toCanvas(url, { scale: 1, dpr: 1 })
    const whole = await wholeDraw(url, 1)
    // Chromium's one-shot raster of a big image carries its own 256px tile seams (one grey
    // level, a pixel or two per seam row); anything structural differs by whole rows.
    expect(differing(banded, whole)).toBeLessThan(100)
  }, 60_000)

  parity('matches the single draw under dpr 2', async () => {
    const url = await snapdom.toRaw(mountTall(), { burst: false })
    const banded = await toCanvas(url, { scale: 1, dpr: 2 })
    const whole = await wholeDraw(url, 2)
    expect(differing(banded, whole)).toBeLessThan(400)
  }, 60_000)
})
