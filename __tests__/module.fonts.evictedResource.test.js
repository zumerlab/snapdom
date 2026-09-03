import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

vi.mock('../src/modules/snapFetch.js', () => ({ snapFetch: vi.fn() }))

const REMOTE = 'https://cdn.example.com/evicted-payload.woff2'
const B64 = 'data:font/woff2;base64,QUFBQQ=='

function required(family, weight = '400', style = 'normal', stretchPct = 100) {
  return new Set([`${family}__${weight}__${style}__${stretchPct}`])
}

/** Minimal FontFaceSet stand-in carrying a _snapdomSrc face. */
function stubDocumentFonts(items) {
  const set = {
    [Symbol.iterator]: function* () { yield* items },
    ready: Promise.resolve(),
    load: () => Promise.resolve([]),
    size: items.length,
  }
  Object.defineProperty(document, 'fonts', { configurable: true, get: () => set })
  return () => { delete document.fonts }
}

let restoreFonts = () => {}

beforeEach(() => {
  cache.resource.clear()
  snapFetch.mockReset()
  snapFetch.mockResolvedValue({ ok: true, data: B64 })
  restoreFonts = stubDocumentFonts([])
})

afterEach(() => { restoreFonts() })

// cache.resource (the base64) is FIFO-capped at 150, and it is the ONLY proof a payload
// exists. A separate "seen" Set used to stand in for it: treating "seen" as proof left the RAW
// REMOTE URL in the emitted @font-face, and a remote url() inside a foreignObject is inert,
// so the font silently failed to embed. The Set is gone; this pins that nothing replaces it.
describe('an evicted font payload is refetched, never emitted as a remote url()', () => {
  it('localFonts src: evicted still ends up as a data: URL', async () => {
    expect(cache.resource.has(REMOTE)).toBe(false)

    const css = await embedCustomFonts({
      required: required('EvictedLocal'),
      usedCodepoints: new Set(['A'.codePointAt(0)]),
      localFonts: [{ family: 'EvictedLocal', src: REMOTE, weight: '400', style: 'normal' }],
    })

    expect(snapFetch).toHaveBeenCalledWith(REMOTE, expect.objectContaining({ as: 'dataURL' }))
    expect(css).toContain('EvictedLocal')
    expect(css).toContain(B64)
    expect(css).not.toContain(REMOTE)
    expect(css).not.toMatch(/url\(\s*['"]?https?:/i)
  })

  it('FontFace._snapdomSrc: evicted still ends up as a data: URL', async () => {
    restoreFonts()
    restoreFonts = stubDocumentFonts([
      { family: 'EvictedDynamic', status: 'loaded', weight: '400', style: 'normal', _snapdomSrc: REMOTE },
    ])
    expect(cache.resource.has(REMOTE)).toBe(false)

    const css = await embedCustomFonts({
      required: required('EvictedDynamic'),
      usedCodepoints: new Set(['A'.codePointAt(0)]),
    })

    expect(snapFetch).toHaveBeenCalledWith(REMOTE, expect.objectContaining({ as: 'dataURL' }))
    expect(css).toContain('EvictedDynamic')
    expect(css).toContain(B64)
    expect(css).not.toContain(REMOTE)
    expect(css).not.toMatch(/url\(\s*['"]?https?:/i)
  })

  it('a live cache.resource entry is still reused without refetching', async () => {
    cache.resource.set(REMOTE, B64)

    const css = await embedCustomFonts({
      required: required('CachedLocal'),
      usedCodepoints: new Set(['A'.codePointAt(0)]),
      localFonts: [{ family: 'CachedLocal', src: REMOTE, weight: '400', style: 'normal' }],
    })

    expect(snapFetch).not.toHaveBeenCalledWith(REMOTE, expect.anything())
    expect(css).toContain(B64)
  })
})
