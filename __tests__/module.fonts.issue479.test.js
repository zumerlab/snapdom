/**
 * Issue #479 — variable font axes (wght / wdth / slnt) were flattened in the capture when the
 * @font-face declared no range descriptor.
 *
 * An absent descriptor is NOT equivalent to an explicit default on a variable font. Measured
 * natively (canvas 2D, same font matching as CSS), rendering "HAMBURGER" at weight 100 vs 900
 * with the same variable file gives:
 *
 *   (no font-weight descriptor)  ink 2015 / 10631  -> the wght axis spans its whole range
 *   font-weight: 400             ink 6480 /  7147  -> the axis is pinned to 400
 *   font-weight: normal          ink 6480 /  7147  -> idem
 *   font-weight: 100 900         ink 2015 / 10631  -> full range again
 *
 * embedCustomFonts re-emits @font-face rules read from the CSSOM, and it substituted the CSS
 * default for every missing descriptor, so a rule with no font-weight came out as
 * `font-weight:400` and pinned the axis. The live page varied the weight, the capture did not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async () => ({ ok: true, data: 'data:font/woff2;base64,AAAA' })),
}))

const SRC = 'url(https://cdn.example.com/variable.woff2) format("woff2-variations")'

function addFace(css) {
  const style = document.createElement('style')
  style.setAttribute('data-test-479', 'true')
  style.textContent = css
  document.head.appendChild(style)
  return style
}

function required(family, weight = '400', style = 'normal', stretchPct = 100) {
  return new Set([`${family}__${weight}__${style}__${stretchPct}`])
}

function usedCodepoints(text = 'A') {
  const s = new Set()
  for (const ch of text) s.add(ch.codePointAt(0))
  return s
}

/** Isolate the emitted @font-face block for one family. */
function faceFor(css, family) {
  const blocks = css.match(/@font-face[^{}]*\{[^}]*\}/gi) || []
  return blocks.find((b) => b.toLowerCase().includes(family.toLowerCase())) || ''
}

describe('#479 — variable font axes must not be pinned by invented descriptors', () => {
  beforeEach(() => {
    cache.resource?.clear?.()
    cache.font?.clear?.()
  })
  afterEach(() => {
    document.querySelectorAll('style[data-test-479]').forEach((el) => el.remove())
  })

  it('does not invent a font-weight when the source declared none', async () => {
    addFace(`@font-face{font-family:'VarNoRange';src:${SRC};}`)

    const css = await embedCustomFonts({
      required: required('VarNoRange', '900'),
      usedCodepoints: usedCodepoints('A'),
    })

    const face = faceFor(css, 'VarNoRange')
    expect(face).toBeTruthy()
    expect(face).not.toMatch(/font-weight/i)
    expect(face).not.toMatch(/font-stretch/i)
    expect(face).not.toMatch(/font-style/i)
  })

  it('preserves a declared weight range verbatim', async () => {
    addFace(`@font-face{font-family:'VarRange';src:${SRC};font-weight:100 900;}`)

    const css = await embedCustomFonts({
      required: required('VarRange', '900'),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(faceFor(css, 'VarRange')).toMatch(/font-weight:\s*100 900/i)
  })

  it('preserves declared stretch and style ranges', async () => {
    addFace(
      `@font-face{font-family:'VarFlex';src:${SRC};font-weight:100 900;font-stretch:10% 100%;font-style:oblique -10deg 0deg;}`
    )

    const css = await embedCustomFonts({
      required: required('VarFlex', '700', 'normal', 75),
      usedCodepoints: usedCodepoints('A'),
    })

    const face = faceFor(css, 'VarFlex')
    expect(face).toMatch(/font-weight:\s*100 900/i)
    expect(face).toMatch(/font-stretch:\s*10% 100%/i)
    expect(face).toMatch(/font-style:\s*oblique -10deg 0deg/i)
  })

  it('carries font-variation-settings through when the engine exposes it', async () => {
    const style = addFace(`@font-face{font-family:'VarSettings';src:${SRC};font-variation-settings:'slnt' -6;}`)

    // WebKit drops the descriptor from the @font-face rule entirely — it is absent from both
    // getPropertyValue and cssText, so there is nothing for the CSSOM pass to carry. (A
    // stylesheet loaded via <link> still keeps it: that path re-emits the block verbatim.)
    const exposed = [...style.sheet.cssRules].some(
      (r) => (r.style?.getPropertyValue('font-variation-settings') || '').trim()
    )

    const css = await embedCustomFonts({
      required: required('VarSettings'),
      usedCodepoints: usedCodepoints('A'),
    })

    const face = faceFor(css, 'VarSettings')
    expect(face).toMatch(/src:\s*url\(data:font/)
    if (exposed) {
      // the CSSOM normalises the axis tag to double quotes
      expect(face).toMatch(/font-variation-settings:\s*["']slnt["']\s*-6/i)
    }
  })

  it('still emits a usable src', async () => {
    addFace(`@font-face{font-family:'VarUsable';src:${SRC};}`)

    const css = await embedCustomFonts({
      required: required('VarUsable', '900'),
      usedCodepoints: usedCodepoints('A'),
    })

    expect(faceFor(css, 'VarUsable')).toMatch(/src:\s*url\(data:font/)
  })
})
