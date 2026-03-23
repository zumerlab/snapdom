// __tests__/module.fonts.more.more.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ====== Mocks HOISTED-SAFE ======
// helpers: dejamos extractURL real si querés, pero acá no dependemos de fetchResource.
vi.mock('../src/utils/helpers', async () => {
  const actual = await vi.importActual('../src/utils/helpers')
  return {
    ...actual,
    extractURL: actual.extractURL ?? ((cssUrlFn) => {
      const m = String(cssUrlFn).match(/url\((["']?)([^"')]+)\1\)/i)
      return m ? m[2] : ''
    }),
    fetchResource: vi.fn(async () => ({
      async blob () { return new Blob([new Uint8Array([0x77, 0x6F, 0x32])], { type: 'font/woff2' }) },
      async text () { return '' }
    })),
  }
})

// iconFonts siempre falso para no excluir
vi.mock('../src/modules/iconFonts.js', () => ({
  isIconFont: vi.fn(() => false),
}))

// 🔴 Nuevo: mock de snapFetch (API no-throw)
vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') {
      return { ok: true, data: '', status: 200, url, fromCache: false }
    }
    // default: devolvemos una dataURL mínima de woff2
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

// ====== SUT + deps ======
import { embedCustomFonts, collectUsedFontVariants } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import * as helpers from '../src/utils/helpers'
import { snapFetch } from '../src/modules/snapFetch.js'

// ====== utilidades locales ======
function addStyle (css) {
  const s = document.createElement('style')
  s.setAttribute('data-test', 'fonts-extra')
  s.textContent = css
  document.head.appendChild(s)
  return s
}
function cleanInjectedStuff () {
  document.querySelectorAll('link[rel="stylesheet"]').forEach(n => n.remove())
  document.querySelectorAll('link[data-snapdom="injected-import"]').forEach(n => n.remove())
  document.querySelectorAll('style[data-test="fonts-extra"]').forEach(n => n.remove())
  // Limpia styles con @import colgados de otras suites
  document.querySelectorAll('style').forEach(n => {
    if ((n.textContent || '').includes('@import')) n.remove()
  })
}

/** Mock mínimo de document.fonts */
function setDocumentFonts (fontsArray = []) {
  const items = [...fontsArray]
  const iter = function * () { yield * items }
  const fakeSet = {
    [Symbol.iterator]: iter,
    values: iter,
    entries: function * () { for (const it of items) yield [it.family, it] },
    forEach (cb, thisArg) { for (const it of items) cb.call(thisArg, it, it, fakeSet) },
    has (ff) { return items.includes(ff) },
    add (ff) { items.push(ff) },
    delete (ff) { const i = items.indexOf(ff); if (i >= 0) items.splice(i, 1) },
    clear () { items.length = 0 },
    ready: Promise.resolve(),
    size: items.length
  }
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    get () { return fakeSet },
    set () {}
  })
  return () => { delete document.fonts }
}

let restoreFonts = () => {}

// ====== setup/teardown ======
beforeEach(() => {
  vi.restoreAllMocks()

  // helpers mocks ya están instalados; limpiamos counters
  helpers.fetchResource?.mockClear?.()

  // limpiar caches y DOM
  try { cache.resource?.clear?.() } catch {}
  try { cache.font?.clear?.() } catch {}
  cleanInjectedStuff()

  // document.fonts vacío por default
  restoreFonts?.()
  restoreFonts = setDocumentFonts([])

  // reset de snapFetch mock por si algún test setea respuestas específicas
  vi.mocked(snapFetch).mockImplementation(async (url, opts = {}) => {
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
  })
})

afterEach(() => {
  restoreFonts?.()
  cleanInjectedStuff()
})

/* ----------------- unicode-range & helpers ------------------ */
describe('embedCustomFonts – unicode-range & helpers', () => {
  it('incluye la face cuando usedCodepoints intersecta el unicode-range', async () => {
    const url = 'https://cdn.example.com/cyr.woff2'
    addStyle(`
      @font-face {
        font-family: 'CyrillicOnly';
        font-style: normal;
        font-weight: 400;
        font-stretch: 100%;
        unicode-range: U+0400-04FF;
        src: url(${url}) format('woff2');
      }`)

    // asegurar que el fetch de la fuente devuelva una dataURL conocida
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true, data: 'data:font/woff2;base64,CCC=', status: 200, url, fromCache: false, mime: 'font/woff2'
    })

    const css = await embedCustomFonts({
      required: new Set(['CyrillicOnly__400__normal__100']),
      usedCodepoints: new Set([0x0410]) // 'А' cirílica ⇒ intersecta
    })

    expect(css).toMatch(/font-family:\s*['"]?CyrillicOnly['"]?/)
    expect(css).toMatch(/url\(["']?data:/)
  })
})

/* ----------------- cache.resource short-circuit ------------------ */
describe('embedCustomFonts – cache.resource short-circuit', () => {
  it('usa cache.resource para inlining y evita snapFetch', async () => {
    const fontUrl = 'https://cdn.example.com/foo.woff2'
    const b64 = 'data:font/woff2;base64,AAA'
    cache.resource.set(fontUrl, b64)

    addStyle(`
      @font-face {
        font-family: 'Foo';
        font-style: normal;
        font-weight: 400;
        font-stretch: 100%;
        src: url(${fontUrl}) format('woff2');
      }`)

    const css = await embedCustomFonts({
      required: new Set(['Foo__400__normal__100']),
      usedCodepoints: new Set([0x41])
    })

    expect(css).toMatch(/font-family:\s*['"]?Foo['"]?/)
    expect(css).toMatch(/url\(["']?data:font\/woff2;base64,AAA/)
    expect(snapFetch).not.toHaveBeenCalled()
  })
})

/* ----------------- document.fonts con _snapdomSrc ------------------ */
describe('document.fonts con _snapdomSrc', () => {
  it('descarga _snapdomSrc (no data:) y lo inyecta como @font-face', async () => {
    // simular un font cargado dinámico
    restoreFonts?.()
    restoreFonts = setDocumentFonts([
      { family: 'DynFont', status: 'loaded', style: 'normal', weight: '400', _snapdomSrc: 'https://cdn.example.com/dyn.woff2' }
    ])

    // se espera 1 fetch → dataURL
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true, data: 'data:font/woff2;base64,DYN=', status: 200,
      url: 'https://cdn.example.com/dyn.woff2', fromCache: false, mime: 'font/woff2'
    })

    const css = await embedCustomFonts({
      required: new Set(['DynFont__400__normal__100']),
      usedCodepoints: new Set([0x41])
    })

    expect(css).toMatch(/font-family:\s*['"]?DynFont['"]?/)
    expect(css).toMatch(/url\(["']?data:/)
    expect(snapFetch).toHaveBeenCalledTimes(1)
  })

  it('si _snapdomSrc ya es data:, no hace fetch', async () => {
    restoreFonts?.()
    restoreFonts = setDocumentFonts([
      { family: 'DynData', status: 'loaded', style: 'normal', weight: '400', _snapdomSrc: 'data:font/woff2;base64,ZZ==' }
    ])

    const css = await embedCustomFonts({
      required: new Set(['DynData__400__normal__100']),
      usedCodepoints: new Set([0x41])
    })

    expect(css).toMatch(/DynData/)
    expect(css).toMatch(/url\(['"]?data:/)
    expect(snapFetch).not.toHaveBeenCalled()
  })

  it('si snapFetch devuelve ok:false, continúa sin romper', async () => {
    restoreFonts?.()
    restoreFonts = setDocumentFonts([
      { family: 'DynFail', status: 'loaded', style: 'normal', weight: '400', _snapdomSrc: 'https://cdn.example.com/fail.woff2' }
    ])

    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: false, data: null, status: 0, url: 'https://cdn.example.com/fail.woff2', fromCache: false, reason: 'network'
    })

    const css = await embedCustomFonts({
      required: new Set(['DynFail__400__normal__100']),
      usedCodepoints: new Set([0x41])
    })

    // Puede no incluir DynFail si no pudo inlinear — lo importante es que no explote y sea string.
    expect(typeof css).toBe('string')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #357 — collectUsedFontVariants must register ALL fallback families, not only
//         the first non-generic one (pickAllFamilies instead of pickPrimaryFamily)
// ─────────────────────────────────────────────────────────────────────────────
describe('collectUsedFontVariants – full fallback chain (#357)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('registers keys for every non-generic family in font-family list', () => {
    const el = document.createElement('div')
    el.style.fontFamily = '"PrimaryFont", "FallbackFont", sans-serif'
    document.body.appendChild(el)

    const variants = collectUsedFontVariants(el)
    const families = new Set([...variants].map(k => String(k).split('__')[0]))

    expect(families.has('PrimaryFont')).toBe(true)
    expect(families.has('FallbackFont')).toBe(true)
    // Generic families must be excluded
    expect(families.has('sans-serif')).toBe(false)
  })

  it('handles a single non-generic family correctly', () => {
    const el = document.createElement('div')
    el.style.fontFamily = '"OnlyFont", serif'
    document.body.appendChild(el)

    const variants = collectUsedFontVariants(el)
    const families = new Set([...variants].map(k => String(k).split('__')[0]))

    expect(families.has('OnlyFont')).toBe(true)
    expect(families.has('serif')).toBe(false)
  })

  it('collects variants from nested elements too', () => {
    const parent = document.createElement('div')
    parent.style.fontFamily = '"ParentFont", sans-serif'
    const child = document.createElement('span')
    child.style.fontFamily = '"ChildFont", monospace'
    parent.appendChild(child)
    document.body.appendChild(parent)

    const variants = collectUsedFontVariants(parent)
    const families = new Set([...variants].map(k => String(k).split('__')[0]))

    expect(families.has('ParentFont')).toBe(true)
    expect(families.has('ChildFont')).toBe(true)
  })
})
