/**
 * Issue #478 — a custom @font-face falls back to a system font when the element asks for
 * a weight or a stretch the single declared face does not literally cover.
 *
 * The reporter's own clue is the diagnosis: it happens with "a custom single font file",
 * and not with a full family like Roboto Condensed. With many faces some face satisfies
 * the filter; with one face the only face is rejected and nothing is embedded, so the
 * capture renders in a system fallback.
 *
 * The CSS font matching algorithm never does that: within a family it picks the CLOSEST
 * face and synthesises the difference. It only fails to draw the family when the family
 * has no faces at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async () => ({ ok: true, data: 'data:font/woff2;base64,AAAA' })),
}))

const FACE_SRC = 'url(https://cdn.example.com/single.woff2) format("woff2")'

function addFace(css) {
  const style = document.createElement('style')
  style.setAttribute('data-test-478', 'true')
  style.textContent = css
  document.head.appendChild(style)
  return style
}

/** The key shape embedCustomFonts expects: family__weight__style__stretchPct */
function required(family, weight = '400', style = 'normal', stretchPct = 100) {
  return new Set([`${family}__${weight}__${style}__${stretchPct}`])
}

function usedCodepoints(text = 'A') {
  const s = new Set()
  for (const ch of text) s.add(ch.codePointAt(0))
  return s
}

describe('#478 — a single custom @font-face must survive any weight/stretch request', () => {
  beforeEach(() => {
    cache.resource?.clear?.()
    cache.font?.clear?.()
  })
  afterEach(() => {
    document.querySelectorAll('style[data-test-478]').forEach((el) => el.remove())
  })

  it('keeps the face when the element asks for a far heavier weight', async () => {
    // One file, declared at 400. The page renders it at 800 — the browser synthesises
    // bold from this very face, so the capture needs it embedded.
    addFace(`@font-face{font-family:'SingleFile';src:${FACE_SRC};font-weight:400;font-style:normal;}`)

    const css = await embedCustomFonts({
      required: required('SingleFile', '800', 'normal', 100),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/SingleFile/)
    // and it has to be USABLE, not just mentioned: the file must have been inlined
    expect(css).toMatch(/src:\s*url\(data:font/)
  })

  it('keeps the face when the element asks for a lighter weight', async () => {
    addFace(`@font-face{font-family:'SingleLight';src:${FACE_SRC};font-weight:700;font-style:normal;}`)

    const css = await embedCustomFonts({
      required: required('SingleLight', '100', 'normal', 100),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/SingleLight/)
  })

  it('keeps the face when the element asks for a narrower stretch than declared', async () => {
    // No font-stretch descriptor, so the face is normal (100%). The page asks for 75%.
    addFace(`@font-face{font-family:'SingleStretch';src:${FACE_SRC};font-weight:400;font-style:normal;}`)

    const css = await embedCustomFonts({
      required: required('SingleStretch', '400', 'normal', 75),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/SingleStretch/)
  })

  it('keeps the face when the element asks for a wider stretch than declared', async () => {
    addFace(`@font-face{font-family:'SingleWide';src:${FACE_SRC};font-weight:400;font-style:normal;}`)

    const css = await embedCustomFonts({
      required: required('SingleWide', '400', 'normal', 150),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/SingleWide/)
  })

  it('keeps the face when weight AND stretch both miss', async () => {
    addFace(`@font-face{font-family:'SingleBoth';src:${FACE_SRC};font-weight:300;font-style:normal;}`)

    const css = await embedCustomFonts({
      required: required('SingleBoth', '900', 'normal', 62.5),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/SingleBoth/)
  })

  it('still embeds only the families the page actually uses', async () => {
    // The relaxation must not turn into "embed everything": an unrelated family stays out.
    addFace(`@font-face{font-family:'WantedFam';src:${FACE_SRC};font-weight:400;}`)
    addFace(`@font-face{font-family:'UnrelatedFam';src:${FACE_SRC};font-weight:400;}`)

    const css = await embedCustomFonts({
      required: required('WantedFam', '900', 'normal', 50),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/WantedFam/)
    expect(css).not.toMatch(/UnrelatedFam/)
  })

  it('still prefers the matching faces of a multi-face family', async () => {
    // Roboto-Condensed-like case: the family covers the request properly, so the exact
    // faces must come through. This is the case the reporter said already worked, and it
    // has to keep working.
    addFace('@font-face{font-family:\'MultiFam\';src:url(https://cdn.example.com/r400.woff2) format("woff2");font-weight:400;font-stretch:100%;}')
    addFace('@font-face{font-family:\'MultiFam\';src:url(https://cdn.example.com/r700.woff2) format("woff2");font-weight:700;font-stretch:100%;}')

    const css = await embedCustomFonts({
      required: required('MultiFam', '700', 'normal', 100),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(css).toMatch(/MultiFam/)
  })

  it('does not drag in far faces of a family that is already covered', async () => {
    // The payload guard. The fallback exists for families the filter left EMPTY; a family
    // with a good match must not start pulling its distant weights too, or every capture
    // of a nine-weight family would embed all nine files.
    addFace('@font-face{font-family:\'Covered\';src:url(https://cdn.example.com/w400.woff2) format("woff2");font-weight:400;}')
    addFace('@font-face{font-family:\'Covered\';src:url(https://cdn.example.com/w900.woff2) format("woff2");font-weight:900;}')

    const css = await embedCustomFonts({
      required: required('Covered', '400', 'normal', 100),
      usedCodepoints: usedCodepoints('A'),
    })

    // 400 is asked for and 900 is 500 away — out of the near-weight window, and the
    // family is covered, so it stays out.
    const faces = css.match(/@font-face/g) || []
    expect(faces.length).toBe(1)
    expect(css).toMatch(/font-weight:\s*400/)
    expect(css).not.toMatch(/font-weight:\s*900/)
  })
})
