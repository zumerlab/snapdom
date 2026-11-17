import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { jxl as plugin } from '../packages/plugins/jxl.js'
import * as captureComplete from 'jpegxl/capture-complete'
import { decode } from 'jpegxl/decode'

const made = []
afterEach(async () => { while (made.length) await made.pop()(); clearPlugins(); document.querySelectorAll('[data-t]').forEach(e => e.remove()) })

const pixels = c => ({ width: c.width, height: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data })
function recording() {
  const calls = []
  // The pixels are copied at the call: the plugin empties its own canvases once the export ends.
  return { calls, prepare: k => captureComplete.prepare(k), capture: (canvas, options) => { calls.push({ canvas: pixels(canvas), ...options }); return captureComplete.capture(canvas, options) } }
}

// A noisy photo (an img of twice its shown size, so a larger export restores it) with a headline over it, and a caption beside it.
function noise(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d'), d = g.createImageData(w, h)
  for (let i = 0; i < d.data.length; i += 4) { const v = (i * 2654435761 >>> 24); d.data.set([v, 255 - v, (v * 7) & 255, 255], i) }
  g.putImageData(d, 0, 0)
  return c.toDataURL()
}
async function page({ over = true, text = 'color:#fff', box = '' } = {}) {
  const el = document.createElement('div')
  el.dataset.t = ''
  el.style.cssText = `position:absolute;left:0;top:0;width:360px;height:180px;background:#fff;font:700 30px sans-serif;${box}`
  const photo = new Image()
  photo.src = noise(400, 320)
  photo.style.cssText = 'position:absolute;left:10px;top:10px;width:200px;height:160px'
  const headline = document.createElement('span')
  headline.textContent = 'Headline'
  headline.style.cssText = `position:absolute;left:${over ? 24 : 230}px;top:70px;${text}`
  el.append(photo, headline)
  document.body.append(el)
  await photo.decode()
  return el
}

// Every sample the text draws (where the same export with its text red differs) comes back exact; the encoder's
// drawing without text differs from the canvas only inside the boxes it releases.
const RED = 'color:#f00!important;-webkit-text-fill-color:#f00!important;text-shadow:none!important'
async function textExact(el, exportOptions, red = RED) {
  const codec = recording()
  const result = await snapdom(el, { plugins: [plugin({ codec })], embedFonts: false, dpr: 1 })
  const blob = await result.toBlob({ format: 'jxl', ...exportOptions })
  const call = codec.calls.at(-1)
  const { canvas, withoutText } = call
  const hide = Object.assign(document.createElement('style'), { textContent: `[data-t] span{${red}}` })
  document.head.append(hide)
  const bare = pixels(await (await snapdom(el, { embedFonts: false, dpr: 1 })).toCanvas({ backgroundColor: '#ffffff', ...exportOptions }))
  hide.remove()
  const { data } = await decode(new Uint8Array(await blob.arrayBuffer()), { format: 'uint8', colorSpace: 'srgb' })
  const a = canvas.data, same = (x, y, i) => x[i] === y[i] && x[i + 1] === y[i + 1] && x[i + 2] === y[i + 2]
  let text = 0, wrong = 0, outside = 0
  for (let i = 0; i < a.length; i += 4) {
    if (!same(a, bare.data, i)) { text++; if (!same(a, data, i)) wrong++ }
    if (withoutText && !same(a, withoutText.data, i)) {
      const x = (i >> 2) % canvas.width, y = Math.floor((i >> 2) / canvas.width)
      if (!withoutText.rects.some(r => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)) outside++
    }
  }
  expect(text, 'text samples').toBeGreaterThan(50)
  expect(wrong, 'text samples wrong').toBe(0)
  expect(outside, 'samples changed outside the released text').toBe(0)
  return call
}

it('text over a photo: the encoder gets the page without its text, and every text sample comes back exact', async () => {
  const { withoutText } = await textExact(await page())
  expect(withoutText, 'one mask draw').toBeTruthy()
})

for (const [name, o] of [['dpr 2', { dpr: 2 }], ['scale 1.5', { scale: 1.5 }], ['a crop', { crop: { x: 15, y: 50, width: 200, height: 80 } }]]) {
  it(`text over a photo, ${name}: every text sample comes back exact`, async () => {
    const { withoutText } = await textExact(await page(), o)
    expect(withoutText).toBeTruthy()
  })
}

it('text over a photo, a larger export that restores the photo\'s original: every text sample comes back exact', async () => {
  // Captured at 1x, the photo is kept at its shown size; a 2x export draws its original.
  const { withoutText } = await textExact(await page(), { width: 640 })
  expect(withoutText).toBeTruthy()
})

for (const [name, text, red] of [['gradient text', 'background:linear-gradient(90deg,#0f0,#00f);-webkit-background-clip:text;background-clip:text;color:transparent', `${RED};background:none!important`],
  ['white text on a white box', 'color:#fff;background:#fff;padding:4px']]) {
  it(`${name} over a photo: every text sample comes back exact`, async () => {
    await textExact(await page({ text }), {}, red)
  })
}

it('text over a photo on a page with a box-shadow: every text sample comes back exact', async () => {
  await textExact(await page({ box: 'box-shadow:0 4px 8px rgba(0,0,0,.3)' }), { dpr: 2 })
})

it('text beside a photo: the page is drawn once', async () => {
  const codec = recording()
  const result = await snapdom(await page({ over: false }), { plugins: [plugin({ codec })], embedFonts: false, dpr: 1 })
  await result.toBlob({ format: 'jxl' })
  expect(codec.calls.some(c => c.withoutText)).toBe(false)
})
