// result.warnings: a programmatic "did this capture degrade" answer — flat array fed by
// the curated failure branches, empty in the common case.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/api/snapdom.js'

describe('result.warnings', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('clean capture → empty array', async () => {
    const el = document.createElement('div')
    el.textContent = 'ok'
    document.body.appendChild(el)
    const res = await snapdom(el, { cache: 'disabled' })
    expect(Array.isArray(res.warnings)).toBe(true)
    expect(res.warnings.length).toBe(0)
  })

  it('failed image → placeholder records image-fallback', async () => {
    const el = document.createElement('div')
    const img = document.createElement('img')
    img.src = 'http://localhost:1/inexistente-404.png'
    img.width = 40; img.height = 40
    el.appendChild(img)
    document.body.appendChild(el)
    const res = await snapdom(el, { cache: 'disabled' })
    expect(res.warnings.some(w => w.code === 'image-fallback')).toBe(true)
    expect(res.warnings[0]).toHaveProperty('message')
  })

  // A Leaflet tile from a host without CORS: absolute and translated. The placeholder used to be
  // a new <div> without the clone's class, so it landed at the origin and left the tile's
  // place empty.
  it('a no-CORS image keeps its box: the placeholder paints where the image was', async () => {
    const src = await commands.serveCrossOriginJpeg('demos/assets/wolf.jpg')
    const el = document.createElement('div')
    el.style.cssText = 'position:relative;width:200px;height:100px;background:rgb(255,255,255)'
    const img = new Image()
    img.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px;transform:translateX(100px)'
    img.src = src
    el.appendChild(img)
    document.body.appendChild(el)
    await img.decode()
    const res = await snapdom(el, { cache: 'disabled' })
    const ctx = (await res.toCanvas({ dpr: 1 })).getContext('2d')
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]
    expect(px(50, 50)).toEqual([255, 255, 255])
    expect(px(150, 20)).toEqual([204, 204, 204])
    expect(res.warnings.some(w => w.code === 'image-fallback' && w.message.includes(src))).toBe(true)
  })

  it('a canvas tainted by a no-CORS image records canvas-tainted', async () => {
    const img = new Image()
    img.src = await commands.serveCrossOriginJpeg('demos/assets/wolf.jpg')
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 50
    canvas.getContext('2d').drawImage(img, 0, 0)
    const el = document.createElement('div')
    el.appendChild(canvas)
    document.body.appendChild(el)
    const res = await snapdom(el, { cache: 'disabled' })
    expect(res.warnings.some(w => w.code === 'canvas-tainted')).toBe(true)
  })

  it('oversized export records canvas-clamp; the console hears it only under debug', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:200px;height:100px;background:#234'
    document.body.appendChild(el)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await snapdom(el, { cache: 'disabled' })
    await res.toCanvas({ width: 30000, height: 20000, dpr: 1 })
    expect(res.warnings.some(w => w.code === 'canvas-clamp')).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    const loud = await snapdom(el, { cache: 'disabled', debug: true })
    await loud.toCanvas({ width: 30000, height: 20000, dpr: 1 })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    el.remove()
  })
})
