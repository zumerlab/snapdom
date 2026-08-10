// `visibility` is inherited but a descendant can explicitly restore it, so the captured
// raster must carry the property itself. Flattening a hidden ancestor to opacity:0 made
// that legal, painted descendant impossible to recover.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted = null

afterEach(() => {
  mounted?.remove()
  mounted = null
})

/** Colour of the pixel at a fraction of the canvas box, as "r,g,b,a". */
function pixelAt(canvas, fx = 0.5, fy = 0.5) {
  const x = Math.min(canvas.width - 1, Math.floor(canvas.width * fx))
  const y = Math.min(canvas.height - 1, Math.floor(canvas.height * fy))
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data
  return `${d[0]},${d[1]},${d[2]},${d[3]}`
}

const RED = 'rgb(255,0,0)'
const CYAN = 'rgb(0,128,128)'

describe('visibility inheritance in captured raster', () => {
  it('lets a descendant restore visibility below a hidden ancestor', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:80px;height:40px;visibility:hidden;background:#fff'
    const child = document.createElement('div')
    child.style.cssText = `width:80px;height:40px;visibility:visible;background:${RED}`
    host.appendChild(child)
    document.body.appendChild(host)
    mounted = host

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(pixelAt(canvas)).toBe('255,0,0,255')
  })

  it('restores through an intermediate that only inherits hidden', async () => {
    // The middle element has no visibility of its own, so it inherits `hidden` and must
    // stay unpainted while the grandchild that opts back in still renders.
    const host = document.createElement('div')
    host.style.cssText = 'width:80px;height:80px;visibility:hidden;background:#fff'
    const middle = document.createElement('div')
    // flex-end rather than a top margin: a child margin would collapse through the
    // parent and move the whole box instead of placing the grandchild in the lower half.
    middle.style.cssText =
      `width:80px;height:80px;background:${CYAN};display:flex;flex-direction:column;justify-content:flex-end`
    const grandchild = document.createElement('div')
    grandchild.style.cssText =
      `width:80px;height:40px;visibility:visible;background:${RED}`
    middle.appendChild(grandchild)
    host.appendChild(middle)
    document.body.appendChild(host)
    mounted = host

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    // Top half: the inherited-hidden middle, transparent. Bottom half: the grandchild.
    expect(pixelAt(canvas, 0.5, 0.25)).toBe('0,0,0,0')
    expect(pixelAt(canvas, 0.5, 0.75)).toBe('255,0,0,255')
  })

  it('keeps a descendant hidden again below a restored one', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:80px;height:80px;visibility:hidden;background:#fff'
    const child = document.createElement('div')
    child.style.cssText = `width:80px;height:80px;visibility:visible;background:${RED}`
    const grandchild = document.createElement('div')
    grandchild.style.cssText =
      `width:80px;height:40px;visibility:hidden;background:${CYAN}`
    child.appendChild(grandchild)
    host.appendChild(child)
    document.body.appendChild(host)
    mounted = host

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    // Re-hidden grandchild band must not paint cyan over the restored red child.
    expect(pixelAt(canvas, 0.5, 0.25)).toBe('255,0,0,255')
    expect(pixelAt(canvas, 0.5, 0.75)).toBe('255,0,0,255')
  })

  it('still hides a subtree that never restores visibility', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:80px;height:40px;visibility:hidden;background:#fff'
    const child = document.createElement('div')
    child.style.cssText = `width:80px;height:40px;background:${RED}`
    host.appendChild(child)
    document.body.appendChild(host)
    mounted = host

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(pixelAt(canvas)).toBe('0,0,0,0')
  })
})
