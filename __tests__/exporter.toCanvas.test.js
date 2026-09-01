// __tests__/exporter.toCanvas.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// IMPORTANT: in Browser Mode we cannot spy on ESM exports directly.
// Use { spy: true } so we can override implementations safely.
vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

import { toCanvas } from '../src/exporters/toCanvas.js'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

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

  it('Safari path appends the probe <img> offscreen and leaves no stray <img>', async () => {
    // The old title claimed a fixed 100ms wait that no longer exists — waitForImgPaint
    // probe-draws against a 150/600ms deadline with rAF frames instead — and the setTimeout
    // spy it set up was never asserted. What this test can honestly pin is the mount/unmount
    // contract of the probe.
    vi.mocked(browser.isSafari).mockReturnValue(true)

    const rmSpy = vi.spyOn(Element.prototype, 'remove')

    const imgCountBefore = document.querySelectorAll('img').length
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { scale: 1, dpr: 2 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)

    const imgCountAfter = document.querySelectorAll('img').length
    expect(imgCountAfter).toBe(imgCountBefore) // no stray <img> left in the DOM
    expect(rmSpy).toHaveBeenCalled() // the probe was mounted and explicitly removed

    rmSpy.mockRestore()
  })
})
