// The Safari pre-step's canvas "poke" (element.querySelectorAll('canvas')) only reached
// descendants — a capture root that IS the <canvas> (e.g. snapdom(canvasEl) for a single
// chart, no wrapper) was never poked. The poke resolves WebKit's GPU-backed canvas store
// so cloneCanvas's toDataURL isn't blank; it now runs on every Safari capture (the old
// once-per-session 3x pre-capture warmup is gone — WebKit #219770's blank first draw is
// handled at draw time by toCanvas's verified-draw ladder instead).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(browser.isSafari).mockReturnValue(true)
})

describe('Safari pre-step — canvas capture root (self-reference)', () => {
  it('pokes the canvas when it IS the capture root, not just a descendant', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    document.body.appendChild(canvas)

    const getContextSpy = vi.spyOn(canvas, 'getContext')

    await snapdom(canvas)

    // getContext is called once by the normal cloneCanvas step (always runs), so 1 call
    // alone would mean the poke never touched this canvas: expect poke + cloneCanvas ≥ 2.
    expect(getContextSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
