// __tests__/api.snapdom.more.test.js – snapdom.js extra coverage
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.mocked(browser.isSafari).mockReturnValue(false)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('snapdom – error handling', () => {
  it('throws when element is null', async () => {
    await expect(snapdom(null)).rejects.toThrow(/cannot be null/)
  })
  it('throws when element is undefined', async () => {
    await expect(snapdom(undefined)).rejects.toThrow(/cannot be null/)
  })
})

describe('snapdom – result.to()', () => {
  it('throws for unknown export type', async () => {
    const el = document.createElement('div')
    el.textContent = 'x'
    document.body.appendChild(el)
    const result = await snapdom(el)
    await expect(result.to('unknownType')).rejects.toThrow(/Unknown export type/)
  })

  // Flexibility punch-list: runExport() serializes calls on a shared _exportQueue
  // promise chain. A failed export must reject only its own caller, not leave the
  // queue permanently rejected (which would silently poison every later export
  // call on the same result — .then() with no rejection handler skips the job).
  it('does not poison later exports on the same result after one export fails', async () => {
    const el = document.createElement('div')
    el.style.width = '10px'
    el.style.height = '10px'
    el.textContent = 'x'
    document.body.appendChild(el)
    const result = await snapdom(el)

    await expect(result.to('unknownType')).rejects.toThrow(/Unknown export type/)
    await expect(result.toCanvas()).resolves.toBeInstanceOf(HTMLCanvasElement)
  })
})

describe('snapdom – result helpers', () => {
  it('result has all expected export methods', async () => {
    const el = document.createElement('div')
    el.style.width = '50px'
    el.style.height = '50px'
    el.textContent = 'x'
    document.body.appendChild(el)
    const result = await snapdom(el)
    expect(typeof result.toPng).toBe('function')
    expect(typeof result.toSvg).toBe('function')
    expect(typeof result.toCanvas).toBe('function')
    expect(typeof result.download).toBe('function')
  })
})

describe('snapdom – Safari pre-step', () => {
  // The old title named the removed 3x pre-capture warmup, and its only assertion (url is an
  // svg data URL) is true for ANY successful capture. What the pre-step actually does per
  // capture is poke drawn canvases with getImageData(0,0,1,1) so cloneCanvas's toDataURL is
  // not blank — spy on that, so deleting the pre-step fails this test.
  it('pokes a drawn canvas store when isSafari', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(true)

    const el = document.createElement('div')
    el.style.width = '40px'
    el.style.height = '40px'
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    // Drawn on purpose: the pre-step only pokes a canvas that already HAS a context —
    // probing a virgin one would create the context and lock the page's canvas mode
    // (see core.clone.canvasContext.test.js).
    canvas.getContext('2d').fillRect(0, 0, 4, 4)
    el.appendChild(canvas)
    document.body.appendChild(el)

    const gidSpy = vi.spyOn(CanvasRenderingContext2D.prototype, 'getImageData')
    try {
      const result = await snapdom(el)
      expect(result.url.startsWith('data:image/svg+xml')).toBe(true)
      const poked = gidSpy.mock.calls.some((c) => c[0] === 0 && c[1] === 0 && c[2] === 1 && c[3] === 1)
      expect(poked).toBe(true)
    } finally {
      gidSpy.mockRestore()
    }
  })
})
