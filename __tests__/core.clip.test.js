// Region / viewport capture (`clip` option): offscreen subtrees are pruned into
// layout-preserving husks and the output is windowed to the clip rect.
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
  window.scrollTo(0, 0)
})

function decodeSvg(url) {
  return decodeURIComponent(url.replace('data:image/svg+xml;charset=utf-8,', ''))
}

function buildBlocks(count, height, extra = '') {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'width:400px;margin:0;padding:0;'
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div')
    b.style.cssText = `height:${height}px;margin:0;background:#fff;${extra}`
    b.textContent = `BLOCK_${i}_MARKER`
    wrap.appendChild(b)
  }
  return wrap
}

describe('clip option (region capture)', () => {
  it('captures a page-coordinate region: windowed output, offscreen content culled', async () => {
    const wrap = mount(buildBlocks(10, 400))
    const target = wrap.children[5]
    const r = target.getBoundingClientRect()
    const clip = {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height
    }
    const url = await snapdom.toRaw(document.body, { clip })
    const svg = decodeSvg(url)

    expect(svg).toContain('BLOCK_5_MARKER')
    // adjacent block is inside the 200px cull margin — kept
    expect(svg).toContain('BLOCK_4_MARKER')
    // far-away block pruned before styling/inlining
    expect(svg).not.toContain('BLOCK_0_MARKER')
    expect(svg).not.toContain('BLOCK_9_MARKER')
    expect(svg).toMatch(new RegExp(`<svg [^>]*width="${clip.width}"`))
    expect(svg).toMatch(new RegExp(`height="${clip.height}"`))
  })

  it('culled siblings keep their layout slot: clipped region pixels match the live DOM', async () => {
    const wrap = mount(buildBlocks(8, 400))
    const target = wrap.children[5]
    target.style.background = 'rgb(255, 0, 0)'
    const r = target.getBoundingClientRect()
    const clip = {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height
    }
    const canvas = await snapdom.toCanvas(document.body, { clip, dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / clip.width
    const sy = canvas.height / clip.height
    const px = ctx.getImageData(Math.round(clip.width / 2 * sx), Math.round(clip.height / 2 * sy), 1, 1).data
    // if blocks 0–4 hadn't held their space, the red block would miss the window
    expect(px[0]).toBeGreaterThan(200)
    expect(px[1]).toBeLessThan(60)
    expect(px[2]).toBeLessThan(60)
    expect(px[3]).toBeGreaterThan(200)
  })

  it("clip: 'viewport' outputs viewport-sized SVG and prunes far content", async () => {
    const wrap = mount(buildBlocks(30, 400))
    wrap.children[0].textContent = 'NEAR_TOP_MARKER'
    wrap.children[29].textContent = 'FAR_BOTTOM_MARKER'
    const result = await snapdom(document.documentElement, { clip: 'viewport' })
    const svg = decodeSvg(result.url)

    expect(svg).toMatch(new RegExp(`<svg [^>]*width="${window.innerWidth}"`))
    expect(svg).toMatch(new RegExp(`height="${window.innerHeight}"`))
    expect(svg).toContain('NEAR_TOP_MARKER')
    expect(svg).not.toContain('FAR_BOTTOM_MARKER')
  })

  it('fixed elements render at their painted position', async () => {
    mount(buildBlocks(12, 400))
    const badge = mount(document.createElement('div'))
    badge.style.cssText =
      'position:fixed;left:20px;top:20px;width:60px;height:60px;background:rgb(0, 0, 255);z-index:9999;margin:0;'
    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / window.innerWidth
    const sy = canvas.height / window.innerHeight
    const px = ctx.getImageData(Math.round(50 * sx), Math.round(50 * sy), 1, 1).data
    expect(px[2]).toBeGreaterThan(200)
    expect(px[0]).toBeLessThan(60)
  })

  it('sticky stuck inside a scrolled container is frozen at its painted position', async () => {
    const scroller = mount(document.createElement('div'))
    // offset from the page origin on purpose: a scroller at (0,0) masks coordinate bugs
    // where the #364 wrapper origin gets double-counted
    scroller.style.cssText = 'width:300px;height:300px;overflow:auto;margin:120px 0 0 40px;'
    const header = document.createElement('div')
    header.style.cssText = 'position:sticky;top:0;height:40px;background:rgb(255, 0, 0);margin:0;'
    header.textContent = 'STICKY'
    const filler = document.createElement('div')
    filler.style.cssText = 'height:1200px;background:#fff;margin:0;'
    scroller.appendChild(header)
    scroller.appendChild(filler)
    scroller.scrollTop = 150

    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const r = scroller.getBoundingClientRect()
    const sx = canvas.width / window.innerWidth
    const sy = canvas.height / window.innerHeight
    // stuck header paints at the scroller's top edge, not at its flow position (-150px)
    const px = ctx.getImageData(Math.round((r.left + 150) * sx), Math.round((r.top + 20) * sy), 1, 1).data
    expect(px[0]).toBeGreaterThan(200)
    expect(px[1]).toBeLessThan(60)
  })

  it('keeps a fixed element whose static parent is below the fold', async () => {
    const parent = mount(document.createElement('div'))
    parent.style.cssText = 'margin-top:5000px;height:100px;'
    const badge = document.createElement('div')
    badge.style.cssText = 'position:fixed;left:30px;top:30px;width:50px;height:50px;background:rgb(255,0,0);z-index:999;margin:0;'
    parent.appendChild(badge)
    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / document.documentElement.clientWidth
    const sy = canvas.height / document.documentElement.clientHeight
    const px = ctx.getImageData(Math.round(55 * sx), Math.round(55 * sy), 1, 1).data
    expect(px[0]).toBeGreaterThan(200)
    expect(px[1]).toBeLessThan(60)
  })

  it('keeps an absolute element escaping an offscreen static parent', async () => {
    const cb = mount(document.createElement('div'))
    // padding-top stops the child's 5000px margin collapsing through this box
    cb.style.cssText = 'position:relative;width:400px;height:200px;padding-top:1px;'
    const offscreen = document.createElement('div')
    offscreen.style.cssText = 'margin-top:5000px;height:100px;'
    const child = document.createElement('div')
    child.style.cssText = 'position:absolute;left:10px;top:40px;width:60px;height:60px;background:rgb(0,128,0);margin:0;'
    offscreen.appendChild(child)
    cb.appendChild(offscreen)
    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const r = child.getBoundingClientRect()
    const sx = canvas.width / document.documentElement.clientWidth
    const sy = canvas.height / document.documentElement.clientHeight
    const px = ctx.getImageData(Math.round((r.left + 30) * sx), Math.round((r.top + 30) * sy), 1, 1).data
    expect(px[1]).toBeGreaterThan(100)
    expect(px[0]).toBeLessThan(60)
  })

  it('keeps RTL text overflowing leftward into the window', async () => {
    const wrap = mount(buildBlocks(3, 400))
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:3000px;top:100px;width:50px;direction:rtl;white-space:nowrap;'
    box.textContent = 'LEFT_OVERFLOW_MARKER '.repeat(200)
    wrap.appendChild(box)
    const url = await snapdom.toRaw(document.body, { clip: { x: 0, y: 0, width: 500, height: 500 } })
    expect(decodeSvg(url)).toContain('LEFT_OVERFLOW_MARKER')
  })

  it('culls offscreen replaced images (no inlined payload for pruned <img>)', async () => {
    // 1x1 red png with a recognizable base64 body
    const MARK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const wrap = mount(buildBlocks(3, 400))
    const img = document.createElement('img')
    img.src = `data:image/png;base64,${MARK}`
    img.style.cssText = 'width:40px;height:40px;'
    const far = document.createElement('div')
    far.style.cssText = 'margin-top:5000px;'
    far.appendChild(img)
    wrap.appendChild(far)
    await new Promise(r => (img.complete ? r() : (img.onload = r)))
    const url = await snapdom.toRaw(document.body, { clip: { x: 0, y: 0, width: 400, height: 400 } })
    expect(decodeSvg(url)).not.toContain(MARK)
  })

  it('frozen sticky respects content-box sizing (no inflation)', async () => {
    const scroller = mount(document.createElement('div'))
    scroller.style.cssText = 'width:300px;height:300px;overflow:auto;margin:0;'
    const header = document.createElement('div')
    header.style.cssText = 'position:sticky;top:0;box-sizing:content-box;padding:20px;height:40px;background:rgb(255,0,0);margin:0;'
    const filler = document.createElement('div')
    filler.style.cssText = 'height:1200px;background:rgb(255,255,255);'
    scroller.appendChild(header)
    scroller.appendChild(filler)
    scroller.scrollTop = 150
    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const r = scroller.getBoundingClientRect()
    const sx = canvas.width / document.documentElement.clientWidth
    const sy = canvas.height / document.documentElement.clientHeight
    // live border-box height is 80px: red at +70, white again at +100
    const inside = ctx.getImageData(Math.round((r.left + 150) * sx), Math.round((r.top + 70) * sy), 1, 1).data
    const below = ctx.getImageData(Math.round((r.left + 150) * sx), Math.round((r.top + 100) * sy), 1, 1).data
    expect(inside[0]).toBeGreaterThan(200)
    expect(inside[1]).toBeLessThan(60)
    expect(below[1]).toBeGreaterThan(200)
  })

  it('fixed element with individual rotate keeps its rotation', async () => {
    mount(buildBlocks(3, 400))
    const badge = mount(document.createElement('div'))
    badge.style.cssText = 'position:fixed;left:100px;top:100px;width:80px;height:80px;background:rgb(0,0,255);z-index:999;margin:0;rotate:45deg;'
    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / document.documentElement.clientWidth
    const sy = canvas.height / document.documentElement.clientHeight
    // center stays blue; the box corner (108,108) shows the white block behind when
    // rotated 45° (blue channel is 255 for both — discriminate on red)
    const center = ctx.getImageData(Math.round(140 * sx), Math.round(140 * sy), 1, 1).data
    const corner = ctx.getImageData(Math.round(108 * sx), Math.round(108 * sy), 1, 1).data
    expect(center[2]).toBeGreaterThan(200)
    expect(center[0]).toBeLessThan(60)
    expect(corner[0]).toBeGreaterThan(200)
  })

  it('clip + outerShadows keeps the exact requested size (no bleed expansion)', async () => {
    const el = mount(document.createElement('div'))
    el.style.cssText = 'width:400px;height:400px;box-shadow:0 0 40px 20px rgba(0,0,0,.5);background:teal;margin:0;'
    const r = el.getBoundingClientRect()
    const clip = { x: r.left + window.scrollX + 50, y: r.top + window.scrollY + 50, width: 100, height: 100 }
    const url = await snapdom.toRaw(document.body, { clip, outerShadows: true })
    const svg = decodeSvg(url)
    expect(svg).toMatch(/<svg [^>]*width="100"/)
    expect(svg).toMatch(/height="100"/)
  })

  it("clip: 'viewport' on documentElement covers body margins", async () => {
    document.body.style.margin = '20px'
    try {
      const block = mount(document.createElement('div'))
      block.style.cssText = 'width:100px;height:100px;background:rgb(255,0,255);margin:0;'
      const canvas = await snapdom.toCanvas(document.documentElement, { clip: 'viewport', dpr: 1 })
      const ctx = canvas.getContext('2d')
      const r = block.getBoundingClientRect()
      const sx = canvas.width / document.documentElement.clientWidth
      const sy = canvas.height / document.documentElement.clientHeight
      // the block sits at the body margin offset; the capture must place it there too
      const px = ctx.getImageData(Math.round((r.left + 50) * sx), Math.round((r.top + 50) * sy), 1, 1).data
      expect(px[0]).toBeGreaterThan(200)
      expect(px[2]).toBeGreaterThan(200)
      expect(px[1]).toBeLessThan(60)
    } finally {
      document.body.style.margin = ''
    }
  })

  it('viewport capture of a SCROLLED page shows the visible slice (fo must reach the window)', async () => {
    const wrap = mount(buildBlocks(10, 400))
    wrap.children[4].style.background = 'rgb(255, 0, 0)' // spans y 1600-2000
    window.scrollTo(0, 1700)
    if (window.scrollY !== 1700) return // runner can't scroll: nothing to assert
    const canvas = await snapdom.toCanvas(document.documentElement, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / document.documentElement.clientWidth
    const sy = canvas.height / document.documentElement.clientHeight
    // page y 1800 → viewport y 100 → red
    const px = ctx.getImageData(Math.round(100 * sx), Math.round(100 * sy), 1, 1).data
    expect(px[0]).toBeGreaterThan(200)
    expect(px[1]).toBeLessThan(60)
    expect(px[3]).toBeGreaterThan(200)
  })

  it('clip: null behaves exactly like a normal capture', async () => {
    const el = mount(document.createElement('div'))
    el.style.cssText = 'width:120px;height:80px;background:teal;'
    const a = await snapdom.toRaw(el)
    const b = await snapdom.toRaw(el, { clip: null })
    expect(b).toBe(a)
  })
})
