// Sticky freeze on scrolled-root element captures (formerly freezeSticky in changeCSS.js,
// now freezeViewportPositioned): header/footer/left-sidebar must render where they are
// STUCK, with root scroll (both axes) and inner-scroller state preserved — the d33 demo.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const added = []
function mount(el) {
  document.body.appendChild(el)
  added.push(el)
  return el
}

afterEach(() => {
  while (added.length) added.pop().remove()
})

async function rasterize(root) {
  const canvas = await snapdom.toCanvas(root, { dpr: 1, cache: 'disabled' })
  return canvas.getContext('2d')
}

function buildScroller() {
  const root = document.createElement('div')
  root.style.cssText = 'position:relative;width:500px;height:300px;overflow:auto;margin:0;background:#fff;'
  const header = document.createElement('div')
  header.style.cssText = 'position:sticky;top:0;height:30px;background:rgb(255,0,0);z-index:5;margin:0;'
  header.textContent = 'H'
  const stage = document.createElement('div')
  stage.style.cssText = 'width:900px;min-height:800px;display:grid;grid-template-columns:120px 1fr;gap:10px;margin:0;'
  const sidebar = document.createElement('div')
  sidebar.style.cssText = 'position:sticky;top:30px;left:0;align-self:start;height:200px;overflow:auto;background:rgb(0,0,255);margin:0;'
  const sideInner = document.createElement('div')
  sideInner.style.cssText = 'height:600px;margin:0;'
  const sideTop = document.createElement('div')
  sideTop.style.cssText = 'height:60px;background:rgb(255,255,0);margin:0;'
  sideInner.appendChild(sideTop)
  sidebar.appendChild(sideInner)
  const content = document.createElement('div')
  content.style.cssText = 'background:rgb(230,230,230);margin:0;'
  stage.appendChild(sidebar)
  stage.appendChild(content)
  const footer = document.createElement('div')
  footer.style.cssText = 'position:sticky;bottom:0;height:30px;background:rgb(0,128,0);z-index:4;margin:0;'
  footer.textContent = 'F'
  root.appendChild(header)
  root.appendChild(stage)
  root.appendChild(footer)
  return { root, header, footer, sidebar }
}

describe('sticky freeze on scrolled element captures', () => {
  it('stuck header and footer render at the top/bottom edges of the scrolled box', async () => {
    const { root } = buildScroller()
    mount(root)
    root.scrollTop = 200
    const ctx = await rasterize(root)
    // header stuck at top edge
    const top = ctx.getImageData(250, 15, 1, 1).data
    expect(top[0]).toBeGreaterThan(200)
    expect(top[1]).toBeLessThan(60)
    // footer stuck at bottom edge (300 - 15)
    const bottom = ctx.getImageData(250, 285, 1, 1).data
    expect(bottom[1]).toBeGreaterThan(90)
    expect(bottom[0]).toBeLessThan(60)
  })

  it('left-sticky sidebar hugs the left edge under horizontal scroll, inner scroll preserved', async () => {
    const { root, sidebar } = buildScroller()
    mount(root)
    root.scrollTop = 100
    root.scrollLeft = 150
    sidebar.scrollTop = 40
    const ctx = await rasterize(root)
    // sidebar stuck against the left edge (x 0-120 visible zone): blue at (60, 150)
    const side = ctx.getImageData(60, 150, 1, 1).data
    expect(side[2]).toBeGreaterThan(200)
    expect(side[0]).toBeLessThan(60)
    // inner scroll 40: the 60px yellow strip has 20px left visible below the sticky top
    // sidebar painted top = 30 (its top anchor) → yellow at y 30+10, blue again at y 30+40
    const yellow = ctx.getImageData(60, 40, 1, 1).data
    expect(yellow[0]).toBeGreaterThan(200)
    expect(yellow[1]).toBeGreaterThan(200)
    expect(yellow[2]).toBeLessThan(80)
    const blueBelow = ctx.getImageData(60, 80, 1, 1).data
    expect(blueBelow[2]).toBeGreaterThan(200)
    expect(blueBelow[0]).toBeLessThan(60)
  })

  it('unscrolled root: sticky stays in flow, no placeholders injected', async () => {
    const { root } = buildScroller()
    mount(root)
    const url = await snapdom.toRaw(root, { cache: 'disabled' })
    const svg = decodeURIComponent(url.replace('data:image/svg+xml;charset=utf-8,', ''))
    expect(svg).not.toContain('data-snap-ph')
  })
})
