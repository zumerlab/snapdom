// __tests__/api.preCache.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils')
  return {
    ...actual,
    fetchImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    precacheCommonTags: vi.fn(),
    isSafari: vi.fn(() => false), // queda como vi.fn() invocable
  }
})

// preCache importa inlineBackgroundImages desde ../modules/background.js
// (si en tu código real lo seguís importando desde ../utils, cambiá esta ruta acá)
vi.mock('../src/modules/background.js', () => ({
  inlineBackgroundImages: vi.fn(async () => {}),
}))

vi.mock('../src/modules/fonts.js', () => ({
  embedCustomFonts: vi.fn(async () => ''),
  collectUsedFontVariants: vi.fn(() => new Set(['Mansalva__700__italic__100'])),
  collectUsedCodepoints: vi.fn(() => new Set([65])),
  ensureFontsReady: vi.fn(async () => {}),
}))

// ⬇️ recién ahora importamos SUT + símbolos mocked
import { preCache } from '../src/api/preCache.js'
import { cache } from '../src/core/cache.js'
import * as utils from '../src/utils'
import { inlineBackgroundImages } from '../src/modules/background.js'
import {
  embedCustomFonts,
  collectUsedFontVariants,
  collectUsedCodepoints,
  ensureFontsReady,
} from '../src/modules/fonts.js'

describe('preCache – líneas difíciles', () => {
  beforeEach(() => {
     vi.clearAllMocks()
  utils.isSafari.mockReset?.()
  utils.isSafari.mockReturnValue(false)
    if (!cache.session) cache.session = {}
    cache.session.styleCache = new WeakMap()
  })

  it('pasa cache.session.styleCache a inlineBackgroundImages (líneas 49–50)', async () => {
    const root = document.createElement('div')
    const ref = cache.session.styleCache

    await expect(preCache(root, { embedFonts: false })).resolves.toBeUndefined()

    expect(inlineBackgroundImages).toHaveBeenCalledTimes(1)
    const args = inlineBackgroundImages.mock.calls[0] // [source, mirror, styleCache, options]
    expect(args[0]).toBe(root)
    expect(args[2]).toStrictEqual(ref)              // MISMA referencia => cubre 49–50
    expect(args[3]).toMatchObject({ useProxy: '' })
  })

  it('si inlineBackgroundImages falla, preCache resuelve igual (catch 56–65)', async () => {
    inlineBackgroundImages.mockRejectedValueOnce(new Error('boom'))
    const el = document.createElement('section')

    await expect(preCache(el, { embedFonts: false })).resolves.toBeUndefined()
  })

  it('Safari warmup + embed de fuentes con params correctos (84–91)', async () => {
    utils.isSafari.mockReturnValue(true)

    const root = document.createElement('div')
    const excludeFonts = { subsets: ['latin'], domains: ['bad.example'] }
    const localFonts = [{ family: 'Foo', src: 'data:font/woff2;base64,AA==' }]

    await preCache(root, {
      embedFonts: true,
      useProxy: '/proxy/',
      excludeFonts,
      localFonts,
    })

    expect(ensureFontsReady).toHaveBeenCalledTimes(1)
    const [families, reps] = ensureFontsReady.mock.calls[0]
    expect(families instanceof Set).toBe(true)
    expect(Array.from(families)).toContain('Mansalva')
    expect(reps).toBe(3)

    expect(embedCustomFonts).toHaveBeenCalledTimes(1)
    const call = embedCustomFonts.mock.calls[0][0]
    expect(call.required).toEqual(collectUsedFontVariants())
    expect(call.usedCodepoints).toEqual(collectUsedCodepoints())
    expect(call.exclude).toEqual(excludeFonts)
    expect(call.localFonts).toEqual(localFonts)
    expect(call.useProxy).toBe('/proxy/')
  })

  it('crea styleCache si no existe y lo inyecta a inlineBackgroundImages (49–50)', async () => {
  // Aseguramos estado inicial sin styleCache
  cache.session = cache.session || {}
  delete cache.session.styleCache

  const root = document.createElement('main')

  await expect(preCache(root, { embedFonts: false })).resolves.toBeUndefined()

  // Se llamó una vez y con el WeakMap recién creado
  expect(inlineBackgroundImages).toHaveBeenCalledTimes(1)
  const args = inlineBackgroundImages.mock.calls[0] // [source, mirror, styleCache, options]
  expect(args[0]).toBe(root)

  // preCache debió crear y colgar el WeakMap en cache.session.styleCache
  expect(cache.session.styleCache).toBeInstanceOf(WeakMap)
  expect(args[2]).toBe(cache.session.styleCache) // MISMA referencia => cubre 49–50
})

it('si inlineBackgroundImages lanza (throw sync), preCache resuelve igual (56–65)', async () => {
  // Lanzar sincrónico para entrar al try/catch de preCache
  inlineBackgroundImages.mockImplementationOnce(() => { throw new Error('sync-boom') })

  const el = document.createElement('section')
  await expect(preCache(el, { embedFonts: false })).resolves.toBeUndefined()

  // (Opcional) el resto del flujo no debe romperse
  expect(inlineBackgroundImages).toHaveBeenCalledTimes(1)
})

})
