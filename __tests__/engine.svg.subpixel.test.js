import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const hosts = []
afterEach(() => hosts.splice(0).forEach(h => h.remove()))

async function pixels(url, w, h, sx = 0, sy = 0) {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d').drawImage(img, -sx, -sy)
  return c.getContext('2d').getImageData(0, 0, w, h).data
}

// `__subpixel` lays a capture root out at its page offset's fraction (the stream plugin's
// patches): drawn on the whole pixel below, it must give the parent capture's pixels there.
describe('__subpixel root layout', () => {
  it('reproduces a box at a fractional offset, glyphs and rounded corners included', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:641px;padding:8px;background:#000;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font:14px/1.4 monospace'
    for (let i = 0; i < 5; i++) {
      const card = document.createElement('div')
      card.style.cssText = 'background:#fff;color:#000;border-radius:8px;padding:8px;height:44px'
      card.innerHTML = `<b>Card ${i}</b><div>value ${i * 11}</div>`
      host.append(card)
    }
    document.body.append(host)
    hosts.push(host)
    const hr = host.getBoundingClientRect()
    const o = { dpr: 1, embedFonts: false, outerShadows: false }
    const parent = await snapdom(host, o)
    for (const i of [1, 2, 3]) {
      const card = host.children[i]
      const r = card.getBoundingClientRect()
      const left = r.left - hr.left, top = r.top - hr.top
      expect(left % 1, `card ${i}`).not.toBe(0)
      const x0 = Math.floor(left), y0 = Math.floor(top)
      const res = await snapdom(card, { ...o, __subpixel: { x: left - x0, y: top - y0 } })
      // Compare the pixels the box covers fully; its antialiased edge pixels also hold the
      // backdrop behind it, which a capture of the box alone cannot contain.
      const w = Math.floor(r.width) - 1, h = Math.floor(r.height) - 1
      const own = await pixels(res.url, w, h, 1, 1)
      const inParent = await pixels(parent.url, w, h, x0 + 1, y0 + 1)
      let bad = 0
      for (let p = 0; p < own.length; p += 4) {
        if (own[p + 3] < 255) continue
        if (Math.max(Math.abs(own[p] - inParent[p]), Math.abs(own[p + 1] - inParent[p + 1]), Math.abs(own[p + 2] - inParent[p + 2])) > 32) bad++
      }
      expect(bad, `card ${i}`).toBe(0)
    }
  })
})
