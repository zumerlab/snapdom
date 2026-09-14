// __tests__/module.fonts.issue493.test.js
// #493: a Google Fonts request that lists `Noto+Sans+Symbols` next to text families was
// discarded wholesale by the icon-font URL heuristic (`/symbols/i` over the whole href), so
// embedFonts: true embedded nothing and the capture fell back to system fonts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') return { ok: true, data: '', status: 200, url, fromCache: false }
    return { ok: true, data: 'data:font/woff2;base64,AA==', status: 200, url, fromCache: false, mime: 'font/woff2' }
  }),
}))

import { embedCustomFonts } from '../src/modules/fonts.js'
import { isIconFont, isIconFontStylesheet, compileIconFontMatchers } from '../src/modules/iconFonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

const MIXED = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&family=Noto+Sans+Symbols:wght@100..900&family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap'
const ICONS_ONLY = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
const MIXED_CSS = `
@font-face{font-family:'Noto Sans SC';font-style:normal;font-weight:100 900;font-display:swap;src:url(https://fonts.gstatic.com/s/notosanssc/v40/sc.4.woff2) format('woff2');unicode-range:U+4e2d,U+4f53,U+6587,U+7b80;}
@font-face{font-family:'Noto Sans Symbols';font-style:normal;font-weight:100 900;font-display:swap;src:url(https://fonts.gstatic.com/s/notosanssymbols/v40/sym.woff2) format('woff2');unicode-range:U+2190-21ff;}
@font-face{font-family:'Noto Sans';font-style:normal;font-weight:100 900;font-display:swap;src:url(https://fonts.gstatic.com/s/notosans/v40/ns.woff2) format('woff2');unicode-range:U+0000-00ff;}
`

function addLink(href) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
  return link
}
const req = (...keys) => new Set(keys)
const cps = (t) => new Set([...t].map((ch) => ch.codePointAt(0)))

beforeEach(() => {
  if (typeof cache.reset === 'function') cache.reset()
  if (typeof cache.resetCache === 'function') cache.resetCache()
  cache.font?.clear?.()
  cache.resource?.clear?.()
  vi.clearAllMocks()
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach((n) => n.remove())
})

describe('isIconFontStylesheet (#493)', () => {
  it('judges the families of a Google Fonts request one by one, not the whole URL', () => {
    expect(isIconFont(MIXED)).toBe(true) // the old check: one icon-ish name poisons the href
    expect(isIconFontStylesheet(MIXED)).toBe(false)
  })

  it('still skips requests that hold nothing but icon fonts', () => {
    expect(isIconFontStylesheet(ICONS_ONLY)).toBe(true)
    expect(isIconFontStylesheet('https://fonts.googleapis.com/icon?family=Material+Icons')).toBe(true)
    // legacy css?family=A|B syntax
    expect(isIconFontStylesheet('https://fonts.googleapis.com/css?family=Material+Icons|Material+Icons+Outlined')).toBe(true)
    expect(isIconFontStylesheet('https://fonts.googleapis.com/css?family=Roboto|Material+Icons')).toBe(false)
  })

  it('keeps the path heuristic for URLs without family params', () => {
    expect(isIconFontStylesheet('https://cdn.example.com/icons/style.css')).toBe(true)
    expect(isIconFontStylesheet('https://cdn.example.com/fonts/text.css')).toBe(false)
    expect(isIconFontStylesheet('')).toBe(false)
  })

  it('honours the per-capture iconFonts matchers for each family', () => {
    const matchers = compileIconFontMatchers(['Roboto'])
    const url = 'https://fonts.googleapis.com/css?family=Roboto|Material+Icons'
    expect(isIconFontStylesheet(url)).toBe(false)
    expect(isIconFontStylesheet(url, matchers)).toBe(true)
  })
})

describe('embedCustomFonts with a mixed Google Fonts request (#493)', () => {
  it('embeds the text families and only drops the icon-like one', async () => {
    addLink(MIXED)
    vi.mocked(snapFetch).mockImplementation(async (url, opts = {}) => {
      if (opts.as === 'text') return { ok: true, data: url === MIXED ? MIXED_CSS : '', status: 200, url, fromCache: false }
      return { ok: true, data: 'data:font/woff2;base64,AA==', status: 200, url, fromCache: false, mime: 'font/woff2' }
    })

    const css = await embedCustomFonts({
      required: req('Noto Sans SC__400__normal__100', 'Noto Sans__400__normal__100'),
      usedCodepoints: cps('简体中文 English'),
    })

    expect(snapFetch).toHaveBeenCalledWith(MIXED, expect.objectContaining({ as: 'text' }))
    expect(css).toMatch(/font-family:\s*['"]?Noto Sans SC['"]?/)
    expect(css).toMatch(/font-family:\s*['"]?Noto Sans['"]?\s*;/)
    expect(css).not.toMatch(/Noto Sans Symbols/)
    expect(css).toMatch(/url\(["']?data:/)
  })

  it('does not fetch a request that only holds icon fonts', async () => {
    addLink(ICONS_ONLY)
    const css = await embedCustomFonts({
      required: req('Material Symbols Outlined__400__normal__100'),
      usedCodepoints: cps('home'),
    })
    expect(css).toBe('')
    expect(snapFetch).not.toHaveBeenCalledWith(ICONS_ONLY, expect.anything())
  })
})
