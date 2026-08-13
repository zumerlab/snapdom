import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { neutralizeRootZoom } from '../src/utils/capture.helpers.js'

/**
 * #483 (follow-up of #369): capturing an element whose own CSS `zoom` is < 1 left blank
 * bands on the right/bottom. The raster is sized from offsetWidth/offsetHeight, which are
 * expressed BEFORE the element's own zoom, while the clone kept its inline `zoom` (copied
 * by cloneNode) and therefore painted the content shrunk into the top-left corner.
 */

const mounted = []

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  const el = host.firstElementChild
  document.body.appendChild(host)
  mounted.push(host)
  return el
}

afterEach(() => {
  while (mounted.length) mounted.pop().remove()
})

async function rasterize(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { ctx, w: c.width, h: c.height }
}

function pixel(ctx, x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

describe('root CSS zoom (#483)', () => {
  it('fills the whole raster when the root has inline zoom < 1', async () => {
    const el = mount('<div style="position:absolute;top:0;left:0;zoom:0.8;width:200px;height:100px;background:rgb(0,128,0);"></div>')

    // The canvas is built in the pre-zoom coordinate space.
    expect(el.offsetWidth).toBe(200)

    const { ctx, w, h } = await rasterize((await snapdom(el)).url)
    expect(w).toBeGreaterThanOrEqual(200)
    expect(h).toBeGreaterThanOrEqual(100)

    // Bottom-right corner used to be transparent (the "black band" once flattened on JPEG).
    for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) {
      const [r, g, b, a] = pixel(ctx, x, y)
      expect(a, `alpha at ${x},${y}`).toBeGreaterThan(0)
      expect([r, g, b], `color at ${x},${y}`).toEqual([0, 128, 0])
    }
  })

  it('does not overflow the raster when the root has inline zoom > 1', async () => {
    const el = mount(`
      <div style="position:absolute;top:0;left:0;zoom:1.5;width:200px;height:100px;background:rgb(255,255,255);">
        <div style="width:100px;height:100px;background:rgb(0,0,255);"></div>
      </div>`)

    const { ctx, w } = await rasterize((await snapdom(el)).url)
    // With the root zoom re-applied, the 100px blue box would have covered 150px.
    expect(pixel(ctx, 90, 50).slice(0, 3)).toEqual([0, 0, 255])
    expect(pixel(ctx, Math.min(120, w - 2), 50).slice(0, 3)).toEqual([255, 255, 255])
  })

  it('keeps the clone root free of zoom while descendants keep theirs', async () => {
    const el = mount(`
      <div style="position:absolute;top:0;left:0;zoom:0.8;width:200px;height:100px;background:rgb(255,255,255);">
        <div id="inner" style="zoom:0.5;width:200px;height:100px;background:rgb(255,0,0);"></div>
      </div>`)

    let rootZoom = null
    let innerZoom = null
    await snapdom(el, {
      plugins: [{
        name: 'zoom-probe',
        afterClone({ clone }) {
          rootZoom = clone.style.getPropertyValue('zoom')
          innerZoom = clone.querySelector('#inner')?.style.getPropertyValue('zoom')
        },
      }],
    })

    expect(parseFloat(rootZoom || '1')).toBe(1)
    expect(parseFloat(innerZoom)).toBe(0.5)
  })

  it('renders a zoomed descendant at its scaled size', async () => {
    const el = mount(`
      <div style="position:absolute;top:0;left:0;width:200px;height:100px;background:rgb(255,255,255);">
        <div style="zoom:0.5;width:200px;height:100px;background:rgb(255,0,0);"></div>
      </div>`)

    const { ctx } = await rasterize((await snapdom(el)).url)
    // The zoomed child covers the top-left quarter only.
    expect(pixel(ctx, 20, 10).slice(0, 3)).toEqual([255, 0, 0])
    expect(pixel(ctx, 150, 75).slice(0, 3)).toEqual([255, 255, 255])
  })

  it('neutralizeRootZoom is a no-op without zoom and tolerates styleless nodes', () => {
    const el = mount('<div style="width:10px;height:10px;"></div>')
    const clone = el.cloneNode(true)
    neutralizeRootZoom(el, clone)
    expect(clone.style.getPropertyValue('zoom')).toBe('')
    expect(() => neutralizeRootZoom(el, null)).not.toThrow()
    expect(() => neutralizeRootZoom(null, clone)).not.toThrow()
  })
})
