import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const hosts = []
afterEach(() => hosts.splice(0).forEach(h => h.remove()))

// A 400x100 root whose red channel encodes x: 0 at its left edge, 200 at its right.
function scene(rootCSS, shellCSS = 'display:grid;width:800px') {
  const shell = document.createElement('div')
  shell.style.cssText = shellCSS
  shell.innerHTML = `<div style="width:400px;height:100px;background:linear-gradient(to right,rgb(0 0 255),rgb(200 0 255));${rootCSS}"></div>`
  document.body.append(shell)
  hosts.push(shell)
  return shell.firstElementChild
}

/** The x of the root painted at (x, y) of the image, NaN when the root is not painted there. */
function rootXAt(canvas, x, y = 50) {
  const [r, g, b, a] = canvas.getContext('2d').getImageData(x, y, 1, 1).data
  return a > 200 && g < 50 && b > 200 ? r * 2 : NaN
}

// #548: the root clone sits in a container that is wider than the root under a clip or a
// bleed, and Chromium aligns a block-level box there by justify-self, an absolutely
// positioned one by align-self too. Firefox and WebKit apply neither in block layout, so
// these go red on Chromium alone.
describe('capture root self-alignment', () => {
  it.each(['justify-self:center', 'justify-self:end'])('a clip from x=100 shows x=100 of a root with %s', async (css) => {
    const root = scene(css)
    const r = root.getBoundingClientRect()
    const clip = { x: r.left + scrollX + 100, y: r.top + scrollY, width: 200, height: 100 }
    const canvas = await snapdom.toCanvas(root, { dpr: 1, clip })
    expect(canvas.width).toBe(200)
    expect(rootXAt(canvas, 0)).toBeCloseTo(100, -1)
    expect(rootXAt(canvas, 199)).toBeCloseTo(300, -1)
  })

  it.each(['justify-self:center', 'justify-self:end'])('a shadow bleed keeps a root with %s at its left edge', async (css) => {
    const root = scene(css + ';box-shadow:0 0 0 20px rgb(255 255 0)')
    const canvas = await snapdom.toCanvas(root, { dpr: 1, outerShadows: true })
    expect(rootXAt(canvas, 30)).toBeCloseTo(10, -1)
    expect(rootXAt(canvas, 410)).toBeCloseTo(390, -1)
  })

  it.each(['align-self:center', 'justify-self:center', 'place-self:end'])('an absolutely positioned root with %s fills its own box', async (css) => {
    const root = scene('position:absolute;box-shadow:0 0 0 20px rgb(255 255 0);' + css, 'position:relative;display:grid;width:800px;height:300px')
    const canvas = await snapdom.toCanvas(root, { dpr: 1, outerShadows: true })
    expect(rootXAt(canvas, 30, 30)).toBeCloseTo(10, -1)
    expect(rootXAt(canvas, 410, 110)).toBeCloseTo(390, -1)
  })
})
