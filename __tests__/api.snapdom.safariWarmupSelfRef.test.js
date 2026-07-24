// Bug-hunt finding: the Safari warmup's canvas "poke" (element.querySelectorAll('canvas')) and
// its own gate (hasBackgroundOrMask's TreeWalker, which never visits the root passed to
// createTreeWalker) both only reached descendants — a capture root that IS the <canvas>
// (e.g. snapdom(canvasEl) for a single chart, no wrapper) was never poked, and the warmup
// never even triggered for it. Isolated in its own file so the module-level _safariWarmup
// once-per-session flag starts fresh.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(browser.isSafari).mockReturnValue(true)
})

describe('Safari warmup — canvas capture root (self-reference)', () => {
  it('pokes the canvas when it IS the capture root, not just a descendant', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    document.body.appendChild(canvas)

    const getContextSpy = vi.spyOn(canvas, 'getContext')

    await snapdom(canvas, { safariWarmupAttempts: 1 })

    // getContext('2d', {willReadFrequently:true}) is also called once by the normal (always
    // runs) cloneCanvas step, so 1 call alone means the warmup path never touched this canvas
    // at all — confirmed empirically: exactly 1 on unfixed code (cloneCanvas only), 3 with the
    // fix (warmup's own preflight capture's cloneCanvas + the poke itself + the real capture's
    // cloneCanvas). hasBackgroundOrMask(canvas) missed the root before the fix
    // (TreeWalker.nextNode() never visits the node passed to createTreeWalker), so the whole
    // warmup block never triggered and the root canvas was never poked.
    expect(getContextSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
