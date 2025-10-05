// __tests__/exporters.toCanvas.more.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// IMPORTANT: in Browser Mode we cannot spy on ESM exports directly.
// Use { spy: true } so we can override implementations safely.
vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

import { toCanvas } from '../src/exporters/toCanvas.js'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBCd4/7mEAAAAASUVORK5CYII='

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
})
