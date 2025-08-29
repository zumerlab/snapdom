// __tests__/module.fonts.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mocks
 * - helpers: mantenemos extractURL real; fetchResource queda spied pero ya no lo usa fonts.js
 * - iconFonts: forzado a false (no excluir)
 * - snapFetch: API nueva (no-throw) → devolvemos {ok,data,...}
 */
vi.mock('../src/utils/helpers', async () => {
  const actual = await vi.importActual('../src/utils/helpers')
  return {
    ...actual,
    extractURL: actual.extractURL,
    fetchResource: vi.fn(actual.fetchResource),
  }
})

vi.mock('../src/modules/iconFonts.js', () => ({
  isIconFont: vi.fn(() => false),
}))

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') {
      return { ok: true, data: '', status: 200, url, fromCache: false }
    }
    return {
      ok: true,
      data: 'data:font/woff2;base64,AA==',
      status: 200,
      url,
      fromCache: false,
      mime: 'font/woff2',
    }
  }),
}))

import { embedCustomFonts, ensureFontsReady } from '../src/modules/fonts.js'
import * as helpers from '../src/utils/helpers'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

/* ----------------- helpers dom & utils ------------------ */
function addLink(href) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
  return link
}
function addStyle(css) {
  const s = document.createElement('style')
  s.textContent = css
  document.head.appendChild(s)
  return s
}
const req = (...keys) => new Set(keys)
const cps = (t) => new Set([...t].map(ch => ch.codePointAt(0)))

beforeEach(() => {
  if (typeof cache.reset === 'function') cache.reset()
  if (typeof cache.resetCache === 'function') cache.resetCache()
  cache.font?.clear?.()
  cache.resource?.clear?.()
  vi.clearAllMocks()
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n => n.remove())
})

/* ----------------- External links & heuristics ------------------ */
describe('embedCustomFonts - external links & heuristics', () => {
  it('fetches cross-origin Google Fonts link and inlines @font-face', async () => {
    const href = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@400'
    addLink(href)

    // 1) CSS del <link>
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: `
        @font-face {
          font-family: 'Unbounded';
          font-style: normal;
          font-weight: 400;
          font-stretch: 100%;
          unicode-range: U+000-5FF;
          src: url(https://fonts.gstatic.com/s/unbounded/v1/a.woff2) format('woff2');
        }
      `,
      status: 200,
      url: href,
      fromCache: false,
    })
    // 2) Blob → DataURL
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: 'data:font/woff2;base64,ABC=',
      status: 200,
      url: 'https://fonts.gstatic.com/s/unbounded/v1/a.woff2',
      fromCache: false,
      mime: 'font/woff2',
    })

    const css = await embedCustomFonts({
      required: req('Unbounded__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    expect(css).toMatch(/font-family:\s*['"]?Unbounded['"]?/)
    expect(css).toMatch(/url\(["']?data:/)
    expect(snapFetch).toHaveBeenCalledTimes(2)
  })

  it('allows cross-origin by family token in URL (e.g., family=<name>) and inlines font blob', async () => {
    const href = 'https://cdn.example.com/css?family=My+Fancy+Font'
    addLink(href)

    addStyle(`@font-face{
      font-family:'My Fancy Font';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(https://cdn.example.com/mff.woff2) format('woff2');
    }`)

    // 1) CSS del <link>
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: `@font-face{font-family:'My Fancy Font';font-style:normal;font-weight:400;font-stretch:100%;src:url(https://cdn.example.com/mff.woff2) format('woff2');}`,
      status: 200,
      url: href,
      fromCache: false,
    })
    // 2) Fuente → DataURL
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: 'data:font/woff2;base64,ABC=',
      status: 200,
      url: 'https://cdn.example.com/mff.woff2',
      fromCache: false,
      mime: 'font/woff2',
    })

    const css = await embedCustomFonts({
      required: new Set(['My Fancy Font__400__normal__100']),
      usedCodepoints: new Set(['B'.codePointAt(0)]),
    })

    expect(css).toMatch(/My Fancy Font/)
    expect(css).toMatch(/url\(["']?data:/)
    expect(snapFetch).toHaveBeenCalledTimes(2)
  })
})

/* ----------------- Cache hits & fetch errors (CSSOM path, deterministic) ------------------ */
describe('embedCustomFonts - cache hits & fetch errors', () => {
  it('uses cache.resource for URL already in cache (no refetch)', async () => {
    addStyle(`@font-face{
      font-family:'Foo';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(https://fonts.gstatic.com/foo.woff2) format('woff2');
    }`)

    cache.resource.set('https://fonts.gstatic.com/foo.woff2', 'data:font/woff2;base64,AAA')

    const css = await embedCustomFonts({
      required: req('Foo__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    expect(css).toMatch(/url\(["']?data:font\/woff2;base64,AAA/)
    expect(snapFetch).not.toHaveBeenCalled()
  })

  it('continues when font fetch fails (ok:false)', async () => {
    addStyle(`@font-face{
      font-family:'Bar';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(https://fonts.gstatic.com/bar.woff2) format('woff2');
    }`)

    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: false, data: null, status: 0,
      url: 'https://fonts.gstatic.com/bar.woff2',
      fromCache: false, reason: 'network'
    })

    const css = await embedCustomFonts({
      required: new Set(['Bar__400__normal__100']),
      usedCodepoints: new Set(['C'.codePointAt(0)]),
    })

    expect(typeof css).toBe('string')
    expect(snapFetch).toHaveBeenCalled()
  })
})

/* ----------------- @import injection & dedupe ------------------ */
describe('embedCustomFonts - @import injection & dedupe', () => {
  it('injects <link rel="stylesheet"> for @import urls and does not duplicate', async () => {
    const imported = 'https://fonts.googleapis.com/css2?family=Inter:wght@400'
    addStyle(`@import url("${imported}");`)

    // 1) CSS importado
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: `@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-stretch:100%;src:url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2');}`,
      status: 200,
      url: imported,
      fromCache: false,
    })
    // 2) Fuente → DataURL
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: 'data:font/woff2;base64,QQ==',
      status: 200,
      url: 'https://fonts.gstatic.com/s/inter/v1/a.woff2',
      fromCache: false,
      mime: 'font/woff2',
    })

    const css = await embedCustomFonts({
      required: req('Inter__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    const links = [...document.querySelectorAll(`link[rel="stylesheet"][href="${imported}"]`)]
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('data-snapdom')).toBe('injected-import')

    expect(css).toMatch(/font-family:\s*['"]?Inter['"]?/)
    expect(css).toMatch(/url\(["']?data:/)

    // dedupe: segunda llamada no duplica faces
    const css2 = await embedCustomFonts({
      required: req('Inter__400__normal__100'),
      usedCodepoints: cps('A'),
    })
    const facesCount = (css2.match(/@font-face/g) || []).length
    expect(facesCount).toBe(1)
  })
})

/* ----------------- Relative URL inlining ------------------ */
describe('embedCustomFonts - relative URL inlining', () => {
  it('inlines relative url(...) using base from location.href', async () => {
    addStyle(`@font-face{
      font-family:'RelFace';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(./rel.woff2) format('woff2');
    }`)

    let seenUrl = ''
    vi.mocked(snapFetch).mockImplementation(async (url, opts = {}) => {
      if (opts.as === 'text') {
        return { ok: true, data: '', status: 200, url, fromCache: false }
      }
      seenUrl = String(url)
      return { ok: true, data: 'data:font/woff2;base64,QQ==', status: 200, url, fromCache: false, mime: 'font/woff2' }
    })

    const css = await embedCustomFonts({
      required: req('RelFace__400__normal__100'),
      usedCodepoints: cps('B'),
    })

    expect(seenUrl).toContain(new URL('./rel.woff2', location.href).href)
    expect(css).toMatch(/RelFace/)
    expect(css).toMatch(/url\(["']?data:/)
  })
})

/* ----------------- Weight fallback & ranges ------------------ */
describe('embedCustomFonts - nearest weight fallback & ranges', () => {
  it('selects face 400 when required 700 (nearest fallback)', async () => {
    addStyle(`@font-face{
      font-family:'Nearest';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(data:font/woff2;base64,AA==) format('woff2');
    }`)

    const css = await embedCustomFonts({
      required: req('Nearest__700__normal__100'),
      usedCodepoints: cps('A'),
    })
    expect(css).toMatch(/font-family:\s*['"]?Nearest['"]?/)
    expect(css).toMatch(/font-weight:\s*400/)
  })

  it('accepts faces that declare weight and stretch ranges', async () => {
    addStyle(`@font-face{
      font-family:'Ranges';
      font-style:normal;font-weight:100 700;font-stretch:75% 125%;
      src:url(data:font/woff2;base64,QQ==) format('woff2');
      unicode-range: U+000-5FF;
    }`)
    const css = await embedCustomFonts({
      required: req('Ranges__500__normal__100'),
      usedCodepoints: cps('Z'),
    })
    expect(css).toMatch(/font-family:\s*['"]?Ranges['"]?/)
    expect(css).toMatch(/font-weight:\s*100 700|font-weight:\s*100\s+700/i)
  })
})

/* ----------------- Exclude knobs ------------------ */
describe('embedCustomFonts - exclude by families/domains/subsets', () => {
  it('excludes by family name', async () => {
    addStyle(`@font-face{
      font-family:'Excluded';
      font-weight:400;font-style:normal;font-stretch:100%;
      src:url(data:font/woff2;base64,AA==);
    }`)
    const css = await embedCustomFonts({
      required: req('Excluded__400__normal__100'),
      usedCodepoints: cps('A'),
      exclude: { families: ['excluded'] },
    })
    expect(css).not.toMatch(/Excluded/)
  })

  it('excludes by domain host', async () => {
    addStyle(`@font-face{
      font-family:'DomainFace';
      font-weight:400;font-style:normal;font-stretch:100%;
      src:url(https://blocked.example.org/font.woff2) format('woff2');
    }`)
    const css = await embedCustomFonts({
      required: req('DomainFace__400__normal__100'),
      usedCodepoints: cps('B'),
      exclude: { domains: ['blocked.example.org'] },
    })
    expect(css).not.toMatch(/DomainFace/)
  })

  it('excludes by subset detection from unicode-range (e.g., cyrillic)', async () => {
    addStyle(`@font-face{
      font-family:'Subsets';
      font-weight:400;font-style:normal;font-stretch:100%;
      unicode-range: U+0400-04FF;
      src:url(data:font/woff2;base64,AA==);
    }`)
    const css = await embedCustomFonts({
      required: req('Subsets__400__normal__100'),
      usedCodepoints: new Set([0x0410]), // 'А'
      exclude: { subsets: ['cyrillic'] },
    })
    expect(css).not.toMatch(/Subsets/)
  })
})

/* ----------------- Cache key hit ------------------ */
describe('embedCustomFonts - cache key hit', () => {
  it('returns cached CSS on second identical call (no extra fetch)', async () => {
    addStyle(`@font-face{
      font-family:'CacheFace';
      font-weight:400;font-style:normal;font-stretch:100%;
      src:url(https://cdn.example.com/cache.woff2) format('woff2');
    }`)

    // Primera llamada: 1 fetch (dataURL)
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: 'data:font/woff2;base64,ABC=',
      status: 200,
      url: 'https://cdn.example.com/cache.woff2',
      fromCache: false,
      mime: 'font/woff2',
    })

    const opts = {
      required: req('CacheFace__400__normal__100'),
      usedCodepoints: cps('A'),
    }

    const css1 = await embedCustomFonts(opts)
    expect(css1).toMatch(/url\(["']?data:/)
    expect(snapFetch).toHaveBeenCalledTimes(1)

    // Segunda llamada idéntica → sale del cache.resource por cacheKey
    vi.mocked(snapFetch).mockClear()
    const css2 = await embedCustomFonts(opts)
    expect(css2).toBe(css1)
    expect(snapFetch).not.toHaveBeenCalled()
  })
})

/* ----------------- ensureFontsReady (smoke) ------------------ */
describe('ensureFontsReady (smoke)', () => {
  it('awaits fonts.ready and cleans up warmup container', async () => {
    const items = []
    const fakeSet = {
      [Symbol.iterator]: function* () { yield* items },
      ready: Promise.resolve(),
      add(ff) { items.push(ff) }
    }
    Object.defineProperty(document, 'fonts', { configurable: true, get: () => fakeSet })

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now())
      return 1
    })

    await ensureFontsReady(['WarmupFam'], 1)
    expect(document.querySelector('[data-warmup]')).toBeFalsy()

    raf.mockRestore()
    delete document.fonts
  })
})
