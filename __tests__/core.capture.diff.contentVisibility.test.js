// The full pipeline reads the page with its content-visibility:auto boxes forced visible. A
// box the engine is not rendering at that instant (off screen, or just restored by the capture
// before and not laid out again until the next frame) is empty once restored, so whatever is
// measured afterwards takes its collapsed height: the root's box in the engine, and every
// retained ancestor the differential path reconciles against the live page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

let host
afterEach(() => host?.remove())

const CV = '<div style="content-visibility:auto;width:50px"><div style="height:100px;background:rgb(255,0,0)"></div></div>'
const mount = (top, html) => {
  host = document.createElement('div')
  host.style.cssText = `position:absolute;left:0;top:${top}px;width:200px;background:#fff`
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

/** Rows of red at x=10 and of green at x=75, and the canvas height. */
const read = async (el, opts) => {
  const canvas = await (await snapdom(el, { scale: 1, dpr: 1, ...opts })).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let red = 0, green = 0
  for (let y = 0; y < height; y++) {
    const r = (y * width + 10) * 4, g = (y * width + 75) * 4
    if (data[r] > 200 && data[r + 1] < 60) red++
    if (data[g + 1] > 200 && data[g] < 60) green++
  }
  return { red, green, height }
}

describe('content-visibility: auto boxes the engine is not rendering', () => {
  for (const [name, top] of [['on screen, captured in the frame it was mounted', 0], ['off screen', 20000]]) {
    it(`the root keeps its forced height, ${name}`, async () => {
      const el = mount(top, CV + '<div style="height:20px"></div>')
      expect(await read(el, { burst: false })).toEqual({ red: 100, green: 0, height: 120 })
    })

    it(`a retained ancestor keeps its forced height on a differential frame, ${name}`, async () => {
      // The column's green shows beside the 50px box. The tall sibling holds the root's height
      // and the text that is edited, so the frame is served by the differential path.
      const el = mount(top, '<div style="display:flex;align-items:flex-start">' +
        `<div style="width:100px;background:rgb(0,255,0)">${CV}</div>` +
        '<div style="height:160px"><p style="margin:0"><span>label 0</span></p></div></div>')
      const right = { red: 100, green: 100, height: 160 }
      expect(await read(el)).toEqual(right)
      // Forcing and restoring the box are edits of the page: burst takes the capture that
      // follows them through the full pipeline. The one after that is a memo hit, and then an
      // edit is a differential frame.
      expect(await read(el)).toEqual(right)
      expect(await read(el)).toEqual(right)
      el.querySelector('span').textContent = 'label 1'
      const served = __diffStats.served
      expect(await read(el)).toEqual(right)
      expect(__diffStats.served).toBe(served + 1)
    })
  }
})
