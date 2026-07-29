// <object>/<embed> pointing at images must not render blank (or paint their fallback
// children) — the handler substitutes an <img> that inlineImages fetches like any source.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('<object>/<embed> capture', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('image-typed <object> becomes an inlined <img>, fallback children dropped', async () => {
    const host = document.createElement('div')
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
