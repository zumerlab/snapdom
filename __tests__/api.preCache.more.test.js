// __tests__/api.preCache.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    precacheCommonTags: vi.fn(),
    isSafari: vi.fn(() => false), // queda como vi.fn() invocable
    inlineSingleBackgroundEntry: vi.fn(async () => 'url("data:image/png;base64,AA==")'),
  }
})

vi.mock('../src/modules/fonts.js', () => ({
  embedCustomFonts: vi.fn(async () => ''),
  collectFontUsage: vi.fn(() => ({
    required: new Set(['Mansalva__700__italic__100']),
    usedCodepoints: new Set([65]),
  })),
  collectUsedFontVariants: vi.fn(() => new Set(['Mansalva__700__italic__100'])),
  collectUsedCodepoints: vi.fn(() => new Set([65])),
  ensureFontsReady: vi.fn(async () => {}),
}))

// ⬇️ recién ahora importamos SUT + símbolos mocked
import { preCache } from '../src/api/preCache.js'
import { cache } from '../src/core/cache.js'
import * as utils from '../src/utils'
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

  it('prefetches background, mask and border-image URLs (the full URL_PROPS list)', async () => {
    const root = document.createElement('div')
    const bg = document.createElement('div')
    bg.style.backgroundImage = 'url(https://cdn.example.com/bg.svg)'
    const masked = document.createElement('div')
    masked.style.webkitMaskImage = 'url(https://cdn.example.com/mask.svg)'
    const bordered = document.createElement('div')
    bordered.style.borderImageSource = 'url(https://cdn.example.com/border.svg)'
    root.append(bg, masked, bordered)
    document.body.appendChild(root)
    try {
      await expect(preCache(root, { embedFonts: false })).resolves.toBeUndefined()
      const entries = utils.inlineSingleBackgroundEntry.mock.calls.map((c) => c[0]).join('|')
      expect(entries).toContain('bg.svg')
      expect(entries).toContain('mask.svg')
      expect(entries).toContain('border.svg')
    } finally {
      root.remove()
    }
  })

  it('dedupes repeated url() entries per element and survives entry failures', async () => {
    utils.inlineSingleBackgroundEntry.mockRejectedValue(new Error('boom'))
    const el = document.createElement('section')
    // same url in shorthand and longhand: must be fetched once, and a rejection must not throw
    el.style.backgroundImage = 'url(https://cdn.example.com/dup.png)'
    document.body.appendChild(el)
    try {
      await expect(preCache(el, { embedFonts: false })).resolves.toBeUndefined()
      const dupCalls = utils.inlineSingleBackgroundEntry.mock.calls
        .map((c) => c[0])
        .filter((e) => e.includes('dup.png'))
      expect(dupCalls.length).toBe(1)
    } finally {
      el.remove()
    }
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

  it('crea styleCache si no existe (49–50)', async () => {
    cache.session = cache.session || {}
    delete cache.session.styleCache

    const root = document.createElement('main')
    await expect(preCache(root, { embedFonts: false })).resolves.toBeUndefined()

    expect(cache.session.styleCache).toBeInstanceOf(WeakMap)
  })
})
