import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { jxl } from '../packages/plugins/jxl.js'

// Each jpegxl module the plugin imports is recorded when it loads; page-rects can add a property
// to its result or fail to measure, and every capture through the shared module is counted.
const seen = vi.hoisted(() => ({ loads: [], extra: null, measureFails: null, captures: 0, rects: 0 }))
const counted = (real) => ({
  ...real,
  capture: (...args) => { seen.captures++; return real.capture(...args) },
})
vi.mock('jpegxl/page-rects', async (importOriginal) => {
  seen.loads.push('page-rects')
  const real = await importOriginal()
  return {
    ...real,
    measure: (...args) => { if (seen.measureFails) throw seen.measureFails; return real.measure(...args) },
    // `extra` is a property set, or one per call (the n-th pageRects call of the file).
    // undefined removes that property: measure() already sets textComplete, and {} would leave it.
    pageRects: (...args) => {
      const extra = typeof seen.extra === 'function' ? seen.extra(seen.rects++) : seen.extra
      const result = { ...real.pageRects(...args), ...extra }
      if (extra && typeof extra === 'object') for (const key of Object.keys(extra)) if (extra[key] === undefined) delete result[key]
      return result
    },
  }
})
vi.mock('jpegxl/capture-complete', async (importOriginal) => { seen.loads.push('capture-complete'); return counted(await importOriginal()) })
vi.mock('jpegxl/capture', async (importOriginal) => { seen.loads.push('capture'); return counted(await importOriginal()) })
vi.mock('jpegxl/upload', async (importOriginal) => { seen.loads.push('upload'); return counted(await importOriginal()) })
vi.mock('jpegxl/decode', async (importOriginal) => { seen.loads.push('decode'); return await importOriginal() })

const made = []
afterEach(async () => { while (made.length) await made.pop()(); clearPlugins(); seen.extra = seen.measureFails = null })

function card() {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;left:20px;top:20px;width:240px;height:120px;background:#fff;font:20px sans-serif;color:#c00'
  const photo = document.createElement('canvas')
  photo.width = photo.height = 64
  photo.style.cssText = 'position:absolute;right:8px;top:8px;width:64px;height:64px'
  const g = photo.getContext('2d')
  for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) { g.fillStyle = `rgb(0,${x * 4},${y * 4})`; g.fillRect(x, y, 4, 4) }
  el.append(photo, Object.assign(document.createElement('span'), { textContent: 'Exact text' }))
  document.body.appendChild(el)
  made.push(() => el.remove())
  return el
}

// Records what the plugin asks of an encoder and the canvas it received; `fail` rejects the capture.
function spy({ fail, prepare } = {}) {
  const calls = []
  return {
    calls,
    prepare: async () => { if (prepare) throw prepare },
    capture: async (canvas, options) => {
      calls.push({ canvas, options, size: [canvas.width, canvas.height] })
      if (fail) throw fail
      return { meetsTarget: true, bytes: new Uint8Array([0xff, 0x0a]) }
    },
  }
}

// The canvases a call creates whose size SnapDOM sets for its output (they have a CSS width).
function watchCanvases() {
  const list = [], create = document.createElement
  document.createElement = function (tag, ...rest) { const n = create.call(this, tag, ...rest); if (/^canvas$/i.test(tag)) list.push(n); return n }
  made.push(() => { document.createElement = create })
  return { list, outputs: () => list.filter((c) => c.style.width) }
}

describe('jxl plugin: loading', () => {
  // Runs first: this file's module registry starts with the plugin and page-rects, which it imports.
  it('a plugin with your codec loads no door; jxl() starts loading its own door, and nothing else loads', async () => {
    expect(seen.loads, 'the plugin imports page-rects').toEqual(['page-rects'])
    jxl({ codec: spy() })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen.loads, 'your codec').toEqual(['page-rects'])
    // jxl() starts loading the door, so the first export does not wait on the network (jxl.js, create()).
    const result = await snapdom(card(), { plugins: [jxl()] })
    await vi.waitFor(() => expect(seen.loads, 'calling jxl()').toEqual(['page-rects', 'capture-complete']), { timeout: 15000 })
    await result.toPng()
    expect((await result.toBlob({ format: 'jxl', dpr: 1 })).type).toBe('image/jxl')
    expect(seen.loads, 'a PNG and a JPEG XL export').toEqual(['page-rects', 'capture-complete'])
    expect(seen.captures, 'one capture through the shared module').toBe(1)
  })

  it('an alternate module needs its explicit codec and loads no other door', async () => {
    for (const module of ['jpegxl/upload', 'jpegxl/capture']) {
      expect(() => jxl({ module })).toThrow(/needs its codec/)
      const codec = spy()
      const result = await snapdom(card(), { plugins: [jxl({ module, codec })] })
      expect((await result.toBlob({ format: 'jxl', dpr: 1 })).type).toBe('image/jxl')
      expect(codec.calls).toHaveLength(1)
    }
    expect(seen.loads).toEqual(['page-rects', 'capture-complete'])
  })
})

describe('jxl plugin: what reaches the encoder', () => {
  it('pageRects\' rectangles and its complete-text marker reach the encoder', async () => {
    // The encoder takes exactRects, photoRects and textComplete from pageRects (jxl.js, rects).
    seen.extra = { textComplete: true }
    const codec = spy()
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    expect(codec.calls[0].options.textComplete).toBe(true)
    expect(codec.calls[0].options.photoRects.length).toBeGreaterThan(0)
    expect(codec.calls[0].options.exactRects.length).toBeGreaterThan(0)
    expect(codec.calls[0].options.fidelity).toEqual({ quality: 80 })
  })

  it('complete text with no text: empty exactRects reach the encoder with the marker', async () => {
    seen.extra = { textComplete: true }
    const el = card()
    el.querySelector('span').remove()
    const codec = spy()
    await (await snapdom(el, { plugins: [jxl({ codec })] })).toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    expect(codec.calls[0].options.exactRects).toEqual([])
    expect(codec.calls[0].options.photoRects.length).toBeGreaterThan(0)
    expect(codec.calls[0].options.textComplete).toBe(true)
  })

  it('Safari\'s two measurements are complete only when both are', async () => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', configurable: true })
    made.push(() => { delete navigator.userAgent })
    const el = card(), b = el.getBoundingClientRect()
    const codec = spy()
    const result = await snapdom(el, { plugins: [jxl({ codec })], clip: { x: b.left + scrollX + 4, y: b.top + scrollY + 4, width: 200, height: 100 } })
    for (const [first, second, complete] of [[true, true, true], [true, false, undefined], [false, true, undefined]]) {
      const start = seen.rects
      // Clear the marker on an incomplete measurement. {} would leave measure()'s textComplete.
      seen.extra = (n) => ((n - start === 0 ? first : second) ? { textComplete: true } : { textComplete: undefined })
      await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
      expect(seen.rects - start, 'two measurements').toBe(2)
      expect(codec.calls.at(-1).options.textComplete).toBe(complete)
    }
  })

  it('a failed measurement rejects the JPEG XL export with its reason; other exports still work', async () => {
    seen.measureFails = new Error('measure down')
    const codec = spy()
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    expect((await result.toBlob({ format: 'png', dpr: 1 })).type).toBe('image/png')
    await expect(result.toBlob({ format: 'jxl', dpr: 1 })).rejects.toBe(seen.measureFails)
    expect(codec.calls, 'no exact-only file instead').toHaveLength(0)
  })

  it('prepare only warms the encoder: a prepare that fails leaves the export to capture', async () => {
    // jxl.js: encoder.prepare().catch(() => {}); capture's own answer decides the export.
    const codec = spy({ prepare: new Error('no warm start') })
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    expect((await result.toBlob({ format: 'jxl', dpr: 1 })).type).toBe('image/jxl')
    expect(codec.calls).toHaveLength(1)
    const failing = spy({ prepare: new Error('no warm start'), fail: new Error('no worker') })
    await expect((await snapdom(card(), { plugins: [jxl({ codec: failing })] })).toBlob({ format: 'jxl', dpr: 1 })).rejects.toThrow('no worker')
  })
})

describe('jxl plugin: resources', () => {
  it('plugins with different efforts share the module for the page', async () => {
    // The module import is kept for the page (jxl.js, door); the plugin has no close().
    const captures = seen.captures, loads = [...seen.loads]
    const a = jxl({ effort: 2 }), b = jxl({ effort: 4 })
    expect(a).not.toBe(b)
    const [ra, rb] = await Promise.all([snapdom(card(), { plugins: [a] }), snapdom(card(), { plugins: [b] })])
    const [fa, fb] = await Promise.all([ra.toBlob({ format: 'jxl', dpr: 1 }), rb.toBlob({ format: 'jxl', dpr: 1 })])
    expect([fa.type, fb.type]).toEqual(['image/jxl', 'image/jxl'])
    expect(seen.captures - captures).toBe(2)
    expect(seen.loads).toEqual(loads)
  })

  it('an effort outside 1 to 9 is refused by the encoder, and the plugin\'s canvas is emptied', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const canvases = watchCanvases()
    for (const effort of [0, 10]) await expect(result.toBlob({ format: 'jxl', dpr: 1, effort })).rejects.toMatchObject({ code: 'JXL_OPTIONS' })
    expect(canvases.outputs().filter((c) => c.width || c.height)).toEqual([])
  })

  it('a failed encode empties the plugin\'s canvas and keeps the app\'s', async () => {
    const codec = spy({ fail: new Error('encoder down') })
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    for (const run of [(o) => result.toBlob({ format: 'jxl', ...o }), (o) => result.toJxl(o), (o) => result.download({ format: 'jxl', ...o })]) {
      await expect(run({ dpr: 1 })).rejects.toThrow('encoder down')
      expect(codec.calls.at(-1).canvas.width, 'the plugin\'s canvas').toBe(0)
      const canvas = document.createElement('canvas')
      await expect(run({ dpr: 1, canvas })).rejects.toThrow('encoder down')
      expect(codec.calls.at(-1).canvas).toBe(canvas)
      expect(canvas.width, 'the app\'s canvas').toBeGreaterThan(0)
    }
  })

  it('an abort while encoding empties the plugin\'s canvas', async () => {
    const controller = new AbortController(), reason = new Error('stop')
    const codec = { prepare: async () => {}, capture: (canvas, o) => { codec.canvas = canvas; controller.abort(reason); return Promise.reject(o.signal.reason) } }
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    await expect(result.toBlob({ format: 'jxl', dpr: 1, signal: controller.signal })).rejects.toBe(reason)
    expect(codec.canvas.width).toBe(0)
  })

  it('a draw that ends after the abort still empties its canvas', async () => {
    const codec = spy()
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    const canvases = watchCanvases()
    const controller = new AbortController(), reason = new Error('stop')
    // Abort as SnapDOM starts drawing: its first canvas of this export.
    const create = document.createElement
    document.createElement = function (tag, ...rest) { if (/^canvas$/i.test(tag)) controller.abort(reason); return create.call(this, tag, ...rest) }
    await expect(result.toBlob({ format: 'jxl', dpr: 1, signal: controller.signal })).rejects.toBe(reason)
    document.createElement = create
    // The draw goes on after the export rejected; once it ends, its canvas is empty.
    await vi.waitFor(() => {
      expect(canvases.outputs().length, 'the late draw made its canvas').toBeGreaterThan(0)
      expect(canvases.outputs().filter((c) => c.width || c.height)).toEqual([])
    })
    expect(codec.calls).toHaveLength(0)
  })

  it('an export crop of a large capture encodes the crop\'s window', async () => {
    // The plugin's own limit is SnapDOM's raster limit (jxl.js, MAX_PIXELS); the encoder gets only the window.
    const big = card()
    big.style.width = big.style.height = '8200px'
    const codec = spy()
    const result = await snapdom(big, { plugins: [jxl({ codec })] })
    expect((await result.toBlob({ format: 'jxl', dpr: 1, crop: { x: 0, y: 0, width: 300, height: 200 } })).type).toBe('image/jxl')
    expect([codec.calls[0].canvas.width, codec.calls[0].canvas.height]).toEqual([0, 0])
    expect(codec.calls[0].size).toEqual([300, 200])
  })

  it('toJxl() revokes every object URL it makes', async () => {
    const live = new Set(), { createObjectURL, revokeObjectURL } = URL
    URL.createObjectURL = (b) => { const u = createObjectURL(b); live.add(u); return u }
    URL.revokeObjectURL = (u) => { live.delete(u); revokeObjectURL(u) }
    made.push(() => { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL })
    const result = await snapdom(card(), { plugins: [jxl()] })
    for (const quality of [0.8, 1]) {
      const img = await result.toJxl({ dpr: 1, quality })
      expect(img.naturalWidth).toBeGreaterThan(0)
      expect([...live]).toEqual([])
    }
  })
})
