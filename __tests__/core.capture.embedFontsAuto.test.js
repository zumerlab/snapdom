// embedFonts 'auto' (the default): svg-as-image is an isolated document that cannot see
// the page's loaded webfonts, so webfont text MUST embed for fidelity — but system-font
// pages must pay nothing. 'auto' embeds exactly when a used family is a document-declared
// webfont; true/false remain explicit overrides.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

const FONT_URL = 'data:font/woff2;base64,AAAA' // passes through embedCustomFonts untouched

afterEach(() => { document.body.innerHTML = '' })

function makeText(family) {
  const el = document.createElement('div')
  el.style.cssText = `width:200px;padding:8px;background:#fff;font-family:${family}, Arial, sans-serif`
  el.textContent = 'Texto de prueba'
  document.body.appendChild(el)
  return el
}

describe("embedFonts: 'auto' (default)", () => {
  it('system-font content embeds nothing', async () => {
    const el = makeText('Arial')
    const res = await snapdom(el, { cache: 'disabled' })
    expect(decodeURIComponent(res.url.split(',')[1])).not.toContain('@font-face')
  })

  it('embeds when a used family is a document-declared webfont', async () => {
    const style = document.createElement('style')
    style.textContent = `@font-face { font-family: 'AutoEmbedProbe'; src: url(${FONT_URL}); }`
    document.head.appendChild(style)
    try {
      const el = makeText('AutoEmbedProbe')
      const res = await snapdom(el, { cache: 'disabled' })
      const svg = decodeURIComponent(res.url.split(',')[1])
      expect(svg).toContain('@font-face')
      expect(svg).toContain('AutoEmbedProbe')
    } finally {
      style.remove()
    }
  })

  it('explicit false skips the embed even with webfonts in use', async () => {
    const style = document.createElement('style')
    style.textContent = `@font-face { font-family: 'AutoEmbedProbe2'; src: url(${FONT_URL}); }`
    document.head.appendChild(style)
    try {
      const el = makeText('AutoEmbedProbe2')
      const res = await snapdom(el, { embedFonts: false, cache: 'disabled' })
      expect(decodeURIComponent(res.url.split(',')[1])).not.toContain('@font-face')
    } finally {
      style.remove()
    }
  })
})
