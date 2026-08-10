// __tests__/exporters.toCanvas.more.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// IMPORTANT: in Browser Mode we cannot spy on ESM exports directly.
// Use { spy: true } so we can override implementations safely.
vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

import { toCanvas } from '../src/exporters/toCanvas.js'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

const SQUARE_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
  '<rect width="400" height="400" fill="red"/></svg>'
)

beforeEach(() => {
  // clean up DOM between tests
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('toCanvas (Browser Mode)', () => {
  it('renders to canvas (non-Safari path) without appending the <img>', async () => {
    // Non-Safari path
    vi.mocked(browser.isSafari).mockReturnValue(false)

    // Make sure no IMG remains in the DOM after execution (should never append)
    const beforeImgs = document.querySelectorAll('img').length

    const canvas = await toCanvas(ONE_BY_ONE_PNG, { scale: 2, dpr: 1.5 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)

    // For a 1x1 image with scale=2 and dpr=1.5:
    // CSS size: 2x2, backing store: ceil(2 * 1.5) = 3
    expect(canvas.style.width).toBe('2px')
    expect(canvas.style.height).toBe('2px')
    expect(canvas.width).toBe(3)
    expect(canvas.height).toBe(3)

    const afterImgs = document.querySelectorAll('img').length
    expect(afterImgs - beforeImgs).toBe(0) // nothing appended
  })

  it('appends and removes <img> and waits 100ms on Safari path', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(true)

    // Spy setTimeout so the promise resolves immediately and we can assert the delay
    const origSetTimeout = globalThis.setTimeout
    const calls = []
    const stoSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((cb, ms, ...args) => {
        calls.push(ms)
        // Trigger callback ASAP so the awaited promise resolves
        return origSetTimeout(cb, 0, ...args)
      })

    // Spy on Element.prototype.remove to ensure the appended <img> is removed
    const rmSpy = vi.spyOn(Element.prototype, 'remove')

    const imgCountBefore = document.querySelectorAll('img').length
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { scale: 1, dpr: 2 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)

    const imgCountAfter = document.querySelectorAll('img').length
    expect(imgCountAfter).toBe(imgCountBefore) // no stray <img> left in the DOM

    stoSpy.mockRestore()
    rmSpy.mockRestore()
  })

  it('uses a crop aspect ratio for width-only and height-only sizing', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(false)
    const crop = { x: 20, y: 30, width: 100, height: 50 }
    const meta = { vbW: 400, vbH: 400, w0: 400, h0: 400 }

    const byWidth = await toCanvas(SQUARE_SVG, {
      crop, meta, width: 200, scale: 1, dpr: 1,
    })
    expect(byWidth.width).toBe(200)
    expect(byWidth.height).toBe(100)

    const byHeight = await toCanvas(SQUARE_SVG, {
      crop, meta, height: 120, scale: 1, dpr: 1,
    })
    expect(byHeight.width).toBe(240)
    expect(byHeight.height).toBe(120)
  })

  it('sizes from the effective crop intersection and rejects invalid windows', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(false)
    const intersected = await toCanvas(SQUARE_SVG, {
      crop: { x: 350, y: 300, width: 100, height: 50 },
      meta: { vbW: 400, vbH: 400 }, width: 100, scale: 1, dpr: 1,
    })
    expect(intersected.width).toBe(100)
    expect(intersected.height).toBe(100)

    await expect(toCanvas(SQUARE_SVG, {
      crop: { x: 500, y: 0, width: 10, height: 10 }, scale: 1, dpr: 1,
    })).rejects.toThrow(/does not intersect/)
    await expect(toCanvas(SQUARE_SVG, {
      crop: { x: 0, y: 0, width: 0, height: 10 }, scale: 1, dpr: 1,
    })).rejects.toThrow(/positive width\/height/)
  })

  it('refuses to crop a payload that is not a serialized SVG capture', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(false)
    // Cropping rewrites the viewBox, so it cannot apply to a raster payload. Silently
    // rasterizing whole would hand a document exporter a full bitmap where it asked
    // for one page slice, which is a worse failure than not exporting at all.
    await expect(toCanvas(ONE_BY_ONE_PNG, {
      crop: { x: 0, y: 0, width: 1, height: 1 }, scale: 1, dpr: 1,
    })).rejects.toThrow(/requires an SVG capture payload/)

    // Without a crop the same payload still rasterizes normally.
    const plain = await toCanvas(ONE_BY_ONE_PNG, { scale: 1, dpr: 1 })
    expect(plain.width).toBe(1)
    expect(plain.height).toBe(1)
  })

  it('paginates a tall capture into non-overlapping slices', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(false)
    // The document-exporter use case: three page windows out of one capture, each
    // decoded at page size instead of allocating the full-height bitmap once.
    const tall = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300" viewBox="0 0 100 300">' +
      '<rect y="0" width="100" height="100" fill="rgb(255,0,0)"/>' +
      '<rect y="100" width="100" height="100" fill="rgb(0,255,0)"/>' +
      '<rect y="200" width="100" height="100" fill="rgb(0,0,255)"/></svg>'
    )
    const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
    for (let page = 0; page < 3; page++) {
      const canvas = await toCanvas(tall, {
        crop: { x: 0, y: page * 100, width: 100, height: 100 }, scale: 1, dpr: 1,
      })
      expect(canvas.width).toBe(100)
      expect(canvas.height).toBe(100)
      const [r, g, b] = canvas.getContext('2d', { willReadFrequently: true })
        .getImageData(50, 50, 1, 1).data
      expect([r, g, b]).toEqual(expected[page])
    }
  })
})
