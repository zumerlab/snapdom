// <object>/<embed> pointing at images must not render blank (or paint their fallback
// children) — the handler substitutes an <img> that inlineImages fetches like any source.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// SOLID RED 1x1, generated at runtime — deliberately not the transparent pixel: CLAUDE.md
// records a transparent control that measured 0% diff and nearly validated a broken harness.
// An opaque fixture is the only kind the paint probe below can register.
const PIXEL_PNG = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgb(255,0,0)'
  ctx.fillRect(0, 0, 1, 1)
  return c.toDataURL('image/png')
})()

describe('<object>/<embed> capture', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('image-typed <object> becomes an inlined <img>, fallback children dropped', async () => {
    const host = document.createElement('div')
    // Size the host to the object: an unstyled div is block-level (~viewport wide), so a
    // "centre" sample would land far to the right of the 40px object and read background.
    host.style.cssText = 'width:40px;height:40px'
    const obj = document.createElement('object')
    obj.setAttribute('type', 'image/png')
    obj.setAttribute('data', PIXEL_PNG)
    obj.style.cssText = 'width:40px;height:40px'
    obj.innerHTML = '<span>FALLBACK-TEXT</span>'
    host.appendChild(obj)
    document.body.appendChild(host)

    const res = await snapdom(host, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('<img')
    expect(svg).not.toContain('FALLBACK-TEXT')
    expect(svg).not.toContain('<object')
    // A serialized <img> does not prove it decodes and paints (the payload can lie — see
    // CLAUDE.md). The 1x1 red fixture stretches to fill the 40x40 object box: the centre
    // pixel must carry it.
    const canvas = await res.toCanvas()
    const d = canvas.getContext('2d')
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect(d[0]).toBeGreaterThan(200)
    expect(d[3]).toBe(255)
  })

  it('image <embed> becomes an <img> too', async () => {
    const host = document.createElement('div')
    const emb = document.createElement('embed')
    emb.setAttribute('type', 'image/png')
    emb.setAttribute('src', PIXEL_PNG)
    emb.style.cssText = 'width:40px;height:40px'
    host.appendChild(emb)
    document.body.appendChild(host)

    const res = await snapdom(host, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('<img')
    expect(svg).not.toContain('<embed')
  })

  it('unresolvable <object> renders its fallback children (honest output)', async () => {
    const host = document.createElement('div')
    const obj = document.createElement('object')
    obj.setAttribute('type', 'application/pdf')
    obj.setAttribute('data', 'https://example.com/x.pdf')
    obj.innerHTML = '<span>sin plugin</span>'
    host.appendChild(obj)
    document.body.appendChild(host)

    const res = await snapdom(host, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('sin plugin')
  })
})
