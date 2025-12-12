// __tests__/module.fonts.katex.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Test for issue #344: KaTeX font embedding with dynamically injected stylesheets
 * Validates that the isLikelyFontStylesheet function recognizes KaTeX CDN URLs
 */

vi.mock('../src/utils/helpers', async () => {
  const actual = await vi.importActual('../src/utils/helpers')
  return {
    ...actual,
    extractURL: actual.extractURL,
    fetchResource: vi.fn(actual.fetchResource)
  }
})

vi.mock('../src/modules/iconFonts.js', () => ({
  isIconFont: vi.fn(() => false)
}))

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') {
      // Return minimal KaTeX CSS with @font-face
      return {
        ok: true,
        data: `
          @font-face {
            font-family: 'KaTeX_Main';
            font-style: normal;
            font-weight: 400;
            src: url(fonts/KaTeX_Main-Regular.woff2) format('woff2');
          }
        `,
        status: 200,
        url,
        fromCache: false
      }
    }
    return {
      ok: true,
      data: 'data:font/woff2;base64,AA==',
      status: 200,
      url,
      fromCache: false,
      mime: 'font/woff2'
    }
  })
}))

import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

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

describe('embedCustomFonts - KaTeX CDN support (issue #344)', () => {
  it('recognizes and processes KaTeX CSS from registry.npmmirror.com', async () => {
    const href = 'https://registry.npmmirror.com/katex/0.16.25/files/dist/katex.min.css'
    addLink(href)

    const required = req('KaTeX_Main__400__normal__100')
    const usedCodepoints = cps('abc123')

    const result = await embedCustomFonts({
      required,
      usedCodepoints
    })

    // Should have called snapFetch to fetch the stylesheet
    expect(snapFetch).toHaveBeenCalledWith(href, expect.objectContaining({ as: 'text' }))

    // Should include the font-face in the result
    expect(result).toContain('@font-face')
    expect(result).toContain('KaTeX_Main')
  })

  it('recognizes KaTeX CSS from unpkg.com', async () => {
    const href = 'https://unpkg.com/katex@0.16.8/dist/katex.min.css'
    addLink(href)

    const required = req('KaTeX_Main__400__normal__100')
    const usedCodepoints = cps('abc123')

    const result = await embedCustomFonts({
      required,
      usedCodepoints
    })

    expect(snapFetch).toHaveBeenCalledWith(href, expect.objectContaining({ as: 'text' }))
    expect(result).toContain('@font-face')
  })

  it('recognizes KaTeX CSS from cdn.jsdelivr.net', async () => {
    const href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css'
    addLink(href)

    const required = req('KaTeX_Main__400__normal__100')
    const usedCodepoints = cps('abc123')

    const result = await embedCustomFonts({
      required,
      usedCodepoints
    })

    expect(snapFetch).toHaveBeenCalledWith(href, expect.objectContaining({ as: 'text' }))
    expect(result).toContain('@font-face')
  })

  it('recognizes MathJax CSS from CDN', async () => {
    const href = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2/mathjax.css'
    addLink(href)

    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: `
        @font-face {
          font-family: 'MJX';
          src: url(MathJax_Main.woff2) format('woff2');
        }
      `,
      status: 200,
      url: href,
      fromCache: false
    })

    const required = req('MJX__400__normal__100')
    const usedCodepoints = cps('abc123')

    const result = await embedCustomFonts({
      required,
      usedCodepoints
    })

    expect(snapFetch).toHaveBeenCalledWith(href, expect.objectContaining({ as: 'text' }))
    expect(result).toContain('@font-face')
  })
})
