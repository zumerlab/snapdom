// A differential frame must equal a full capture of the same DOM. A box that moved by less
// than 1/16px was once taken for the rounding of its frozen size and kept its old width
// (diff.js, FROZEN_LENGTH_EPS).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

describe('differential frame and a drift below 1/16px', () => {
  for (const width of ['50.03px', '50.5px']) {
    it(`re-reads the boxes sized by a child that became ${width} wide`, async () => {
      host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:0;top:0;width:400px;padding:10px;background:#fff'
      host.innerHTML = '<div><div style="display:inline-block;background:#eee">' +
        '<div id="a" style="width:50px;height:20px;background:red"></div>' +
        '<div style="height:20px;background:blue"></div></div></div>'
      document.body.appendChild(host)
      const O = { scale: 1, dpr: 1, embedFonts: false }
      await snapdom(host, O)
      host.querySelector('#a').style.width = width
      await new Promise((resolve) => setTimeout(resolve, 30))
      const frame = (await snapdom(host, O)).url
      const full = (await snapdom(host, { ...O, burst: false })).url
      expect(frame).toBe(full)
    })
  }
})
