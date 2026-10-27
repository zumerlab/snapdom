/**
 * Tier 2 of the face filter (a single-weight face within 300 of the request) is held until
 * the scan ends, and a face is kept only over a used codepoint the exact faces of that
 * request leave uncovered. Over a covered one it never paints: Chromium and Firefox move on
 * to the next family, and only WebKit reaches the family's other weights, for uncovered
 * codepoints. In the jant#174 scene the dropped 700 faces halved the svg, pixel-identical.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { embedCustomFonts, FONT_KEY_SEP } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

const EXACT = 'data:font/woff2;base64,RVhBQ1Q='
const NEAR = 'data:font/woff2;base64,TkVBUg=='
const nodes = []

function addSheet(css, as) {
  const node = as === 'link' ? document.createElement('link') : document.createElement('style')
  if (as === 'link') {
    node.rel = 'stylesheet'
    node.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }))
  } else {
    node.textContent = css
  }
  document.head.appendChild(node)
  nodes.push(node)
  return as === 'link' ? new Promise((resolve) => { node.onload = resolve }) : null
}

const embed = (weight, text) => embedCustomFonts({
  required: new Set([['NearW', weight, 'normal', 100].join(FONT_KEY_SEP)]),
  usedCodepoints: new Set(Array.from(text, (ch) => ch.codePointAt(0))),
})

describe('near-weight faces', () => {
  beforeEach(() => { cache.resource?.clear?.() })
  afterEach(() => { for (const n of nodes.splice(0)) n.remove() })

  for (const as of ['style', 'link']) {
    it(`drops a 700 face the exact 400 faces cover (${as})`, async () => {
      await addSheet(`
        @font-face { font-family: NearW; src: url(${NEAR}); font-weight: 700; unicode-range: U+0-FF; }
        @font-face { font-family: NearW; src: url(${EXACT}); font-weight: 400; unicode-range: U+0-FF; }`, as)
      const css = await embed('400', 'AÁ')
      expect(css).toContain(EXACT)
      expect(css).not.toContain(NEAR)
    })
  }

  it('keeps a 700 face over a codepoint the 400 faces leave out, which WebKit paints with it', async () => {
    await addSheet(`
      @font-face { font-family: NearW; src: url(${EXACT}); font-weight: 400; unicode-range: U+0-7F; }
      @font-face { font-family: NearW; src: url(${NEAR}); font-weight: 700; unicode-range: U+80-FF; }`)
    const css = await embed('400', 'AÁ')
    expect(css).toContain(EXACT)
    expect(css).toContain(NEAR)
  })

  it('keeps it when the exact face declares no unicode-range, which says nothing about its glyphs', async () => {
    await addSheet(`
      @font-face { font-family: NearW; src: url(${EXACT}); font-weight: 400; }
      @font-face { font-family: NearW; src: url(${NEAR}); font-weight: 700; }`)
    const css = await embed('400', 'A')
    expect(css).toContain(NEAR)
  })

  it('keeps it when the request has no exact face', async () => {
    await addSheet(`
      @font-face { font-family: NearW; src: url(${EXACT}); font-weight: 400; unicode-range: U+0-FF; }
      @font-face { font-family: NearW; src: url(${NEAR}); font-weight: 700; unicode-range: U+0-FF; }`)
    const css = await embed('600', 'A')
    expect(css).toContain(EXACT)
    expect(css).toContain(NEAR)
  })
})
