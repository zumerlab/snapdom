import { describe, it, expect, afterEach } from 'vitest'
import { embedCustomFonts, FONT_KEY_SEP } from '../src/modules/fonts.js'

// Required-font keys written the readable way; FONT_KEY_SEP is the real separator (#542).
const key = (k) => k.replaceAll('__', FONT_KEY_SEP)

// Text asks for italic 400 in a family that declares italic only at 700 and a normal 400.
// The italic 700 face matches by nearness, but the engine renders italic 400 by slanting the
// normal 400 face, so that face must be embedded too. The #478 fallback cannot cover this:
// the family already has a face, so nothing else is added for it.

const css = `
@font-face{font-family:'SlantFam';src:url(data:font/woff2;base64,AAAA);font-weight:700;font-style:italic}
@font-face{font-family:'SlantFam';src:url(data:font/woff2;base64,BBBB);font-weight:400;font-style:normal}
`

describe('italic requested where the family has only a normal face at that weight', () => {
  afterEach(() => { document.head.querySelectorAll('style[data-test-slant]').forEach(s => s.remove()) })

  it('embeds the normal face the engine will slant', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-test-slant', '')
    style.textContent = css
    document.head.appendChild(style)

    const out = await embedCustomFonts({
      required: new Set([key('SlantFam__400__italic__100')]),
      usedCodepoints: new Set([65]),
    })
    expect(out).toContain('AAAA')
    expect(out).toContain('BBBB')
  })
})
