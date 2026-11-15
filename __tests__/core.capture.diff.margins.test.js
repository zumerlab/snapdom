// A centred block (`margin: 0 auto`) changes its used margins when its container widens.
// Firefox has no Typed OM to keep the keyword, so the px are frozen, and a margin of 0px is
// not in the style key the differential reconcile compares: the block stayed at the left.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

describe('differential frame and auto margins', () => {
  it('a centred block follows its shrink-to-fit container when a sibling text grows', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:400px;background:#fff;font:14px/18px Arial,sans-serif'
    host.innerHTML = '<div style="border:1px dashed #999"><div style="float:left;max-width:300px">' +
      '<div><p style="margin:0">x</p></div>' +
      '<section style="margin:0 auto;width:120px;height:20px;background:rgb(255,0,0)"></section>' +
      '</div><div style="clear:both"></div></div>'
    document.body.appendChild(host)
    const O = { scale: 1, dpr: 1, embedFonts: false }
    const redStart = async (opts) => {
      const canvas = await (await snapdom(host, { ...O, ...opts })).toCanvas()
      const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) return x
        }
      }
      return -1
    }
    for (let i = 0; i < 3; i++) await snapdom(host, O)
    host.querySelector('p').textContent = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'
    const section = host.querySelector('section')
    const live = Math.round(section.getBoundingClientRect().left - host.getBoundingClientRect().left)
    expect(live).toBeGreaterThan(50)
    // Chromium and Firefox serve this frame through the differential path; WebKit runs the
    // full pipeline. Without the margin check Firefox painted the block at x=1.
    expect(await redStart()).toBe(live)
    expect(await redStart({ burst: false })).toBe(live)
  })
})
