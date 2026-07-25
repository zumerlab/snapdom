// Safari/WebKit export paths after removing the 3x pre-capture warmup:
// - toSvg/toImg with scale stays VECTOR (fixSafariShadows + svg width/height patch)
//   instead of silently rasterizing to PNG.
// - toCanvas verifies the draw with an ink probe (WebKit #219770: decode() resolves
//   before embedded fonts / nested images paint, so the first draw could be blank).
// Runs with isSafari mocked true, so every engine exercises the Safari branches;
// the real-WebKit run additionally exercises the genuine quirks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

beforeEach(() => {
  vi.mocked(browser.isSafari).mockReturnValue(true)
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(browser.isSafari).mockRestore?.()
})

function makeShadowEl() {
  const el = document.createElement('div')
  el.style.cssText = 'width:120px;height:60px;background:#e33;box-shadow:0 12px 0 0 #00f;margin:28px'
  document.body.appendChild(el)
  return el
}

describe('Safari toSvg stays vector', () => {
  it('scale: returns an svg data URL at the scaled natural size, not a PNG', async () => {
    const el = makeShadowEl()
    const res = await snapdom(el, { outerShadows: true })
    const img = await res.toSvg({ scale: 2 })
    expect(String(img.src).startsWith('data:image/svg+xml')).toBe(true)
    // natural = display: the svg's own width/height carry the scale
    const raw = await res.toRaw()
    const natW = parseFloat(decodeURIComponent(raw.split(',')[1]).match(/width="([\d.]+)"/)[1])
    expect(img.naturalWidth).toBe(Math.round(natW * 2))
  })

  it('width option: svg output with aspect-derived height', async () => {
    const el = makeShadowEl()
    const res = await snapdom(el, { outerShadows: true })
    const img = await res.toSvg({ width: 100 })
    expect(String(img.src).startsWith('data:image/svg+xml')).toBe(true)
    expect(img.naturalWidth).toBe(100)
    expect(img.naturalHeight).toBeGreaterThan(0)
  })

  it('shadow keeps its live orientation (below the box) in the scaled vector output', async () => {
    const el = makeShadowEl()
    const res = await snapdom(el, { outerShadows: true })
    const img = await res.toSvg({ scale: 2 })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const midX = Math.floor(c.width / 2)
    const below = ctx.getImageData(midX, Math.floor(c.height * 0.78), 1, 1).data
    const above = ctx.getImageData(midX, Math.floor(c.height * 0.12), 1, 1).data
    expect(below[2]).toBeGreaterThan(200) // blue shadow below the box
    expect(above[3]).toBe(0)              // nothing above it
  })
})

describe('Safari verified draw (no pre-capture warmup)', () => {
  it('first toCanvas of a nested-image capture has ink', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:60px;height:60px;background-image:url(data:image/svg+xml,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="teal"/></svg>') + ')'
    document.body.appendChild(el)
    const canvas = await (await snapdom(el)).toCanvas()
    const d = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect(d[3]).toBeGreaterThan(0)
    expect(d[1]).toBeGreaterThan(80) // teal
  })
})
