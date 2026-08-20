// #486 — "the canvas animation cannot be captured".
//
// Two distinct things bite here:
//
//  1. Timing (what the reported pen hits): the capture ran before the animation had drawn its
//     first frame, so snapdom faithfully serialized an empty canvas. Once the canvas holds a
//     frame, the capture matches it — the tests below pin that down, and `{ debug: true }` now
//     says out loud that the canvas was empty at capture time.
//  2. A real hang: the canvas path awaits requestAnimationFrame before toDataURL so a WebGL
//     canvas with preserveDrawingBuffer:false is read inside the frame (#480). rAF never fires
//     while the document is not being rendered (background tab, minimized window), and that
//     await had no way out, so the capture promise never settled. It is now bounded.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index'

function paint(canvas, color = '#00cc44') {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

async function painted(el) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, scale: 1 })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
  return n / (d.length / 4)
}

describe('#486 canvas capture', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => { host.remove(); vi.restoreAllMocks() })

  it('captures the frame a 2D animation has drawn', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 60; canvas.height = 60
    host.appendChild(canvas)
    // rAF-driven animation: one frame is on screen when the capture runs
    await new Promise((r) => requestAnimationFrame(() => { paint(canvas); r() }))
    expect(await painted(canvas)).toBeGreaterThan(0.9)
  })

  it('serializes an empty canvas as empty (the reported pen captures before the first frame)', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 60; canvas.height = 60
    host.appendChild(canvas)
    expect(await painted(canvas)).toBe(0)
  })

  it('warns under debug when the canvas has nothing drawn yet', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 60; canvas.height = 60
    host.appendChild(canvas)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await snapdom.toRaw(canvas, { debug: true })
    const said = warn.mock.calls.some((args) => String(args[1] || '').includes('canvas is empty at capture time'))
    expect(said).toBe(true)
  })

  it('does not warn when the canvas holds a frame', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 60; canvas.height = 60
    paint(canvas)
    host.appendChild(canvas)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await snapdom.toRaw(canvas, { debug: true })
    const said = warn.mock.calls.some((args) => String(args[1] || '').includes('canvas is empty at capture time'))
    expect(said).toBe(false)
  })

  it('still resolves when requestAnimationFrame never fires (hidden tab)', async () => {
    // A WebGL context makes snapdom take the "wait for the frame" path (getContext('2d') → null).
    const canvas = document.createElement('canvas')
    canvas.width = 40; canvas.height = 40
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl) { gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish() }
    host.appendChild(canvas)

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0) // never calls back
    const raw = await snapdom.toRaw(canvas)
    expect(raw.startsWith('data:image/svg+xml')).toBe(true)
  }, 20000)
})
