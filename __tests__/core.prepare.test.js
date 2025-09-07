// __tests__/core.prepare.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import { prepareClone } from '../src/core/prepare.js'
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
