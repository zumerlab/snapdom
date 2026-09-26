// __tests__/module.fonts.issue508.test.js
// #508: "Dela Gothic One" never embedded. Its family name passed the icon-font check, but
// the file URL went through the same loose heuristic, whose `/icon/` matches
// `fonts.gstatic.com/s/delagothicone/` (goth-icon-e). The face kept its remote url(), which
// is inert inside a foreignObject, and the capture fell back to a serif.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const FACE_URL = 'https://fonts.gstatic.com/s/delagothicone/v19/hESp6XxvMDRA-2eD0lXpDa6QkBA2QkEIYgpLUQ.woff2'
const SHEET = 'https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap'
const SHEET_CSS = `@font-face{font-family:'Dela Gothic One';font-style:normal;font-weight:400;font-display:swap;src:url(${FACE_URL}) format('woff2');unicode-range:U+0000-00FF;}`
const B64 = 'data:font/woff2;base64,AA=='

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') return { ok: true, data: url === SHEET ? SHEET_CSS : '', status: 200, url, fromCache: false }
    return { ok: true, data: B64, status: 200, url, fromCache: false, mime: 'font/woff2' }
  }),
}))

import { embedCustomFonts } from '../src/modules/fonts.js'
import { isIconFont } from '../src/modules/iconFonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

beforeEach(() => {
  cache.font?.clear?.()
  cache.resource?.clear?.()
  vi.clearAllMocks()
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach((n) => n.remove())
})

describe('a text font whose file URL contains "icon" (#508)', () => {
  it('the precondition holds: the name is a text font, the URL reads as an icon font', () => {
    expect(isIconFont('Dela Gothic One')).toBe(false)
    expect(isIconFont(FACE_URL)).toBe(true)
  })

  it('embeds the face from a <link> as a data: URL', async () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = SHEET
    document.head.appendChild(link)

    const css = await embedCustomFonts({
      required: new Set(['Dela Gothic One__400__normal__100']),
      usedCodepoints: new Set([...'12345'].map((c) => c.codePointAt(0))),
    })

    expect(snapFetch).toHaveBeenCalledWith(FACE_URL, expect.objectContaining({ as: 'dataURL' }))
    expect(css).toContain('Dela Gothic One')
    expect(css).toContain(B64)
    expect(css).not.toContain(FACE_URL)
  })

  it('embeds the face from a same-document @font-face rule', async () => {
    const style = document.createElement('style')
    style.textContent = SHEET_CSS
    document.head.appendChild(style)

    const css = await embedCustomFonts({
      required: new Set(['Dela Gothic One__400__normal__100']),
      usedCodepoints: new Set([...'12345'].map((c) => c.codePointAt(0))),
    })

    expect(css).toContain(B64)
    expect(css).not.toContain(FACE_URL)
  })
})
