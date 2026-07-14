// #452 — an empty ::before/::after box sized by CSS (width/height, content:'') must keep
// its size in the capture. The pseudo span used to go through width softening as if it were
// content-sized: a flex-item dot collapsed to 0 width (min-width floor overridden by the
// flex item's computed min-width:auto) and a display:block dot stretched to the host width.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

async function rasterImage(el) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, scale: 1 })
  const ctx = canvas.getContext('2d')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function bboxOf(img, pred) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (pred(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3])) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

// The dot paints #2F63FF inside a 1px red border (8px border-box → 6px blue core)
const isBlue = (r, g, b, a) => a > 200 && b > 180 && r < 120 && g < 130

const DOT_CSS = `content:""; box-sizing:border-box; width:8px; height:8px;
  background-color:#2F63FF; border:1px solid red; border-radius:50%; margin-right:8px;`

describe('#452 empty pseudo-element box keeps its CSS size', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host)
    style = document.createElement('style')
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('inline-block pseudo inside a flex host does not collapse', async () => {
    style.textContent = `#i452a { display:flex; align-items:center; }
      #i452a::before { display:inline-block; ${DOT_CSS} }`
    host.innerHTML = '<div id="i452a">Item</div>'
    const box = bboxOf(await rasterImage(host.querySelector('#i452a')), isBlue)
    expect(box).toBeTruthy()
    expect(box.w).toBeGreaterThanOrEqual(5)
    expect(box.w).toBeLessThanOrEqual(8)
    expect(box.h).toBeGreaterThanOrEqual(5)
    expect(box.h).toBeLessThanOrEqual(8)
  })

  it('display:block pseudo does not stretch to the host width', async () => {
    style.textContent = `#i452b { display:block; }
      #i452b::before { display:block; ${DOT_CSS} }`
    host.innerHTML = '<div id="i452b">Item</div>'
    const box = bboxOf(await rasterImage(host.querySelector('#i452b')), isBlue)
    expect(box).toBeTruthy()
    expect(box.w).toBeLessThanOrEqual(8) // was ~392px (full host width)
    expect(box.h).toBeLessThanOrEqual(8)
  })

  it('inline-block pseudo inside a block host keeps its size (control)', async () => {
    style.textContent = `#i452c { display:block; }
      #i452c::before { display:inline-block; ${DOT_CSS} }`
    host.innerHTML = '<div id="i452c">Item</div>'
    const box = bboxOf(await rasterImage(host.querySelector('#i452c')), isBlue)
    expect(box).toBeTruthy()
    expect(box.w).toBeGreaterThanOrEqual(5)
    expect(box.w).toBeLessThanOrEqual(8)
  })

  it('pseudo with text content still softens (no hard width freeze)', async () => {
    style.textContent = `#i452d { display:block; }
      #i452d::before { content:"tag"; display:inline-block; width:120px; }`
    host.innerHTML = '<div id="i452d">Item</div>'
    const raw = decodeURIComponent(
      (await snapdom.toRaw(host.querySelector('#i452d'))).replace(/^data:image\/svg\+xml;charset=utf-8,/, '')
    )
    const css = (raw.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
    const rules = {}
    css.replace(/\.(c\d+)\s*\{([^}]*)\}/g, (_, n, b) => { rules[n] = b; return _ })
    const m = raw.match(/<span[^>]*data-snapdom-pseudo="::before"[^>]*class="([^"]*)"/)
    const rule = ((m || [])[1] || '').split(/\s+/).map(c => rules[c] || '').join(';')
    // content-sized → width is softened to a min-width floor, not frozen hard
    expect(/(?:^|;)\s*width:\s*120px/.test(rule)).toBe(false)
    expect(rule).toMatch(/min-width:\s*120px/)
  })
})
