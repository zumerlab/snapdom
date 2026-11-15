import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

// The outline shim puts a transparent border on the capture root for the length of the clone.
// Everything read under it holds used values of a narrower box, so the records of its undo
// must invalidate what was read. Counterexample of the 2026-11-13 perf review.
let host
const mount = (html) => {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;background:#fff'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}
afterEach(() => host?.remove())

const leftEdge = async (el, opts) => {
  const canvas = await (await snapdom(el, { scale: 1, dpr: 1, burst: false, ...opts })).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let min = width
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < min; x++) {
      const i = (y * width + x) * 4
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) { min = x; break }
    }
  }
  return { min, width: canvas.width }
}

describe('values read under the outline shim are not served afterwards', () => {
  for (const burst of [false, undefined]) {
    it(`child of an outlined root keeps its width, burst ${burst}`, async () => {
      mount('<div id="a" style="box-sizing:border-box;width:200px;outline:10px solid #00f"><div id="b" style="height:20px;background:#f00"></div></div>')
      const opts = burst === false ? { burst: false } : { burst: undefined }
      await snapdom(host.querySelector('#a'), { scale: 1, dpr: 1, ...opts })
      const b = host.querySelector('#b')
      expect(b.getBoundingClientRect().width).toBe(200)
      expect((await leftEdge(b, opts)).width).toBe(200)
    })

    it(`percent margin under an outlined root, burst ${burst}`, async () => {
      mount('<div id="p" style="padding:0"><div id="a" style="box-sizing:border-box;width:300px;outline:10px solid #00f"><div id="b" style="margin-left:10%;height:20px;background:#f00"></div></div></div>')
      const opts = burst === false ? { burst: false } : { burst: undefined }
      await snapdom(host.querySelector('#a'), { scale: 1, dpr: 1, ...opts })
      expect((await leftEdge(host.querySelector('#p'), opts)).min).toBe(30)
    })
  }
})
