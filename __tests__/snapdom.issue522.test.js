import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => {
  host?.remove()
  window.scrollTo(0, 0)
})

describe('fixed outer <svg> under a scrolled clip (#522)', () => {
  it('draws a fixed svg where it is painted, like a fixed div', async () => {
    host = document.createElement('div')
    host.style.cssText = 'height:3000px'
    host.innerHTML = `<svg width="200" height="100" viewBox="0 0 20 10" style="position:fixed;left:20px;top:50px">
        <rect width="20" height="10" fill="red" />
      </svg>
      <div style="position:fixed;left:300px;top:50px;width:200px;height:100px;background:blue"></div>`
    document.body.appendChild(host)
    window.scrollTo(0, 1000)
    const y = window.scrollY
    const canvas = await snapdom.toCanvas(document.body, {
      dpr: 1, embedFonts: false, burst: false, clip: { x: 0, y, width: 600, height: 200 }
    })
    const ctx = canvas.getContext('2d')
    const px = (x, yy) => Array.from(ctx.getImageData(x, yy, 1, 1).data)
    expect(px(400, 100), 'div').toEqual([0, 0, 255, 255])
    expect(px(120, 100), 'svg').toEqual([255, 0, 0, 255])
    // The box is not widened: 2px of slack would centre the viewBox drawing 1px to the right.
    expect(px(20, 100), 'svg left edge').toEqual([255, 0, 0, 255])
    expect(px(220, 100)[3], 'past the svg').toBe(0)
  })
})
