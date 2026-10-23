// Icon fonts are never embedded, so inside the svg an icon element lays out in the fallback
// font. pinIconStruts (src/modules/iconFonts.js) keeps the icon font's share of each line.
// Material Icons is served from demos/assets, so this runs with no network.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { snapdom } from '../src/index.js'

beforeAll(async () => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/demos/assets/fonts/material-icons/material-icons.css'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; document.head.appendChild(link) })
  await document.fonts.load('28px "Material Icons"')
})

let host
afterEach(() => { host?.remove(); host = null })

const CASES = {
  'an empty icon element': '<div>Icono: <i style="font-family:\'Material Icons\';font-size:28px;vertical-align:-6px"></i></div>',
  'a Material ligature': '<div>Ligadura <span class="material-icons">home</span> texto</div>',
  'a ::before glyph': '<style>.ps::before{content:"\\e88a";font-family:"Material Icons";font-size:28px}</style><div>Pseudo <i class="ps"></i> texto</div>',
  'a large icon in a paragraph': '<p style="margin:0">Parrafo <i style="font-family:\'Material Icons\';font-size:40px"></i> con icono grande</p>',
}

// A 6px bar under the case: where it lands is where the case's lines ended.
async function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:10px;top:10px;width:300px;font:16px Arial;background:#fff'
  host.innerHTML = html + '<div class="bar" style="height:6px;background:rgb(255,0,0)"></div><div style="height:10px"></div>'
  document.body.appendChild(host)
  await document.fonts.ready
  return host
}

const barTop = (canvas) => {
  const d = canvas.getContext('2d').getImageData(5, 0, 1, canvas.height).data
  for (let y = 0; y < canvas.height; y++) if (d[y * 4] === 255 && d[y * 4 + 1] === 0 && d[y * 4 + 3] === 255) return y
  return -1
}

describe('an icon font keeps its share of the line', () => {
  for (const [name, html] of Object.entries(CASES)) {
    it(`for ${name}`, async () => {
      await mount(html)
      const live = Math.round(host.querySelector('.bar').getBoundingClientRect().top - host.getBoundingClientRect().top)
      const canvas = await snapdom.toCanvas(host, { dpr: 1, cache: 'disabled' })
      expect(barTop(canvas)).toBe(live)
    })
  }

  // The bar proves the line heights; the glyphs must sit where the page paints them too.
  it('paints the glyphs where the page does', async () => {
    await page.viewport(800, 600)
    await mount(Object.values(CASES).join(''))
    const shot = await page.screenshot({ element: host, base64: true, save: false })
    const img = new Image()
    img.src = 'data:image/png;base64,' + (shot.base64 || shot)
    await img.decode()
    const canvas = await snapdom.toCanvas(host, { dpr: 1, cache: 'disabled' })
    // Ink rows (dark pixels) of each picture, compared as sets: a glyph 1px off already moves
    // some rows, a whole line off moves dozens.
    const inkRows = (src, w, h) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(src, 0, 0)
      const d = ctx.getImageData(0, 0, w, h).data
      const rows = new Set()
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) { rows.add(y); break } }
      return rows
    }
    const w = Math.min(img.naturalWidth, canvas.width), h = Math.min(img.naturalHeight, canvas.height)
    const a = inkRows(img, w, h), b = inkRows(canvas, w, h)
    const differ = [...a].filter((y) => !b.has(y)).length + [...b].filter((y) => !a.has(y)).length
    expect(differ).toBeLessThanOrEqual(2)
  }, 30_000)
})
