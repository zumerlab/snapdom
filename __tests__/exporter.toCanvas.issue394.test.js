import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'
import { toCanvas } from '../src/exporters/toCanvas.js'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBCd4/7mEAAAAASUVORK5CYII='

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

afterEach(() => {
  document.body.innerHTML = ''
})

// #394: on Safari, img.decode() resolves before nested <img> tags inside the
// foreignObject are composited, producing blank raster exports. The fix appends
// the image offscreen and waits two animation frames before drawImage.
describe('toCanvas — #394 Safari compositing wait', () => {
  it('does NOT append the <img> on non-Safari (no speed cost)', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(false)
    const appendSpy = vi.spyOn(HTMLBodyElement.prototype, 'appendChild')
    await toCanvas(ONE_BY_ONE_PNG, { scale: 1, dpr: 1 })
    const appendedImgs = appendSpy.mock.calls.filter(c => c[0] instanceof HTMLImageElement)
    expect(appendedImgs.length).toBe(0)
  })

  it('appends the <img> offscreen and removes it on Safari', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(true)
    const appendSpy = vi.spyOn(HTMLBodyElement.prototype, 'appendChild')
    const imgCountBefore = document.querySelectorAll('img').length
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { scale: 1, dpr: 1 })
    const imgCountAfter = document.querySelectorAll('img').length

    const appendedImgs = appendSpy.mock.calls.filter(c => c[0] instanceof HTMLImageElement)
    expect(appendedImgs.length).toBe(1)
    // The appended img has offscreen positioning so it doesn't flash
    const appended = appendedImgs[0][0]
    expect(appended.style.position).toBe('fixed')
    expect(appended.style.left).toBe('-99999px')

    // And it was removed before return (no DOM leak)
    expect(imgCountAfter).toBe(imgCountBefore)
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })
})
