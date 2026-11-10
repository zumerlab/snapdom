import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { jxl } from '../packages/plugins/jxl.js'

// Each rapier-jxl module the plugin imports is recorded when it loads; page-rects can add a property
// to its result or fail to measure, and every codec the plugin creates counts its close().
const seen = vi.hoisted(() => ({ loads: [], extra: null, measureFails: null, created: 0, closed: 0, rects: 0 }))
const counted = (real) => ({
  ...real,
  createCodec: (options) => {
    const codec = real.createCodec(options)
    seen.created++
    return { prepare: (k) => codec.prepare(k), capture: (c, o) => codec.capture(c, o), decode: (b, o) => codec.decode(b, o), close: () => { seen.closed++; return codec.close() } }
  },
})
vi.mock('rapier-jxl/page-rects', async (importOriginal) => {
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
vi.mock('rapier-jxl/codec/capture-complete', async (importOriginal) => { seen.loads.push('capture-complete'); return counted(await importOriginal()) })
vi.mock('rapier-jxl/codec/decode', async (importOriginal) => { seen.loads.push('decode'); return counted(await importOriginal()) })

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
      calls.push({ canvas, options })
      if (fail) throw fail
      return { fits: true, bytes: new Uint8Array([0xff, 0x0a]) }
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
  // Runs first: this file's module registry starts empty.
  it('nothing loads until a capture or export needs it', async () => {
    const plugin = jxl()
    made.push(() => plugin.close())
    expect(seen.loads, 'calling jxl()').toEqual([])
    const other = { name: 'unrelated', afterClone() {} }
    await (await snapdom(card(), { plugins: [other] })).toPng()
    expect(seen.loads, 'a capture with another plugin').toEqual([])
    const result = await snapdom(card(), { plugins: [plugin] })
    expect(seen.loads, 'a capture measures').toEqual(['page-rects'])
    await result.toPng()
    expect(seen.loads, 'a PNG export').toEqual(['page-rects'])
    expect((await result.toBlob({ format: 'jxl', dpr: 1 })).type).toBe('image/jxl')
    expect(seen.loads, 'the first JPEG XL export loads its own door only').toEqual(['page-rects', 'capture-complete'])
  })

  it('only the default encoder has a door: the others are your codec', async () => {
    for (const module of ['rapier-jxl/upload', 'rapier-jxl/capture']) expect(() => jxl({ module })).toThrow(/needs your codec/)
    expect(seen.loads).toEqual(['page-rects', 'capture-complete'])
  })
})

describe('jxl plugin: what reaches the encoder', () => {
  it('pageRects\' whole result reaches the encoder', async () => {
    seen.extra = { sentinel: { text: 'complete' }, textComplete: true }
    const codec = spy()
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    expect(codec.calls[0].options.sentinel).toEqual({ text: 'complete' })
    expect(codec.calls[0].options.textComplete).toBe(true)
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

  it('an encoder that fails to start rejects the export', async () => {
    const reason = new Error('no worker')
    const codec = spy({ prepare: reason })
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    await expect(result.toBlob({ format: 'jxl', dpr: 1 })).rejects.toBe(reason)
    expect(codec.calls).toHaveLength(0)
  })
})

describe('jxl plugin: resources', () => {
  it('close() ends the codecs the plugin created, once; a later export creates them again', async () => {
    const plugin = jxl({ effort: 2 })
    const { created, closed } = seen
    const result = await snapdom(card(), { plugins: [plugin] })
    await result.toBlob({ format: 'jxl', dpr: 1 })
    await plugin.close()
    await plugin.close()
    expect(seen.closed - closed).toBe(seen.created - created)
    expect(seen.created - created).toBe(1)
    // A delayed export from the same result.
    expect((await result.toBlob({ format: 'jxl', dpr: 1 })).type).toBe('image/jxl')
    expect(seen.created - created).toBe(2)
    await plugin.close()
    expect(seen.closed - closed).toBe(2)
  })

  it('each plugin owns its encoder: closing one leaves another\'s export running', async () => {
    const a = jxl({ effort: 2 }), b = jxl({ effort: 4 })
    expect(a).not.toBe(b)
    const ra = await snapdom(card(), { plugins: [a] }), rb = await snapdom(card(), { plugins: [b] })
    await ra.toBlob({ format: 'jxl', dpr: 1 })
    const closed = seen.closed
    const running = rb.toBlob({ format: 'jxl', dpr: 1 })
    const closing = a.close()
    expect(closing).toBeInstanceOf(Promise)
    await closing
    expect((await running).type).toBe('image/jxl')
    expect(seen.closed - closed, 'only a\'s encoder').toBe(1)
    expect(jxl({ effort: 3 }).close()).toBeInstanceOf(Promise)
    await b.close()
  })

  it('quality and effort outside their range are refused before anything is drawn', async () => {
    expect(() => jxl({ effort: 10 })).toThrow(RangeError)
    const result = await snapdom(card(), { plugins: [jxl()] })
    const canvases = watchCanvases()
    await expect(result.toBlob({ format: 'jxl', quality: 2 })).rejects.toThrow(RangeError)
    await expect(result.toBlob({ format: 'jxl', effort: 0 })).rejects.toThrow(RangeError)
    expect(canvases.list).toHaveLength(0)
  })

  it('close() leaves your own codec open', async () => {
    let closed = 0
    const codec = { ...spy(), close: () => { closed++ } }
    const plugin = jxl({ codec })
    await (await snapdom(card(), { plugins: [plugin] })).toBlob({ format: 'jxl', dpr: 1 })
    await plugin.close()
    expect(closed).toBe(0)
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

  it('the plugin\'s own encoder refuses a canvas over 40 megapixels before it is drawn', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const canvases = watchCanvases()
    await expect(result.toBlob({ format: 'jxl', width: 9000, height: 9000, dpr: 1 })).rejects.toMatchObject({ code: 'JXL_LIMIT' })
    expect(canvases.list).toHaveLength(0)
  })

  it('the 40 megapixel check counts an export crop\'s window, not the whole capture', async () => {
    const big = card()
    big.style.width = big.style.height = '8200px'
    const result = await snapdom(big, { plugins: [jxl()] })
    await expect(result.toBlob({ format: 'jxl', dpr: 1 })).rejects.toMatchObject({ code: 'JXL_LIMIT' })
    expect((await result.toBlob({ format: 'jxl', dpr: 1, crop: { x: 0, y: 0, width: 300, height: 200 } })).type).toBe('image/jxl')
  })

  it('toJxl() revokes every object URL it makes', async () => {
    const live = new Set(), { createObjectURL, revokeObjectURL } = URL
    URL.createObjectURL = (b) => { const u = createObjectURL(b); live.add(u); return u }
    URL.revokeObjectURL = (u) => { live.delete(u); revokeObjectURL(u) }
    made.push(() => { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL })
    const { createCodec } = await import('rapier-jxl/codec/decode')
    const decoder = createCodec({ module: 'rapier-jxl/decode' })
    made.push(() => decoder.close())
    const result = await snapdom(card(), { plugins: [jxl({ decoder })] })
    for (const quality of [0.8, 1]) {
      const img = await result.toJxl({ dpr: 1, quality })
      expect(img.naturalWidth).toBeGreaterThan(0)
      expect([...live]).toEqual([])
    }
  })
})
