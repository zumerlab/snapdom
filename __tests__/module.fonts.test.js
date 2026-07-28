import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(),
}))

// === helpers locales ===
function cleanFontEnvironment() {
  document
    .querySelectorAll('style[data-test-font], link[data-test-font]')
    .forEach(el => el.remove())
}

function addStyleTag(css) {
  const style = document.createElement('style')
  style.setAttribute('data-test-font', 'true')
  style.textContent = css
  document.head.appendChild(style)
  return style
}

function addFontStylesheet(href = 'https://cdn.example.com/fonts.css') {
  const link = document.createElement('link')
  link.setAttribute('data-test-font', 'true')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
  return link
}

// Helpers nuevos para la API smart
function makeRequired(family, weight='400', style='normal', stretchPct=100) {
  const key = `${family}__${weight}__${style}__${stretchPct}`
  return new Set([key])
}

function makeUsedCodepoints(text='A') {
  const s = new Set()
  for (const ch of text) s.add(ch.codePointAt(0))
  return s
}

/**
 * Mock seguro de document.fonts (FontFaceSet "mínimo pero compatible")
 * @param {Array<{ family:string, status:string, weight?:string, style?:string, _snapdomSrc?:string }>} fontsArray
 */
function setDocumentFonts(fontsArray = []) {
  const items = [...fontsArray]

  // iterables y helpers típicos
  const iter = function* () { yield* items }
  const fakeSet = {
    // iterator por defecto
    [Symbol.iterator]: iter,
    // API parecida a FontFaceSet
    values: iter,
    entries: function* () { for (const it of items) yield [it.family, it] },
    forEach(cb, thisArg) { for (const it of items) cb.call(thisArg, it, it, fakeSet) },
    has(ff) { return items.includes(ff) },
    add(ff) { items.push(ff) },
    delete(ff) { const i = items.indexOf(ff); if (i >= 0) items.splice(i, 1) },
    clear() { items.length = 0 },
    ready: Promise.resolve(),
    // extra mínimo
    size: items.length
  }

  Object.defineProperty(document, 'fonts', {
    configurable: true,
    get() { return fakeSet },
    set() {}
  })

  return () => { delete document.fonts }
}

let restoreFonts = () => {}

beforeEach(() => {
  // cache.reset() o resetCache() según exista
  if (typeof cache.reset === 'function') cache.reset()
  if (typeof cache.resetCache === 'function') cache.resetCache()
  if (cache.font?.clear) cache.font.clear?.()
  if (cache.resource?.clear) cache.resource.clear?.()

  cleanFontEnvironment()
  vi.restoreAllMocks()
  restoreFonts = setDocumentFonts([]) // mock vacío por defecto
})

afterEach(() => {
  restoreFonts?.()
})

// ========== iconToImage ==========
describe('iconToImage', () => {
  let ctxSpy, toDataURLSpy

  afterEach(() => {
    ctxSpy?.mockRestore?.()
    toDataURLSpy?.mockRestore?.()
  })

  it('devuelve un data URL válido con dimensiones > 0', async () => {
    ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      scale: vi.fn(),
      font: '',
      textBaseline: '',
      fillStyle: '',
      fillText: vi.fn(),
    }))
    toDataURLSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,TEST')

    const { dataUrl, width, height } = await iconToImage('A', 'Arial', '400', 16, '#000')
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})

// ========== embedCustomFonts ==========
describe('embedCustomFonts', () => {
  it('conserva @font-face con solo local() en src', async () => {
    const style = addStyleTag(`
      @font-face {
        font-family: 'OnlyLocal';
        src: local("Arial");
        font-style: normal;
        font-weight: 400;
      }
    `)

    const css = await embedCustomFonts({
      required: makeRequired('OnlyLocal', '400', 'normal', 100),
      usedCodepoints: makeUsedCodepoints('abc')
    })
    expect(css).toMatch(/font-family:\s*['"]?OnlyLocal['"]?/)
    expect(css).toMatch(/src:\s*local\(["']Arial["']\)/)
    document.head.removeChild(style)
  })

  it('filtra @font-face no utilizados segun document.fonts', async () => {
    restoreFonts?.() // reemplazamos con fuentes usadas
    restoreFonts = setDocumentFonts([
      { family: 'UsedFont', status: 'loaded', weight: 'normal', style: 'normal' },
    ])

    addStyleTag(`
      @font-face { font-family: 'UsedFont'; src: url(data:font/woff;base64,AA==); }
      @font-face { font-family: 'UnusedFont'; src: url(data:font/woff;base64,BB==); }
    `)

    const css = await embedCustomFonts({
      required: makeRequired('UsedFont', '400', 'normal', 100),
      usedCodepoints: makeUsedCodepoints('A')
    })
    expect(css).toMatch(/UsedFont/)
    expect(css).not.toMatch(/UnusedFont/)
  })

  it('embebe fuentes locales provistas', async () => {
    const css = await embedCustomFonts({
      required: makeRequired('MyLocal', '400', 'normal', 100),
      usedCodepoints: makeUsedCodepoints('A'),
      localFonts: [{ family: 'MyLocal', src: 'data:font/woff;base64,AA==' }],
    })
    expect(css).toMatch(/font-family:\s*['"]?MyLocal['"]?/)
    expect(css).toMatch(/AA==/)
  })

  it('usa _snapdomSrc para nuevas fuentes', async () => {
    restoreFonts?.()
    restoreFonts = setDocumentFonts([
      { family: 'DynFont', status: 'loaded', weight: 'normal', style: 'normal', _snapdomSrc: 'data:font/woff;base64,CC==' },
    ])

    const css = await embedCustomFonts({
      required: makeRequired('DynFont', '400', 'normal', 100),
      usedCodepoints: makeUsedCodepoints('A'),
    })
    expect(css).toMatch(/font-family:\s*['"]?DynFont['"]?/)
    expect(css).toMatch(/CC==/)
  })

  it('conserva @font-face con local() y sin url()', async () => {
    const style = addStyleTag(`
      @font-face {
        font-family: LocalFont;
        src: local('MyFont'), local('FallbackFont');
        font-style: italic;
        font-weight: bold;
      }
    `)

    const css = await embedCustomFonts({
      required: makeRequired('LocalFont', '700', 'italic', 100),
      usedCodepoints: makeUsedCodepoints('Z')
    })
    expect(css).toMatch(/font-family:\s*['"]?LocalFont['"]?/)
    expect(css).toMatch(/src:\s*local\(['"]MyFont['"]\),\s*local\(['"]FallbackFont['"]\)/)
    expect(css).toMatch(/font-style:\s*italic/)
    document.head.removeChild(style)
  })

  it.each([
    {
      property: 'font-family',
      css: '@font-face{src:local("Nunito");font-style:normal;font-weight:100 300;font-stretch:100%;font-family:Nunito}',
      expected: /font-family:\s*Nunito/,
    },
    {
      property: 'font-weight',
      css: '@font-face{font-family:Nunito;src:url(https://cdn.example.com/Nunito-Light.ttf);font-weight:100 300}',
      expected: /font-weight:\s*100 300/,
      fontUrl: 'https://cdn.example.com/Nunito-Light.ttf',
    },
    {
      property: 'font-style',
      css: '@font-face{font-family:Nunito;src:local("Nunito");font-weight:100 300;font-stretch:100%;font-style:italic}',
      expected: /font-style:\s*italic/,
      required: makeRequired('Nunito', '200', 'italic', 100),
    },
    {
      property: 'font-stretch',
      css: '@font-face{font-family:Nunito;src:local("Nunito");font-style:normal;font-weight:100 300;font-stretch:75%}',
      expected: /font-stretch:\s*75%/,
      required: makeRequired('Nunito', '200', 'normal', 75),
    },
    {
      property: 'unicode-range',
      css: '@font-face{font-family:Nunito;src:local("Nunito");font-style:normal;font-weight:100 300;font-stretch:100%;unicode-range:U+0000-00FF}',
      expected: /unicode-range:\s*U\+0000-00FF/,
    },
  ])('parses $property when the final declaration has no semicolon', async ({ css: fontCss, expected, required, fontUrl }) => {
    const href = 'https://cdn.example.com/fonts.css'
    addFontStylesheet(href)
    vi.mocked(snapFetch).mockResolvedValueOnce({
      ok: true,
      data: fontCss,
      status: 200,
      url: href,
      fromCache: false,
    })
    if (fontUrl) {
      vi.mocked(snapFetch).mockResolvedValueOnce({
        ok: true,
        data: 'data:font/ttf;base64,AA==',
        status: 200,
        url: fontUrl,
        fromCache: false,
        mime: 'font/ttf',
      })
    }

    const css = await embedCustomFonts({
      required: required || makeRequired('Nunito', '200', 'normal', 100),
      usedCodepoints: makeUsedCodepoints('A'),
      fontStylesheetDomains: ['cdn.example.com'],
    })

    expect(css).toMatch(expected)
    if (fontUrl) expect(css).toContain('data:font/ttf;base64,AA==')
  })
})

/**
 * Ensures that when a family only publishes a single weight (e.g., 400),
 * and the required variant asks for 700, we still embed the available 400 face
 * (browser will synthesize bold). This covers families like "Mansalva".
 */
describe('embedCustomFonts - single weight fallback', () => {
  it('embeds the 400 @font-face when 700 is required (fallback)', async () => {
    // Prepare a minimal @font-face for "Mansalva" with only weight 400
    const style = document.createElement('style')
    style.textContent = `
      @font-face {
        font-family: 'Mansalva';
        font-style: normal;
        font-weight: 400;
        font-stretch: 100%;
        unicode-range: U+000-5FF;
        src: local('Mansalva'),
             url(data:font/woff2;base64,AA==) format('woff2');
      }
    `
    document.head.appendChild(style)

    // Required variants:
    // ask for 700 normal stretch=100% (our faceMatchesRequired must accept nearest=400)
    const required = new Set(['Mansalva__700__normal__100'])

    // Used codepoints: any latin char; we keep within declared unicode-range
    const usedCodepoints = new Set([65]) // 'A'

    const css = await embedCustomFonts({
      required,
      usedCodepoints,
      // no excludes, no proxy
    })

    // Expectations:
    expect(css).toMatch(/font-family:\s*['"]?Mansalva['"]?/)
    // It must embed the available 400 face (we accept nearest)
    expect(css).toMatch(/font-weight:\s*400/)
    // And keep the inlined data URL we provided
    expect(css).toMatch(/data:font\/woff2;base64,AA==/)

    document.head.removeChild(style)
  })
})
