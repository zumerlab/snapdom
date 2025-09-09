import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'
vi.mock('../src/modules/snapFetch.js', async () => {
  const actual = await vi.importActual('../src/modules/snapFetch.js')
  return {
    ...actual,
    // queda espiable y con la impl. real por defecto
    snapFetch: vi.fn(actual.snapFetch),
  }
})


// Wrap ESM exports once so we can override per-test with mockImplementationOnce.
// By default they call through to the actual implementations.
vi.mock('../src/modules/svgDefs.js', async () => {
  const actual = await vi.importActual('../src/modules/svgDefs.js')
  return {
    ...actual,
    inlineExternalDefsAndSymbols: vi.fn(actual.inlineExternalDefsAndSymbols),
  }
})

vi.mock('../src/modules/pseudo.js', async () => {
  const actual = await vi.importActual('../src/modules/pseudo.js')
  return {
    ...actual,
    inlinePseudoElements: vi.fn(actual.inlinePseudoElements),
  }
})

vi.mock('../src/utils/index.js', async () => {
  const actual = await vi.importActual('../src/utils/index.js')
  return {
    ...actual,
    stripTranslate: vi.fn(actual.stripTranslate),
    // everything else passes through as-is
  }
})

// (Optional) allow deepClone error branch without permanent stubbing
vi.mock('../src/core/clone.js', async () => {
  const actual = await vi.importActual('../src/core/clone.js')
  return {
    ...actual,
    deepClone: vi.fn(actual.deepClone),
  }
})

//import { prepareClone } from '../src/core/prepare.js'
import * as svgDefs from '../src/modules/svgDefs.js'
import * as pseudo from '../src/modules/pseudo.js'
import * as utils from '../src/utils/index.js'
import * as cloneMod from '../src/core/clone.js'

function freshSessionCache() {
  return {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
  }
}

describe('prepareClone deep coverage (Browser Mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore any globals we might have touched
    if ('fetch' in globalThis) {
      // If we replaced it with a mock in a test, restore
      try { vi.restoreAllMocks() } catch {}
    }
    // Always restore getComputedStyle if mocked
    if (window.getComputedStyle && 'mock' in window.getComputedStyle) {
      window.getComputedStyle.mockRestore()
    }
  })

  it('prepares a basic clone and returns classCSS', async () => {
    const el = document.createElement('div')
    el.textContent = 'test'
    const { clone, classCSS } = await prepareClone(el)
    expect(clone).toBeTruthy()
    expect(typeof classCSS).toBe('string')
  })

  it('throws for null node', async () => {
    // @ts-ignore - intentionally wrong
    await expect(prepareClone(null)).rejects.toThrow()
  })

  it('applies stabilizeLayout when outline is visible and no border present', async () => {
  const el = document.createElement('div')
  el.style.outline = '2px solid red'
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    outlineStyle: 'solid',
    outlineWidth: '2px',   // 👈 con unidad
    borderStyle: 'none',   // 👈 sin borde
    borderWidth: '0px',    // 👈 con unidad
    getPropertyValue: () => '', // requerido por inlineAllStyles
  }))
  await prepareClone(el)
  expect(el.style.border).toContain('transparent') // se setea en stabilizeLayout
  window.getComputedStyle.mockRestore()
})


  it('handles error in inlineExternalDefsAndSymbols (logs and continues)', async () => {
    const el = document.createElement('div')
    vi.mocked(svgDefs.inlineExternalDefsAndSymbols).mockImplementationOnce(() => {
      throw new Error('fail')
    })
    await expect(prepareClone(el)).resolves.toBeTruthy()
  })

  it('handles error in inlinePseudoElements (logs and continues)', async () => {
    const el = document.createElement('div')
    vi.mocked(pseudo.inlinePseudoElements).mockImplementationOnce(() => {
      throw new Error('fail')
    })
    await expect(prepareClone(el)).resolves.toBeTruthy()
  })

  it('applies scroll wrapper when original has scroll offsets', async () => {
  const el = document.createElement('div')
  const child = document.createElement('div')
  child.textContent = 'content'
  el.appendChild(child)

  // Fuerza valores de scroll sin depender de layout
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => 10 })
  Object.defineProperty(el, 'scrollTop',  { configurable: true, get: () => 20 })

  const { clone } = await prepareClone(el)
  const wrapper = clone.firstChild
  expect(wrapper).toBeTruthy()
  expect(wrapper instanceof HTMLElement).toBe(true)
  expect(wrapper.style.transform).toContain('translate(-10px, -20px)')
})


  it('applies inline styles (no class) for nodes inside ShadowRoot', async () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    inner.style.background = 'red'
    shadow.appendChild(inner)

    const { clone } = await prepareClone(inner)
    // In shadow DOM branch, it sets inline style string
    expect(clone.getAttribute('style') || '').toMatch(/background/)
  })

  it('uses stripTranslate result for the root transform', async () => {
    const el = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'translate(10px, 20px) rotate(5deg)',
      getPropertyValue: () => '',
    })
    vi.mocked(utils.stripTranslate).mockReturnValueOnce('scale(1)')
    const { clone } = await prepareClone(el)
    expect(clone.style.transform).toBe('scale(1)')
    window.getComputedStyle.mockRestore()
  })

  it('normalizes margins for <pre> elements', async () => {
    const el = document.createElement('pre')
    el.textContent = 'x'
    const { clone } = await prepareClone(el)
    // CSSOM normalizes to '0px'
    expect(clone.style.marginTop).toBe('0px')
    expect(clone.style.marginBlockStart).toBe('0px')
  })

  it('converts <img src="blob:..."> to data URL', async () => {
  const wrap = document.createElement('div')
  const el = document.createElement('img')
  el.src = 'blob:12345'
  wrap.appendChild(el)

  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => new Blob(['abc'], { type: 'text/plain' }),
  })

  const { clone } = await prepareClone(wrap)
  const outImg = clone.querySelector('img')
  expect(outImg.getAttribute('src') || '').toMatch(/^data:/)

  globalThis.fetch = originalFetch
})


 it('converts <img srcset> entries with blob: to data URLs', async () => {
  const wrap = document.createElement('div')
  const el = document.createElement('img')
  el.setAttribute('srcset', 'blob:123 1x, blob:456 2x')
  wrap.appendChild(el)

  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => new Blob(['abc'], { type: 'text/plain' }),
  })

  const { clone } = await prepareClone(wrap)
   const outImg = clone.querySelector('img')
   const outSrcset = outImg?.getAttribute('srcset') || ''
   const outSrc = outImg?.getAttribute('src') || ''
   // Nunca debe quedar blob:
   expect(outSrcset).not.toContain('blob:')
   expect(outSrc).not.toContain('blob:')
   // Aceptamos ambos flujos: (a) srcset con data: o (b) src con data: y srcset vacío
   expect(
     (outSrcset.includes('data:')) || (outSrc.startsWith('data:'))
   ).toBe(true)
  globalThis.fetch = originalFetch
})


  it('converts <svg><image href="blob:..."> to data URL', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    img.setAttribute('href', 'blob:123')
    svg.appendChild(img)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => new Blob(['abc'], { type: 'text/plain' }),
    })

    const { clone } = await prepareClone(svg)
    const outHref = clone.querySelector('image')?.getAttribute('href') || ''
    expect(outHref).toMatch(/^data:/)

    globalThis.fetch = originalFetch
  })

  it('replaces blob: URLs inside inline style attributes', async () => {
    const el = document.createElement('div')
    const styled = document.createElement('div')
    styled.setAttribute('style', 'background-image:url(blob:123)')
    el.appendChild(styled)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => new Blob(['abc'], { type: 'text/plain' }),
    })

    const { clone } = await prepareClone(el)
    const outStyle = clone.querySelector('[style]')?.getAttribute('style') || ''
    expect(outStyle).toContain('data:')

    globalThis.fetch = originalFetch
  })

  it('replaces blob: URLs inside <style> tags', async () => {
    const el = document.createElement('div')
    const style = document.createElement('style')
    style.textContent = '.a{background:url(blob:123)}'
    el.appendChild(style)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => new Blob(['abc'], { type: 'text/plain' }),
    })

    const { clone } = await prepareClone(el)
    const out = clone.querySelector('style')?.textContent || ''
    expect(out).toContain('data:')

    globalThis.fetch = originalFetch
  })

  it('converts "poster" attribute when it starts with blob:', async () => {
  const wrap = document.createElement('div')
  const el = document.createElement('video')
  el.setAttribute('poster', 'blob:123')
  wrap.appendChild(el)

  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => new Blob(['abc'], { type: 'text/plain' }),
  })

  const { clone } = await prepareClone(wrap)
  const outPoster = clone.querySelector('video')?.getAttribute('poster') || ''
  expect(outPoster).toMatch(/^data:/)

  globalThis.fetch = originalFetch
})

  it('propagates deepClone error (internal logic throws)', async () => {
    const el = document.createElement('div')
    vi.mocked(cloneMod.deepClone).mockImplementationOnce(() => {
      throw new Error('fail')
    })
    await expect(prepareClone(el)).rejects.toThrow('fail')
  })
})


// 1) No hay blob: en CSS → early return de replaceBlobUrlsInCssText
it('does nothing when no blob: appears in style/style attribute', async () => {
  const root = document.createElement('div')

  const styled = document.createElement('div')
  styled.setAttribute('style', 'background:red') // sin blob:
  root.appendChild(styled)

  const style = document.createElement('style')
  style.textContent = '.x{color:blue}' // sin blob:
  root.appendChild(style)

  const { clone } = await prepareClone(root)
  const outInline = clone.querySelector('[style]')?.getAttribute('style') || ''
  const outStyle  = clone.querySelector('style')?.textContent || ''
  expect(outInline).toBe('background:red') // normalizado
  expect(outStyle).toContain('color:blue')
})

// 2) blobUrlToDataUrl: hit en cache.resource evita fetch/snapFetch
it('uses cache.resource for blob: → data: without calling fetch', async () => {
  const wrap = document.createElement('div')
  const img = document.createElement('img')
  img.src = 'blob:abc123'
  wrap.appendChild(img)

  // Pre-cargar cache global
  cache.resource.set('blob:abc123', 'data:text/plain;base64,Zm9v')

  const spyFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('should not be called') })

  const { clone } = await prepareClone(wrap)
  const src = clone.querySelector('img')?.getAttribute('src') || ''
  expect(src).toBe('data:text/plain;base64,Zm9v')

  spyFetch.mockRestore()
})

// 3) blobUrlToDataUrl: fallo limpia memo y permite reintento
it('on fetch failure, memo is cleared and a later call can succeed', async () => {
  const wrap = document.createElement('div')
  const a = document.createElement('img')
  const b = document.createElement('img')
  a.src = 'blob:fail-then-ok'
  b.src = 'blob:fail-then-ok'
  wrap.appendChild(a)
  wrap.appendChild(b)

//  import { snapFetch } from '../src/modules/snapFetch.js'

// Primer intento: falla → se mantienen los blob:
vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })

const first = await prepareClone(wrap)
const srcs1 = [...first.clone.querySelectorAll('img')]
  .map(n => n.getAttribute('src') || '')
expect(srcs1.every(s => s.startsWith('blob:'))).toBe(true)

// Segundo intento: éxito → convierte a data:
vi.mocked(snapFetch).mockResolvedValueOnce({
  ok: true,
  data: 'data:text/plain;base64,AAA=',
})

const { clone } = await prepareClone(wrap)
const srcs = [...clone.querySelectorAll('img')].map(n => n.getAttribute('src') || '')
expect(srcs.every(s => s.startsWith('data:'))).toBe(true)


})

// 4) <image xlink:href="blob:..."> → set href y removeAttributeNS
it('moves xlink:href to href and removes namespaced attribute', async () => {
  const XLINK = 'http://www.w3.org/1999/xlink'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const img = document.createElementNS('http://www.w3.org/2000/svg', 'image')
  img.setAttributeNS(XLINK, 'xlink:href', 'blob:777')
  svg.appendChild(img)

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    blob: () => new Blob(['abc'], { type: 'text/plain' }),
  })

  const { clone } = await prepareClone(svg)
  const out = clone.querySelector('image')
  expect(out?.getAttribute('href') || '').toMatch(/^data:/)
  // namespaced removido (si removeAttributeNS está disponible en el ambiente)
  if (out?.getAttributeNS) {
    expect(out.getAttributeNS(XLINK, 'href')).toBeNull()
  }
  fetchSpy.mockRestore()
})

// 5) Extrae style[data-sd] del clone y lo concatena en classCSS
it('pulls <style data-sd> out of clone and prepends into classCSS', async () => {
  const host = document.createElement('div')
  const sr = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = '.inside{color:rebeccapurple}'
  sr.appendChild(style)
  document.body.appendChild(host)

  const { clone, classCSS } = await prepareClone(host)
  const injected = clone.querySelector('style[data-sd]')
  expect(injected).toBeNull()          // removido del DOM
  expect(classCSS).toContain('.inside') // concatenado en classCSS

  host.remove()
})

// 6) stabilizeLayout: NO parchea si ya hay borde (rama negativa)
it('does not set transparent border when element already has border', async () => {
  const el = document.createElement('div')
  el.style.border = '1px solid black'
  el.style.outline = '2px solid red'

  const csMock = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    outlineStyle: 'solid',
    outlineWidth: '2px',
    borderStyle: 'solid',
    borderWidth: '1px',
    getPropertyValue: () => '',
  })

  await prepareClone(el)
  expect(el.style.border).toBe('1px solid black') // no se pisa

  csMock.mockRestore()
})

// 7) stripTranslate devuelve ''/none → transform queda vacío
it('root transform becomes empty string when stripTranslate returns falsy', async () => {
  const el = document.createElement('div')

  // getComputedStyle con transform none
  const csMock = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    transform: 'none',
    getPropertyValue: () => '',
  })

  // mock puntual de stripTranslate para devolver ''
  const mod = await vi.importMock('../src/utils/index.js')
  mod.stripTranslate.mockReturnValueOnce('')

  const { clone } = await prepareClone(el)
  expect(clone.style.transform).toBe('')

  csMock.mockRestore()
})

// 8) resolveBlobUrlsInTree early paths: img sin src/srcset, style sin blob
it('skips nodes with no actionable URLs (early paths)', async () => {
  const root = document.createElement('div')

  const img = document.createElement('img') // sin src/srcset
  root.appendChild(img)

  const style = document.createElement('style')
  style.textContent = '.a{color:red}' // sin blob
  root.appendChild(style)

  const { clone } = await prepareClone(root)
  const outImg = clone.querySelector('img')
  const outStyle = clone.querySelector('style')?.textContent || ''
  expect(outImg?.hasAttribute('src')).toBe(false)
  expect(outStyle).toContain('color:red')
})
it('replaces blob: URLs inside <img srcset> and preserves non-blob candidates/descriptor', async () => {
  const wrap = document.createElement('div')
  const img = document.createElement('img')
  img.setAttribute('srcset', 'blob:aa 1x, https://x/y.png 2x, blob:bb 3x')
  wrap.appendChild(img)

  // ⬇️ Evitar que freezeImgSrcset borre srcset
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => '' })
  Object.defineProperty(img, 'src',        { configurable: true, get: () => '' })

  vi.mocked(snapFetch)
    .mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,AAA' }) // blob:aa
    .mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,BBB' }) // blob:bb

  const { clone } = await prepareClone(wrap)
  const out = clone.querySelector('img')?.getAttribute('srcset') || ''

  expect(out.includes('blob:')).toBe(false)
  expect(out).toContain('data:image/png;base64,AAA 1x')
  expect(out).toContain('https://x/y.png 2x')
  expect(out).toContain('data:image/png;base64,BBB 3x')
})

it('keeps original srcset when blob→data conversion fails (changed=false)', async () => {
  const wrap = document.createElement('div')
  const img = document.createElement('img')
  img.setAttribute('srcset', 'blob:fail 1x, blob:alsofail 2x')
  wrap.appendChild(img)

  // ⬇️ Evitar que freezeImgSrcset borre srcset
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => '' })
  Object.defineProperty(img, 'src',        { configurable: true, get: () => '' })

  vi.mocked(snapFetch)
    .mockResolvedValueOnce({ ok: false, data: null })
    .mockResolvedValueOnce({ ok: false, data: null })

  const { clone } = await prepareClone(wrap)
  const out = clone.querySelector('img')?.getAttribute('srcset') || ''

  // Como todas fallaron, changed=false → no se toca el atributo
  expect(out).toBe('blob:fail 1x, blob:alsofail 2x')
})
