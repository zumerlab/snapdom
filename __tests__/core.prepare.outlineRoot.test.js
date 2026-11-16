// A capture root with an outline and no border used to get a transparent border of the
// outline's width while it was cloned (#179, 2025-08: a child's margin collapsed through the
// root). That border moved the content of a border-box root by its width (live parity,
// d-outer-shadows, 1.7% on three engines) and stopped the very collapse the page shows. The
// collapse is reproduced by the root margin pass now, so the root is cloned as it is.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

/** First row and first column that hold the colour, and the canvas size. */
const find = async (el, match) => {
  const canvas = await (await snapdom(el, { scale: 1, dpr: 1, embedFonts: false, burst: false })).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let top = -1, left = width
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (match(data[i], data[i + 1], data[i + 2])) { if (top < 0) top = y; if (x < left) left = x }
    }
  }
  return { top, left, size: [canvas.width, canvas.height] }
}
const red = (r, g, b) => r > 200 && g < 60 && b < 60

describe('a root with an outline and no border', () => {
  it('keeps the content of a border-box root where the page has it', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;background:#fff;padding:20px'
    host.innerHTML = '<div id="t" style="box-sizing:border-box;width:200px;height:100px;padding:16px;outline:4px solid #00f;background:#eee">' +
      '<div style="width:50px;height:20px;background:rgb(255,0,0)"></div></div>'
    document.body.appendChild(host)
    expect(await find(host.querySelector('#t'), red)).toEqual({ top: 16, left: 16, size: [200, 100] })
  })

  it('keeps a child margin that collapses through it (#179)', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;background:#fff;padding:40px'
    host.innerHTML = '<div id="t" style="width:200px;outline:1px solid #00f">' +
      '<div style="margin:30px 0;height:20px;background:rgb(255,0,0)"></div></div>'
    document.body.appendChild(host)
    const t = host.querySelector('#t')
    const live = t.getBoundingClientRect()
    const child = t.firstChild.getBoundingClientRect()
    // On the page the margins collapse through the root: it is as tall as the child.
    expect([Math.round(live.height), Math.round(child.top - live.top)]).toEqual([20, 0])
    expect(await find(t, red)).toEqual({ top: 0, left: 0, size: [200, 20] })
  })
})
