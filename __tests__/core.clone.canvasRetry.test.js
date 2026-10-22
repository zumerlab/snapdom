import { describe, it, expect, afterEach, vi } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { createContext } from '../src/core/context.js'

// A drawn canvas whose toDataURL answers `data:,` (an unready backing store) gets one retry
// after a frame, and then a copy through a scratch canvas. Either way the clone must carry
// the real pixels, not the empty URL.

function drawnCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 20
  canvas.height = 10
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgb(255, 0, 0)'
  ctx.fillRect(0, 0, 20, 10)
  document.body.appendChild(canvas)
  return canvas
}

describe('canvas whose toDataURL comes back empty', () => {
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll('canvas').forEach(c => c.remove()) })

  it('retries once after a frame', async () => {
    const canvas = drawnCanvas()
    const real = canvas.toDataURL.bind(canvas)
    let calls = 0
    vi.spyOn(canvas, 'toDataURL').mockImplementation((...a) => (++calls === 1 ? 'data:,' : real(...a)))
    const { clone } = await prepareClone(canvas, createContext({}))
    expect(calls).toBe(2)
    expect(clone.src.startsWith('data:image/png')).toBe(true)
  })

  it('copies through a scratch canvas when the retry is empty too', async () => {
    const canvas = drawnCanvas()
    const spy = vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:,')
    const { clone } = await prepareClone(canvas, createContext({}))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(clone.src.startsWith('data:image/png')).toBe(true)
    // The scratch copy carries the drawn pixels.
    const img = new Image()
    img.src = clone.src
    await img.decode()
    const probe = document.createElement('canvas')
    probe.width = 20
    probe.height = 10
    const pctx = probe.getContext('2d')
    pctx.drawImage(img, 0, 0)
    expect(Array.from(pctx.getImageData(10, 5, 1, 1).data)).toEqual([255, 0, 0, 255])
  })
})
