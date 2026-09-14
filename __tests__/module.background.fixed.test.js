// background-attachment: fixed sizes/positions against the browser viewport, but the
// rasterized SVG's viewport is the element box — the capture must freeze the exact
// slice the user was seeing (viewport-resolved px size/position, attachment → scroll).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

function bigPng(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#3355aa'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffcc00'; ctx.fillRect(0, 0, w / 2, h / 2)
  return c.toDataURL('image/png')
}

describe('background-attachment: fixed freeze', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('cover+fixed layer becomes scroll with viewport-resolved px size and element-local position', async () => {
    const el = document.createElement('div')
    el.style.cssText = `width:200px;height:120px;background-image:url("${bigPng(800, 600)}");` +
      'background-size:cover;background-attachment:fixed;background-position:50% 50%'
    document.body.appendChild(el)

    const res = await snapdom(el, { cache: 'disabled' })
    // Inline styles are what render (they out-rank the class CSS, which may still carry
    // the raw declarations) — assert on the markup outside <style>.
    const svg = decodeURIComponent(res.url.split(',')[1]).replace(/<style[\s\S]*?<\/style>/g, '')
    expect(svg).not.toMatch(/background-attachment:\s*fixed/)
    // cover against the viewport resolves to concrete px, not the keyword
    expect(svg).not.toMatch(/background-size:\s*cover/)
    expect(svg).toMatch(/background-size:\s*[\d.]+px\s+[\d.]+px/)
    expect(svg).toMatch(/background-position:\s*-?[\d.]+px\s+-?[\d.]+px/)
  })

  it('inside a transformed ancestor, fixed just degrades to scroll (matches live rendering)', async () => {
    const wrap = document.createElement('div')
    wrap.style.transform = 'translateZ(0)'
    const el = document.createElement('div')
    el.style.cssText = `width:100px;height:80px;background-image:url("${bigPng(50, 50)}");` +
      'background-attachment:fixed;background-size:auto'
    wrap.appendChild(el)
    document.body.appendChild(wrap)

    const res = await snapdom(wrap, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1]).replace(/<style[\s\S]*?<\/style>/g, '')
    expect(svg).not.toMatch(/background-attachment:\s*fixed/)
    // no compensation: original size keyword survives
    expect(svg).not.toMatch(/background-size:\s*[\d.]+px\s+[\d.]+px.*background-position:\s*-[\d.]+px/)
  })

  it('resolves fixed background percentages against the owning iframe viewport', async () => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:300px;height:200px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    const el = doc.createElement('div')
    el.id = 'frame-fixed-background'
    el.style.cssText = `width:100px;height:80px;background-image:url("${bigPng(40, 40)}");` +
      'background-size:50% 50%;background-attachment:fixed;background-position:0% 0%'
    doc.body.appendChild(el)
    const result = await snapdom(el, { cache: 'disabled', burst: false })
    const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.split(',')[1]), 'image/svg+xml')
    const style = svg.querySelector('#frame-fixed-background').getAttribute('style')
    expect(style).toMatch(/background-size:\s*150px 100px/)
  })

  it.each(['50% 25%', '120px auto'])('honors an explicit %s size on a fixed gradient', async (size) => {
    const el = document.createElement('div')
    el.id = 'sized-fixed-gradient'
    el.style.cssText = 'width:100px;height:80px;background-image:linear-gradient(red,blue);' +
      `background-size:${size};background-attachment:fixed;background-position:0% 0%`
    document.body.appendChild(el)
    const result = await snapdom(el, { cache: 'disabled', burst: false })
    const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.split(',')[1]), 'image/svg+xml')
    const style = svg.querySelector('#sized-fixed-gradient').getAttribute('style')
    const expected = size === '50% 25%' ? `${window.innerWidth / 2}px ${window.innerHeight / 4}px` : `120px ${window.innerHeight}px`
    expect(style).toContain(`background-size: ${expected}`)
  })
})
