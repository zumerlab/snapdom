// #557: an icon-font glyph above U+FFFF is a surrogate pair, two UTF-16 units, so the pseudo
// pass skipped iconToImage for it and the glyph painted nothing (icon fonts are not embedded).
// Material Design Icons 5+ puts every glyph there. astral-icons.woff2 (fixtures README) maps
// one square to U+E000, the BMP control, and one to U+F0000.
import { afterEach, beforeAll, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

beforeAll(async () => {
  const face = new FontFace('Astral Icons', 'url(/__tests__/fixtures/fonts/astral-icons.woff2)')
  document.fonts.add(await face.load())
})

let host
afterEach(() => { host?.remove(); host = null })

async function ink(codePoint) {
  host = document.createElement('div')
  host.innerHTML = `<style>.ai::before{content:"\\${codePoint.toString(16)}";font-family:"Astral Icons";font-size:40px;color:#000}</style><i class="ai"></i>`
  host.style.cssText = 'position:absolute;left:0;top:0;padding:8px;background:#fff;line-height:1'
  document.body.appendChild(host)
  const canvas = await snapdom.toCanvas(host, { dpr: 1, embedFonts: false, cache: 'disabled' })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) n++
  host.remove()
  return n
}

it('draws a ::before glyph above U+FFFF like one in the BMP', async () => {
  const bmp = await ink(0xE000)
  expect(bmp, 'the BMP control paints').toBeGreaterThan(500)
  expect(await ink(0xF0000)).toBe(bmp)
})
