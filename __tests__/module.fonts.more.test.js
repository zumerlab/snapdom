// __tests__/module.fonts.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils/helpers', async () => {
  const actual = await vi.importActual('../src/utils/helpers')
  return {
    ...actual,
    // Keep real extractURL; only spy fetchResource
    extractURL: actual.extractURL,
    fetchResource: vi.fn(actual.fetchResource),
  }
})

// Important: never skip by icon font in these tests
vi.mock('../src/modules/iconFonts.js', () => ({
  isIconFont: vi.fn(() => false),
}))

import { embedCustomFonts, ensureFontsReady } from '../src/modules/fonts.js'
import * as helpers from '../src/utils/helpers'
import { cache } from '../src/core/cache.js'

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
  // hard reset caches and DOM noise
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

    const cssResponse = `
      @font-face {
        font-family: 'Unbounded';
        font-style: normal;
        font-weight: 400;
        font-stretch: 100%;
        unicode-range: U+000-5FF;
        src: url(https://fonts.gstatic.com/s/unbounded/v1/a.woff2) format('woff2');
      }
    `
    // 1st fetch -> CSS
    vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
      text: async () => cssResponse,
      blob: async () => new Blob(),
    })
    // 2nd fetch -> font resource -> valid blob -> FileReader -> data:
    vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
      blob: async () => new Blob(['abc'], { type: 'font/woff2' }),
      text: async () => '',
    })

    const css = await embedCustomFonts({
      required: req('Unbounded__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    expect(css).toMatch(/font-family:\s*['"]?Unbounded['"]?/)
    expect(css).toMatch(/url\(["']?data:/)
  })

  it('allows cross-origin by family token in URL (e.g., family=<name>) and inlines font blob', async () => {
  // Link cross-origin con token "family=…"
  const href = 'https://cdn.example.com/css?family=My+Fancy+Font'
  addLink(href)

  // Además, aseguramos la ruta CSSOM inyectando el mismo @font-face inline.
  addStyle(`@font-face{
    font-family:'My Fancy Font';
    font-style:normal;
    font-weight:400;
    font-stretch:100%;
    src:url(https://cdn.example.com/mff.woff2) format('woff2');
  }`)

  // 1ª llamada -> CSS (del <link>)
  vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
    text: async () =>
      `@font-face{font-family:'My Fancy Font';font-style:normal;font-weight:400;font-stretch:100%;src:url(https://cdn.example.com/mff.woff2)}`,
    blob: async () => new Blob(),
  })
  // 2ª llamada -> fuente en blob (si la ruta de linkNodes la usa)
  vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
    blob: async () => new Blob(['abc'], { type: 'font/woff2' }),
    text: async () => '',
  })

  const css = await embedCustomFonts({
    required: new Set(['My Fancy Font__400__normal__100']),
    usedCodepoints: new Set(['B'.codePointAt(0)]),
  })

  // Verificaciones robustas (no dependas del conteo exacto)
  expect(css).toMatch(/My Fancy Font/)
  expect(css).toMatch(/url\(["']?data:/)
  expect(helpers.fetchResource).toHaveBeenCalled() // al menos 1 llamada ocurrió
})

})

/* ----------------- Cache hits & fetch errors (CSSOM path, deterministic) ------------------ */
describe('embedCustomFonts - cache hits & fetch errors', () => {
  it('uses cache.resource for URL already in cache (no refetch)', async () => {
    // Inline CSS (no heuristics, stable in Browser Mode)
    addStyle(`@font-face{
      font-family:'Foo';
      font-style:normal;
      font-weight:400;
      font-stretch:100%;
      src:url(https://fonts.gstatic.com/foo.woff2) format('woff2');
    }`)

    // Pre-warm cache for that URL
    cache.resource.set('https://fonts.gstatic.com/foo.woff2', 'data:font/woff2;base64,AAA')

    const css = await embedCustomFonts({
      required: req('Foo__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    // Must inline from cache.resource, and NOT call fetchResource for the font
    expect(css).toMatch(/url\(["']?data:font\/woff2;base64,AAA/)
    // Still, embedCustomFonts may read document.styleSheets (no network)
    expect(helpers.fetchResource).not.toHaveBeenCalled()
  })

  it('warns and continues when fetchResource for a font URL fails', async () => {
  // Ruta CSSOM determinista (sin heurísticas de <link>)
  addStyle(`@font-face{
    font-family:'Bar';
    font-style:normal;
    font-weight:400;
    font-stretch:100%;
    src:url(https://fonts.gstatic.com/bar.woff2) format('woff2');
  }`)

  // Forzamos fallo en el fetch de la fuente
  vi.mocked(helpers.fetchResource).mockRejectedValueOnce(new Error('network'))

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const css = await embedCustomFonts({
    required: new Set(['Bar__400__normal__100']),
    usedCodepoints: new Set(['C'.codePointAt(0)]),
  })

  // Aseguramos que realmente intentó y logueó el warning
  expect(helpers.fetchResource).toHaveBeenCalled()
  expect(warn).toHaveBeenCalled()
  expect(typeof css).toBe('string')

  warn.mockRestore()
})

})


describe('embedCustomFonts - @import injection & dedupe', () => {
  it('injects <link rel="stylesheet"> for @import urls and does not duplicate', async () => {
    const imported = 'https://fonts.googleapis.com/css2?family=Inter:wght@400'
    // style with @import (no <link> yet)
    addStyle(`@import url("${imported}");`)

    // fetch for the imported CSS → contains a single face
    vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
      text: async () =>
        `@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-stretch:100%;src:url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2');}`,
      blob: async () => new Blob(),
    })
    // fetch for the font URL → Blob -> data:
    vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
      blob: async () => new Blob(['a'], { type: 'font/woff2' }),
      text: async () => '',
    })

    const css = await embedCustomFonts({
      required: req('Inter__400__normal__100'),
      usedCodepoints: cps('A'),
    })

    // A <link> was injected (and only once), marked by data-snapdom
    const links = [...document.querySelectorAll(`link[rel="stylesheet"][href="${imported}"]`)]
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('data-snapdom')).toBe('injected-import')

    // Inlined to data:
    expect(css).toMatch(/font-family:\s*['"]?Inter['"]?/)
    expect(css).toMatch(/url\(["']?data:/)

    // Dedup check: if we provide duplicate faces, finalCSS should contain a single @font-face
    // (simulate by calling again with the exact same inputs so cache/resource + dedupe apply)
    const css2 = await embedCustomFonts({
      required: req('Inter__400__normal__100'),
      usedCodepoints: cps('A'),
    })
    const facesCount = (css2.match(/@font-face/g) || []).length
    expect(facesCount).toBe(1)
  })
})

describe('embedCustomFonts - relative URL inlining', () => {
  it('inlines relative url(...) using base from location.href', async () => {
    // relative URL in src — helpers.fetchResource should see the absolute URL
    addStyle(`@font-face{
      font-family:'RelFace';
      font-style:normal;font-weight:400;font-stretch:100%;
      src:url(./rel.woff2) format('woff2');
    }`)

    // capture the exact URL passed into fetchResource
    let seenUrl = ''
    vi.mocked(helpers.fetchResource).mockImplementation(async (url) => {
      seenUrl = String(url)
      return {
        blob: async () => new Blob(['aa'], { type: 'font/woff2' }),
        text: async () => '',
      }
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

describe('embedCustomFonts - nearest weight fallback & ranges', () => {
  it('selects face 400 when required 700 (nearest fallback)', async () => {
    // Face only declares 400; req asks for 700 → accept nearest (<= 300 difference)
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
    // weight range 100..700 and stretch 75%..125% should match required 500 / 100%
    addStyle(`@font-face{
      font-family:'Ranges';
      font-style:normal;font-weight:100 700;font-stretch:75% 125%;
      src:url(data:font/woff2;base64,QQ==) format('woff2');
      unicode-range: U+000-5FF;
    }`)
    const css = await embedCustomFonts({
      required: req('Ranges__500__normal__100'),
      usedCodepoints: cps('Z'), // intersects U+000-5FF
    })
    expect(css).toMatch(/font-family:\s*['"]?Ranges['"]?/)
    expect(css).toMatch(/font-weight:\s*100 700|font-weight:\s*100\s+700/i)
  })
})

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
      exclude: { families: ['excluded'] }, // case-insensitive
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
    // unicode-range → cyrillic
    addStyle(`@font-face{
      font-family:'Subsets';
      font-weight:400;font-style:normal;font-stretch:100%;
      unicode-range: U+0400-04FF;
      src:url(data:font/woff2;base64,AA==);
    }`)
    const css = await embedCustomFonts({
      required: req('Subsets__400__normal__100'),
      usedCodepoints: new Set([0x0410]), // 'А' cyrillic → intersects
      exclude: { subsets: ['cyrillic'] },
    })
    expect(css).not.toMatch(/Subsets/)
  })
})

describe('embedCustomFonts - cache key hit', () => {
  it('returns cached CSS on second identical call (no extra fetch)', async () => {
    addStyle(`@font-face{
      font-family:'CacheFace';
      font-weight:400;font-style:normal;font-stretch:100%;
      src:url(https://cdn.example.com/cache.woff2) format('woff2');
    }`)

    // first call → one fetch for the font
    vi.mocked(helpers.fetchResource).mockResolvedValueOnce({
      blob: async () => new Blob(['abc'], { type: 'font/woff2' }),
      text: async () => '',
    })

    const opts = {
      required: req('CacheFace__400__normal__100'),
      usedCodepoints: cps('A'),
    }

    const css1 = await embedCustomFonts(opts)
    expect(css1).toMatch(/url\(["']?data:/)
    expect(helpers.fetchResource).toHaveBeenCalledTimes(1)

    // second call with IDENTICAL inputs → short-circuit from cache.resource (no new fetch)
    vi.mocked(helpers.fetchResource).mockClear()
    const css2 = await embedCustomFonts(opts)
    expect(css2).toBe(css1)
    expect(helpers.fetchResource).not.toHaveBeenCalled()
  })
})

describe('ensureFontsReady (smoke)', () => {
  it('awaits fonts.ready and cleans up warmup container', async () => {
    // Minimal compatible `document.fonts`
    const items = []
    const fakeSet = {
      [Symbol.iterator]: function* () { yield* items },
      ready: Promise.resolve(),
      add(ff) { items.push(ff) }
    }
    Object.defineProperty(document, 'fonts', { configurable: true, get: () => fakeSet })

    // Make RAF immediate (double-RAF inside ensureFontsReady)
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now())
      return 1
    })

    // Should not throw and should remove the container it creates
    await ensureFontsReady(['WarmupFam'], 1)
    // The container is appended and removed in the same tick; asserting no leftovers:
    expect(document.querySelector('[data-warmup]')).toBeFalsy()

    raf.mockRestore()
    // cleanup `document.fonts`
    delete document.fonts
  })
})

