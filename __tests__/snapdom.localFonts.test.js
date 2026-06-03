// localFonts must be honored in the direct capture path (not only via preCache): a user can
// supply a font file so the rasterized SVG uses it instead of falling back (e.g. system-ui is
// unavailable when an SVG renders as an <img>). capture.js previously dropped the option.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const svgOf = (raw) => decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))

describe('localFonts in capture', () => {
  let el
  beforeEach(() => {
    el = document.createElement('div')
    el.style.fontFamily = "'SnapTestFont', sans-serif"
    el.textContent = 'abc 123'
    document.body.appendChild(el)
  })
  afterEach(() => el.remove())

  it('embeds a user-provided localFonts @font-face when the family is used', async () => {
    const raw = await snapdom.toRaw(el, {
      embedFonts: true,
      localFonts: [{ family: 'SnapTestFont', src: 'data:font/woff2;base64,AAAA', weight: '400', style: 'normal' }],
    })
    expect(svgOf(raw)).toMatch(/@font-face\{font-family:'SnapTestFont';src:url\(data:font\/woff2;base64,AAAA\)/)
  })

  it('skips a localFonts family that the captured content does not use', async () => {
    const raw = await snapdom.toRaw(el, {
      embedFonts: true,
      localFonts: [{ family: 'UnusedFont', src: 'data:font/woff2;base64,AAAA' }],
    })
    expect(svgOf(raw)).not.toContain("font-family:'UnusedFont'")
  })
})
