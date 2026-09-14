// Capture geometry contract (`context.meta` / `result.meta`), the exact-options contract
// (`export.requestedOptions`) and canvas cropping — the three read-only surfaces document
// exporters translate page windows against.
//
// The geometry cases assert on PIXELS, not on the meta numbers alone: contentX/contentY
// claim to be the exact viewBox origin of the logical capture box, so the only honest proof
// is that the content really paints there under asymmetric bleed, a transformed root and a
// clip window (a centred `(vbW - w0) / 2` guess passes none of them).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { captureDOM } from '../src/core/capture.js'
import { toCanvas } from '../src/exporters/toCanvas.js'

const added = []
function mount(css = 'width:120px;height:60px;background:#fff') {
  const el = document.createElement('div')
  el.style.cssText = css
  el.textContent = 'META'
  document.body.appendChild(el)
  added.push(el)
  return el
}

afterEach(() => {
  while (added.length) added.pop().remove()
})

/** Bounding box of every pixel matching `match`, in canvas pixels. `maxX/maxY` are the last
 *  matching pixel, so the far edge is `maxX + 1`. */
function inkBounds(canvas, match) {
  const { width, height } = canvas
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!match(data[i], data[i + 1], data[i + 2], data[i + 3])) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return { minX, minY, maxX, maxY }
}

// Antialiasing can shave one edge pixel off a strict color match.
const near = (a, b) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
const isRed = (r, g, b, a) => a > 200 && r > 200 && g < 60 && b < 60
const isBlue = (r, g, b, a) => a > 200 && b > 200 && r < 60 && g < 60

/** 1:1 raster: no width/height means the canvas is exactly the serialized viewBox. */
const natural = { scale: 1, dpr: 1 }

describe('capture geometry meta', () => {
  it('describes a plain (unclipped) capture', async () => {
    const el = mount()
    const result = await snapdom(el)

    expect(Object.isFrozen(result.meta)).toBe(true)
    expect(result.meta.clip).toBe(null)
    expect(result.meta.w0).toBeCloseTo(120, 3)
    expect(result.meta.h0).toBeCloseTo(60, 3)
    // The viewBox is the content box plus padding, and contentX/contentY must land the
    // content box back inside it.
    expect(result.meta.vbW).toBeGreaterThanOrEqual(result.meta.w0)
    expect(result.meta.vbH).toBeGreaterThanOrEqual(result.meta.h0)
    expect(result.meta.contentX).toBeGreaterThanOrEqual(0)
    expect(result.meta.contentY).toBeGreaterThanOrEqual(0)
    expect(result.meta.contentX + result.meta.w0).toBeLessThanOrEqual(result.meta.vbW)
    expect(result.meta.contentY + result.meta.h0).toBeLessThanOrEqual(result.meta.vbH)
  })

  it('rejects plain assignment on the capture context', async () => {
    const el = mount()
    const options = {}
    await captureDOM(el, options)

    expect(Object.isFrozen(options.meta)).toBe(true)
    // ESM is strict mode: a non-writable property rejects assignment loudly instead of
    // letting a hook silently desynchronise geometry from the serialized SVG.
    expect(() => { options.meta = { w0: 1 } }).toThrow(TypeError)
    expect(() => { options.meta.w0 = 999 }).toThrow(TypeError)
  })

  it('lets a reused options bag take a second capture geometry', async () => {
    // captureDOM's second argument is caller-owned, so the same object legitimately reaches
    // two captures. A non-configurable `meta` would turn the second one into
    // "Cannot redefine property: meta".
    const small = mount('width:120px;height:60px;background:#fff')
    const large = mount('width:240px;height:180px;background:#fff')
    const options = { scale: 1, dpr: 1 }

    await captureDOM(small, options)
    const first = options.meta
    expect(first.w0).toBeCloseTo(120, 3)

    await expect(captureDOM(large, options)).resolves.toMatch(/^data:image\/svg\+xml/)
    expect(options.meta).not.toBe(first)
    expect(options.meta.w0).toBeCloseTo(240, 3)
    expect(options.meta.h0).toBeCloseTo(180, 3)
    // Still protected after the redefinition.
    expect(Object.isFrozen(options.meta)).toBe(true)
    expect(() => { options.meta = null }).toThrow(TypeError)
    // ...and the first record is untouched, so anything holding it keeps valid geometry.
    expect(first.w0).toBeCloseTo(120, 3)
  })

  it('is one shared record: result, context and plugin export hooks read the same object', async () => {
    const el = mount()
    let seenDefine = null
    let seenExport = null
    const plugin = {
      name: 'meta-reader',
      defineExports: (ctx) => {
        seenDefine = ctx.meta
        return { geometry: async (c) => { seenExport = c.meta; return 'ok' } }
      },
    }
    const result = await snapdom(el, { plugins: [plugin] })
    await result.toGeometry()

    // Identity, not equality: two equal-but-separate records could drift from the url.
    expect(seenDefine).toBe(result.meta)
    expect(seenExport).toBe(result.meta)
    // The result property is pinned as hard as the value is frozen.
    expect(Object.getOwnPropertyDescriptor(result, 'meta')).toMatchObject({
      writable: false, configurable: false, enumerable: true,
    })
    expect(() => { result.meta = null }).toThrow(TypeError)
  })

  it('throws (without detonating a spread) when the capture stopped before render', async () => {
    const el = mount()
    const result = await snapdom(el, { plugins: [{ name: 'clone-only', needs: 'clone' }] })

    expect(result.needs).toBe('clone')
    expect(() => result.meta).toThrow(/stopped at 'clone'/)
    // Same convention as `url`: non-enumerable, so logging or copying the result still works.
    expect(Object.keys(result)).not.toContain('meta')
    expect(() => ({ ...result })).not.toThrow()
  })

  it('keeps contentX/contentY exact under an asymmetric outerShadows bleed', async () => {
    // box-shadow -30px -20px bleeds only up and to the left, so the content box does NOT sit
    // in the middle of the viewBox: a centred (vbW - w0) / 2 origin lands outside the red box.
    const el = mount('width:100px;height:50px;background:rgb(255,0,0);' +
      'box-shadow:-30px -20px 0 0 rgb(0,0,255)')
    const result = await snapdom(el, { outerShadows: true })
    const meta = result.meta

    expect(meta.contentX).toBeGreaterThan((meta.vbW - meta.w0) / 2)
    expect(meta.contentY).toBeGreaterThan((meta.vbH - meta.h0) / 2)

    const canvas = await result.toCanvas(natural)
    expect(canvas.width).toBe(meta.vbW)
    expect(canvas.height).toBe(meta.vbH)
    const box = inkBounds(canvas, isRed)
    near(box.minX, meta.contentX)
    near(box.minY, meta.contentY)
    near(box.maxX + 1, meta.contentX + meta.w0)
    near(box.maxY + 1, meta.contentY + meta.h0)
  })

  it('keeps contentX/contentY exact for a transformed root', async () => {
    // rotate(90deg) about the root's own origin: the element's local (0,0) corner is what
    // contentX/contentY name, and the marker pinned to that corner must paint there.
    const el = mount('width:100px;height:40px;background:rgb(255,0,0);' +
      'transform:rotate(90deg);transform-origin:0 0')
    el.textContent = ''
    const marker = document.createElement('div')
    marker.style.cssText = 'width:10px;height:10px;background:rgb(0,0,255)'
    el.appendChild(marker)

    const result = await snapdom(el)
    const meta = result.meta
    const canvas = await result.toCanvas(natural)
    expect(canvas.width).toBe(meta.vbW)
    expect(canvas.height).toBe(meta.vbH)

    // (x,y) → (-y,x): the marker occupies [contentX - 10, contentX] × [contentY, contentY + 10].
    const box = inkBounds(canvas, isBlue)
    near(box.maxX + 1, meta.contentX)
    near(box.minX, meta.contentX - 10)
    near(box.minY, meta.contentY)
    near(box.maxY + 1, meta.contentY + 10)
  })

  it('publishes the resolved clip window, with the window as the content box', async () => {
    const wrap = mount('width:200px;margin:0;padding:0')
    wrap.textContent = ''
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('div')
      b.style.cssText = `height:60px;margin:0;background:${i === 1 ? 'rgb(255,0,0)' : 'rgb(0,0,255)'}`
      wrap.appendChild(b)
    }
    const target = wrap.children[1]
    const r = target.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const clip = { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }

    const result = await snapdom(wrap, { clip })
    const meta = result.meta

    expect(Object.isFrozen(meta.clip)).toBe(true)
    expect(meta.clip.width).toBeCloseTo(clip.width, 3)
    expect(meta.clip.height).toBeCloseTo(clip.height, 3)
    near(meta.clip.x, r.left - wrapRect.left)
    near(meta.clip.y, r.top - wrapRect.top)
    // The window IS the logical capture box, so it starts at the viewBox origin.
    expect(meta.w0).toBeCloseTo(clip.width, 3)
    expect(meta.h0).toBeCloseTo(clip.height, 3)
    expect(meta.contentX).toBeCloseTo(0, 3)
    expect(meta.contentY).toBeCloseTo(0, 3)

    const canvas = await result.toCanvas(natural)
    const box = inkBounds(canvas, isRed)
    near(box.minX, meta.contentX)
    near(box.minY, meta.contentY)
    near(box.maxX + 1, meta.contentX + meta.w0)
    near(box.maxY + 1, meta.contentY + meta.h0)
  })
})

describe('export.requestedOptions', () => {
  it('hands plugin exports the exact frozen raw bag, preserving key presence', async () => {
    const el = mount()
    const plugin = {
      name: 'raw-export-options',
      defineExports: () => ({
        contract: async (ctx) => ({
          requested: ctx.export.requestedOptions,
          normalized: ctx.export.options,
        }),
      }),
    }
    const result = await snapdom(el, { plugins: [plugin] })

    // null is also the capture default: presence must survive even where comparing merged
    // values could not distinguish this call from an omitted option.
    const explicit = await result.toContract({ backgroundColor: null })
    expect(Object.hasOwn(explicit.requested, 'backgroundColor')).toBe(true)
    expect(explicit.requested.backgroundColor).toBe(null)
    expect(Object.isFrozen(explicit.requested)).toBe(true)
    expect(explicit.normalized.backgroundColor).toBe(null)

    const omitted = await result.toContract()
    expect(Object.hasOwn(omitted.requested, 'backgroundColor')).toBe(false)
    expect(Object.isFrozen(omitted.requested)).toBe(true)
  })

  it('snapshots the options bag when toXxx() is CALLED, not when its job dequeues', async () => {
    // Regression: normalizing inside the queued job let a mutation made after the call (but
    // before the job ran) rewrite an already-requested export. Both exports below are queued
    // synchronously and the bag is mutated before either job's first microtask.
    const el = mount('width:80px;height:40px;background:#fff')
    const result = await snapdom(el)
    const options = { width: 100, scale: 1, dpr: 1 }

    const first = result.toCanvas(options)
    const second = result.toCanvas(options)
    options.width = 500

    expect((await first).width).toBe(100)
    expect((await second).width).toBe(100)
  })
})

describe('toCanvas crop', () => {
  const tall = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300" viewBox="0 0 100 300">' +
    '<rect y="0" width="100" height="100" fill="rgb(255,0,0)"/>' +
    '<rect y="100" width="100" height="100" fill="rgb(0,255,0)"/>' +
    '<rect y="200" width="100" height="100" fill="rgb(0,0,255)"/></svg>'
  )
  const ONE_BY_ONE_PNG = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

  it('paginates a tall capture into non-overlapping slices', async () => {
    const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
    for (let page = 0; page < 3; page++) {
      const canvas = await toCanvas(tall, {
        crop: { x: 0, y: page * 100, width: 100, height: 100 }, ...natural,
      })
      expect(canvas.width).toBe(100)
      expect(canvas.height).toBe(100)
      const [r, g, b] = canvas.getContext('2d', { willReadFrequently: true })
        .getImageData(50, 50, 1, 1).data
      expect([r, g, b]).toEqual(expected[page])
    }
  })

  it('sizes a width-only request from the crop, not from the whole document', async () => {
    // Without the crop as aspect reference the 100x50 window would inherit the 100x300 ratio.
    const canvas = await toCanvas(tall, { crop: { x: 0, y: 20, width: 100, height: 50 }, width: 200, ...natural })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
  })

  it('clips to the viewBox intersection and never degrades silently', async () => {
    const intersected = await toCanvas(tall, { crop: { x: 50, y: 250, width: 400, height: 400 }, ...natural })
    expect(intersected.width).toBe(50)
    expect(intersected.height).toBe(50)

    await expect(toCanvas(tall, { crop: { x: 500, y: 0, width: 10, height: 10 }, ...natural }))
      .rejects.toThrow(/does not intersect/)
    await expect(toCanvas(tall, { crop: { x: 0, y: 0, width: 0, height: 10 }, ...natural }))
      .rejects.toThrow(/positive width\/height/)
    await expect(toCanvas(tall, { crop: { x: 0, y: NaN, width: 10, height: 10 }, ...natural }))
      .rejects.toThrow(/finite x\/y/)
    // A raster payload cannot be windowed by a viewBox rewrite: handing back the whole
    // bitmap where one page was asked for is a worse failure than not exporting.
    await expect(toCanvas(ONE_BY_ONE_PNG, { crop: { x: 0, y: 0, width: 1, height: 1 }, ...natural }))
      .rejects.toThrow(/requires an SVG capture payload/)
    const plain = await toCanvas(ONE_BY_ONE_PNG, natural)
    expect(plain.width).toBe(1)
  })

  it('reaches the exporter through a real capture, in meta viewBox coordinates', async () => {
    const el = mount('width:100px;height:150px;margin:0;padding:0')
    el.textContent = ''
    for (const color of ['rgb(0,0,255)', 'rgb(255,0,0)', 'rgb(0,0,255)']) {
      const band = document.createElement('div')
      band.style.cssText = `height:50px;margin:0;background:${color}`
      el.appendChild(band)
    }
    const result = await snapdom(el)
    const { contentX, contentY } = result.meta
    const canvas = await result.toCanvas({ crop: { x: contentX, y: contentY + 50, width: 100, height: 50 }, ...natural })

    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(50)
    const [r, g, b] = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(50, 25, 1, 1).data
    expect([r, g, b]).toEqual([255, 0, 0])
  })
})
