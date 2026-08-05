// #480 — a WebGL canvas created with preserveDrawingBuffer:false was captured fully
// transparent from v2.22.0, when the pre-toDataURL rAF was narrowed to Safari only.
// The drawing buffer is cleared once the frame composites, so toDataURL called from a
// plain task reads back empty; awaiting rAF resumes inside the frame while it is intact.
import { describe, it, expect } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { createContext } from '../src/core/context.js'
import { cache } from '../src/core/cache.js'

const options = createContext()
const sessionCache = {
  styleMap: cache.session.styleMap,
  styleCache: cache.session.styleCache,
  nodeMap: cache.session.nodeMap
}

/** Decode a data URL and return its mean alpha plus the centre pixel. */
async function readBack(src) {
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = src
  })
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const data = x.getImageData(0, 0, c.width, c.height).data
  let alphaSum = 0
  for (let i = 3; i < data.length; i += 4) alphaSum += data[i]
  const mid = ((Math.floor(c.height / 2) * c.width) + Math.floor(c.width / 2)) * 4
  return {
    meanAlpha: alphaSum / (data.length / 4),
    centre: [data[mid], data[mid + 1], data[mid + 2], data[mid + 3]]
  }
}

describe('#480 WebGL canvas with preserveDrawingBuffer:false', () => {
  it('is captured with its pixels, not transparent', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    document.body.appendChild(canvas)

    const gl = canvas.getContext('webgl2', { alpha: true, preserveDrawingBuffer: false })
    if (!gl) return // no WebGL2 in this runner — nothing to assert

    let raf = 0
    const render = () => {
      gl.clearColor(0, 1, 0, 1) // opaque green
      gl.clear(gl.COLOR_BUFFER_BIT)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    try {
      // Land in a plain task (like a click handler), NOT inside a rAF callback, so the
      // frame has already composited and the drawing buffer has been cleared.
      await new Promise((resolve) => setTimeout(resolve, 60))
      const clone = await deepClone(canvas, sessionCache, { ...options })

      expect(clone.tagName).toBe('IMG')
      const { meanAlpha, centre } = await readBack(clone.src)
      expect(meanAlpha).toBeGreaterThan(250)
      expect(centre[1]).toBeGreaterThan(200) // green channel survived
      expect(centre[3]).toBeGreaterThan(250)
    } finally {
      cancelAnimationFrame(raf)
      canvas.remove()
    }
  })

  it('still takes the fast path for a 2D canvas', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 32, 32)
    document.body.appendChild(canvas)

    try {
      const clone = await deepClone(canvas, sessionCache, { ...options })
      const { centre } = await readBack(clone.src)
      expect(centre[0]).toBeGreaterThan(200)
      expect(centre[3]).toBeGreaterThan(250)
    } finally {
      canvas.remove()
    }
  })
})
