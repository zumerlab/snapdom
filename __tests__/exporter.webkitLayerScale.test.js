// WebKit draws a box with its own layer (position, opacity, transform) inside an svg-as-image
// foreignObject without the viewBox-to-viewport scale (WebKit bug 23113): a share card exported
// at 2x came out at half size in the top-left corner over a full-size backdrop (LodyAI/Lody#2250).
// The marker is a positioned magenta box; its bounding box in each export path is compared
// with where the scale puts it. Before the fix, Playwright WebKit and real Safari 27.0.1 (DPR 2)
// both measured the marker at its 1x place and size on the toSvg paths only: the canvas paths
// scale the whole image, not the viewBox, and were right already. The chromium and firefox runs
// prove the rewrite only runs where isSafari() says so.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { for (const el of mounted.splice(0)) el.remove() })

function card(shadow) {
  const el = document.createElement('div')
  el.style.cssText = 'box-sizing:border-box;width:392px;padding:16px;background:#183f60;font:15px Arial'
  el.innerHTML = `<div style="position:relative;padding:24px 20px;background:#fff;border-radius:22px;${shadow ? 'box-shadow:0 28px 70px -20px rgba(2,10,18,.6)' : ''}">` +
    '<div class="mk" style="position:absolute;left:260px;top:20px;width:32px;height:18px;background:rgb(255,0,255)"></div>' +
    '<h2 style="font-size:17px;margin:0 0 8px">Exporting a clear conversation</h2>' +
    '<p style="margin:0">Small text, punctuation and fine details: 0123456789.</p></div>'
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

/** Bounding box of the magenta pixels of a canvas, or null. */
function magenta(canvas) {
  const { width, height } = canvas
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function drawn(img) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d').drawImage(img, 0, 0)
  return c
}

/** Where the marker must land: live offset inside the element, through the capture box origin, times the scale. */
function expected(el, meta, k) {
  const r = el.getBoundingClientRect()
  const m = el.querySelector('.mk').getBoundingClientRect()
  const clip = meta.clip || { x: 0, y: 0 }
  return { x: (meta.contentX + m.left - r.left - clip.x) * k, y: (meta.contentY + m.top - r.top - clip.y) * k, w: m.width * k, h: m.height * k }
}

const near = (got, want, tol = 2) => got && ['x', 'y', 'w', 'h'].every(key => Math.abs(got[key] - want[key]) <= tol)

describe('positioned boxes keep the output scale (WebKit bug 23113)', () => {
  for (const shadow of [false, true]) {
    const tag = shadow ? 'with box-shadow' : 'no shadow'
    it(`toCanvas scale 2, ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const canvas = await res.toCanvas({ scale: 2 })
      const k = canvas.width / res.meta.vbW
      const got = magenta(canvas), want = expected(el, res.meta, k)
      expect(near(got, want)).toBe(true)
    })
    it(`toCanvas width, ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const canvas = await res.toCanvas({ width: 784 })
      const k = canvas.width / res.meta.vbW
      const got = magenta(canvas), want = expected(el, res.meta, k)
      expect(near(got, want)).toBe(true)
    })
    it(`toCanvas dpr 2, ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const canvas = await res.toCanvas({ dpr: 2 })
      const k = canvas.width / res.meta.vbW
      const got = magenta(canvas), want = expected(el, res.meta, k)
      expect(near(got, want)).toBe(true)
    })
    it(`toSvg width (vector img), ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const img = await res.toSvg({ width: 784 })
      const canvas = drawn(img)
      const k = canvas.width / res.meta.vbW
      const got = magenta(canvas), want = expected(el, res.meta, k)
      expect(near(got, want)).toBe(true)
    })
    it(`toSvg scale 2 (vector img), ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const img = await res.toSvg({ scale: 2 })
      const canvas = drawn(img)
      const k = canvas.width / res.meta.vbW
      const got = magenta(canvas), want = expected(el, res.meta, k)
      expect(near(got, want)).toBe(true)
    })
    it(`toCanvas scale 2 with crop, ${tag}`, async () => {
      const el = card(shadow)
      const res = await snapdom(el, { embedFonts: false, burst: false })
      const crop = { x: 100, y: 10, width: res.meta.vbW - 100, height: res.meta.vbH - 10 }
      const canvas = await res.toCanvas({ scale: 2, crop })
      const k = canvas.width / crop.width
      const got = magenta(canvas)
      const full = expected(el, res.meta, k)
      const want = { x: full.x - crop.x * k, y: full.y - crop.y * k, w: full.w, h: full.h }
      expect(near(got, want)).toBe(true)
    })
  }
  it('clip window at scale 2', async () => {
    const el = card(false)
    const r = el.getBoundingClientRect()
    const clip = { x: r.left + 50, y: r.top + 10, width: 300, height: 100 }
    const res = await snapdom(el, { embedFonts: false, burst: false, clip })
    const canvas = await res.toCanvas({ scale: 2 })
    const k = canvas.width / res.meta.vbW
    const got = magenta(canvas), want = expected(el, res.meta, k)
    expect(near(got, want)).toBe(true)
  })
})
