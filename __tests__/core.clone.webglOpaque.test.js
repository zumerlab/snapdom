// A WebGL canvas without preserveDrawingBuffer is readable only inside the frame that drew it.
// #480 waits for that frame when the canvas reads as blank, but a context made with alpha:false
// clears to opaque black, which reads as drawn: the capture took the black
// (d-plugin-webgl-live-dom's WebGL panel in a visible page, Chromium and Firefox).
//
// The test iframe is never composited, so the browser never clears the buffer here and the bug
// cannot show by itself. The compositor's clear is played by a task queued after each frame,
// which is when a visible page loses the buffer: a read from a plain task sees that black,
// a read inside the frame sees the frame's red.
import { afterEach, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let canvas, stop
afterEach(() => { stop?.(); canvas?.remove(); canvas = stop = null })

it('captures an opaque WebGL canvas the browser clears after every frame', async () => {
  canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 30
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: false })
  if (!gl) return // no WebGL in this engine build
  const fill = (r) => { gl.clearColor(r, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
  let on = true
  const frame = () => {
    if (!on) return
    fill(1)
    setTimeout(() => fill(0), 0)
    requestAnimationFrame(frame)
  }
  stop = () => { on = false }
  requestAnimationFrame(frame)
  await new Promise((r) => setTimeout(r, 50))

  const out = await snapdom.toCanvas(canvas, { dpr: 1, cache: 'disabled' })
  expect([...out.getContext('2d').getImageData(20, 15, 1, 1).data]).toEqual([255, 0, 0, 255])
})
