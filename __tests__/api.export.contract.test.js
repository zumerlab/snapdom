// v3 export contract: `format` is the one option name (type = legacy alias), and ONE
// sizing rule across exporters — width/height absolute win, scale only when neither set.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { createContext } from '../src/core/context.js'

function makeEl(w = 100, h = 50) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;background:#345`
  document.body.appendChild(el)
  return el
}

describe('format option unification', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('toBlob defaults to svg; format selects an image codec; legacy type still works', async () => {
    const res = await snapdom(makeEl(), { cache: 'disabled' })
    const svgBlob = await res.toBlob()
    expect(svgBlob.type).toBe('image/svg+xml')
    const pngBlob = await res.toBlob({ format: 'png' })
    expect(pngBlob.type).toBe('image/png')
    // jpeg: universally encodable (WebKit's canvas.toBlob silently falls back on webp)
    const legacy = await res.toBlob({ type: 'jpeg' })
    expect(legacy.type).toBe('image/jpeg')
  })

  it('normalizes legacy type as the capture format when format is absent', () => {
    expect(createContext()).toMatchObject({ format: 'png', type: 'png' })
    expect(createContext({ type: 'svg' })).toMatchObject({ format: 'svg', type: 'svg' })
    expect(createContext({ type: 'jpg' })).toMatchObject({ format: 'jpeg', type: 'jpeg', backgroundColor: '#ffffff' })
    expect(createContext({ format: 'webp', type: 'svg' })).toMatchObject({ format: 'webp', type: 'webp' })
    expect(createContext({ type: 'canvas' })).toMatchObject({ format: 'png', type: 'png' })
  })

  it('normalizes a format alias changed by beforeSnap', async () => {
    const plugin = { name: 'legacy-format-hook', beforeSnap(ctx) { ctx.type = 'jpg' } }
    const result = await snapdom(makeEl(), { cache: 'disabled', plugins: [plugin] })
    const blob = await result.toBlob()
    expect(blob.type).toBe('image/jpeg')
  })

  it('carries a capture-time type alias into download()', async () => {
    let filename = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      filename = this.download
    })
    try {
      const result = await snapdom(makeEl(), {
        cache: 'disabled', type: 'svg', filename: 'legacy-type',
      })
      await result.download()
      expect(filename).toBe('legacy-type.svg')
    } finally {
      click.mockRestore()
    }
  })
})

describe('one sizing rule across exporters', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('width wins over scale in toCanvas (same geometry as toImg)', async () => {
    const res = await snapdom(makeEl(100, 50), { cache: 'disabled' })
    const canvas = await res.toCanvas({ width: 300, scale: 2, dpr: 1 })
    // Old behavior multiplied: 300×2=600. New rule: width is absolute.
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(150) // aspect preserved from 100x50
  })

  it('scale applies when neither width nor height is set', async () => {
    const res = await snapdom(makeEl(100, 50), { cache: 'disabled' })
    const canvas = await res.toCanvas({ scale: 2, dpr: 1 })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
  })

  it('keeps downscaled thin captures drawable in every exporter', async () => {
    const result = await snapdom(makeEl(100, 1), { embedFonts: false, dpr: 1 })
    const options = { scale: 0.1, dpr: 1 }
    const canvas = await result.toCanvas(options)
    expect([canvas.width, canvas.height]).toEqual([10, 1])
    const svg = await result.toSvg(options)
    expect([svg.naturalWidth, svg.naturalHeight]).toEqual([10, 1])
    const png = await result.toPng(options)
    expect([png.naturalWidth, png.naturalHeight]).toEqual([10, 1])
    const blob = await result.toBlob({ ...options, format: 'png' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
  })

  // toBlob defaults to the raw vector unless a codec is asked for — but the static helper
  // forwards its options to the CAPTURE, not to the exporter, so a capture-time format has
  // to survive into the export. It did not: `snapdom.toBlob(el, {type:'png'})` (the shape
  // main documents) and `{format:'png'}` both silently returned SVG.
  describe('toBlob honours the format wherever the caller named it', () => {
    it('capture-time and export-time both reach the codec', async () => {
      const el = makeEl(40, 20)
      const res = await snapdom(el, { cache: 'disabled' })
      expect((await res.toBlob()).type).toBe('image/svg+xml')            // documented default
      expect((await res.toBlob({ format: 'png' })).type).toBe('image/png')
      expect((await res.toBlob({ type: 'png' })).type).toBe('image/png') // legacy alias
      expect((await snapdom.toBlob(el, { format: 'png' })).type).toBe('image/png')
      expect((await snapdom.toBlob(el, { type: 'png' })).type).toBe('image/png')
      expect((await snapdom.toBlob(el)).type).toBe('image/svg+xml')
    })
  })
})
