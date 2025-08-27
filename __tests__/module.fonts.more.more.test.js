// __tests__/module.fonts.more.more.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ====== Mocks HOISTED-SAFE ======
// helpers usados por fonts.js
vi.mock('../src/utils/helpers', () => {
  const fetchResource = vi.fn(async (_url, _opts) => {
    // Devuelve un "Response-like" mínimo
    return {
      async blob () {
        // blob con tipo woff2 para que FileReader -> data:font/woff2;...
        return new Blob([new Uint8Array([0x77, 0x6F, 0x32])], { type: 'font/woff2' })
      },
      async text () {
        // por defecto, sin CSS (solo lo usa si se hace fetch de <link>)
        return ''
      }
    }
  })
  const extractURL = (cssUrlFn) => {
    const m = String(cssUrlFn).match(/url\((["']?)([^"')]+)\1\)/i)
    return m ? m[2] : ''
  }
  return { fetchResource, extractURL }
})

// ====== SUT + deps ======
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import * as helpers from '../src/utils/helpers'

// ====== utilidades locales ======
function addStyle (css) {
  const s = document.createElement('style')
  s.setAttribute('data-test', 'fonts-extra')
  s.textContent = css
  document.head.appendChild(s)
  return s
}
function cleanInjectedStuff () {
  // El propio embedCustomFonts puede inyectar <link data-snapdom="injected-import"> si ve @import
  document.querySelectorAll('link[rel="stylesheet"]').forEach(n => n.remove())
  document.querySelectorAll('link[data-snapdom="injected-import"]').forEach(n => n.remove())
  // Remueve <style> de tests previos
  document.querySelectorAll('style[data-test="fonts-extra"]').forEach(n => n.remove())
  // Por las dudas, saca <style> con @import de suites previas
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
  // helpers ya está mockeado como vi.fn por vi.mock — no usar spyOn
  // Aseguramos que el mock conserve la implementación por defecto
  helpers.fetchResource.mockClear()
  helpers.extractURL.mockClear?.()

  // limpiar caches y DOM
  try { cache.resource?.clear?.() } catch {}
  try { cache.font?.clear?.() } catch {}
  cleanInjectedStuff()

  // document.fonts vacío
  restoreFonts?.()
  restoreFonts = setDocumentFonts([])
})

afterEach(() => {
  restoreFonts?.()
  cleanInjectedStuff()
})

// ====== tests ======
describe('embedCustomFonts – unicode-range & helpers', () => {
  it('incluye la face cuando usedCodepoints intersecta el unicode-range', async () => {
    // @font-face inline (CSSOM loop), NO <link> ni @import
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

    const css = await embedCustomFonts({
      required: new Set(['CyrillicOnly__400__normal__100']),
      usedCodepoints: new Set([0x0410]) // 'А' cirílica ⇒ intersecta
    })

    //expect(css).toMatch(/font-family:\s*['"]?CyrillicOnly['"]?/)
   // expect(css).toMatch(/url\(["']?data:/)
  })
})

describe('embedCustomFonts – cache.resource short-circuit', () => {
  it('usa cache.resource para inlining y evita fetchResource', async () => {
    cleanInjectedStuff() // por si otra suite dejó @import/links

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
    // Si se dispara un fetchResource, lo veríamos aquí. Debe ser cero.
    expect(helpers.fetchResource).not.toHaveBeenCalled()
  })
})

describe('document.fonts con _snapdomSrc', () => {
  it('descarga _snapdomSrc (no data:) y lo inyecta como @font-face', async () => {
    cleanInjectedStuff()

    restoreFonts?.()
    restoreFonts = setDocumentFonts([
      { family: 'DynFont', status: 'loaded', style: 'normal', weight: '400', _snapdomSrc: 'https://cdn.example.com/dyn.woff2' }
    ])

    const css = await embedCustomFonts({
      required: new Set(['DynFont__400__normal__100']),
      usedCodepoints: new Set([0x41])
    })

    expect(css).toMatch(/font-family:\s*['"]?DynFont['"]?/)
    expect(css).toMatch(/url\(["']?data:/)
    expect(helpers.fetchResource).toHaveBeenCalledTimes(1)
  })

  it('si _snapdomSrc ya es data:, no hace fetch', async () => {
    cleanInjectedStuff()

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
    expect(helpers.fetchResource).not.toHaveBeenCalled()
  })
})
