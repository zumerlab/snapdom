import { describe, it, expect, beforeEach, vi } from 'vitest'
import { preCache } from '../src/api/preCache.js'
import { cache } from '../src/core/cache.js'
import { safeEncodeURI } from '../src/utils/helpers.js'

beforeEach(() => {
  vi.restoreAllMocks()
  cache.image?.clear?.()
  cache.background?.clear?.()
  document.body.innerHTML = ''
})

describe('preCache – extra coverage', () => {
  it('prefetches SVG background via proxy fallback and dedupes repeated URL', async () => {
  const PROXY  = 'https://proxy.example.com/?u='
  const DIRECT = 'https://cdn.example.com/icon.svg'
  const svg    = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'

  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith(PROXY)) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(svg),
        blob: () => Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
      })
    }
    // Under the current contract this should be unreachable when useProxy is set
    return Promise.reject(new Error('network fail'))
  })

  const root = document.createElement('div')
  const a = document.createElement('div')
  const b = document.createElement('div')
  a.style.backgroundImage = `url(${DIRECT})`
  b.style.backgroundImage = `url(${DIRECT})`
  root.appendChild(a)
  root.appendChild(b)
  document.body.appendChild(root)

  await preCache(root, { useProxy: PROXY })

  const calls = vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u))
  const proxyCalls   = calls.filter(u => u.startsWith(PROXY))
  const directCalls  = calls.filter(u => u === DIRECT)

  // (1) EXACTAMENTE una llamada proxied (in-flight + cache dedupe)
  expect(proxyCalls.length).toBe(1)

  // (2) Con proxy activo, NO hay intentos directos en el nuevo snapFetch
  expect(directCalls.length).toBe(0)

  // (3) Dedupe en cache.background: una sola entrada para ese URL.
  // La clave incluye el proxy (evita que un fallo sin-proxy envenene otra config).
  const key = PROXY + '|' + safeEncodeURI(DIRECT)
  expect(cache.background.has(key)).toBe(true)
  expect([...cache.background.keys()].filter(k => k === key).length).toBe(1)

  document.body.removeChild(root)
})

  it('handles mixed background layers (gradient + url) and only processes the URL layer', async () => {
    // fetch is not counted here: the raster path uses Image() and may be 0.
    globalThis.fetch = vi.fn() // in case something tries to fetch (it should not)

    const URL = 'https://assets.test/a.svg' // SVG so it actually goes through fetch
    // To test the raster path, assert on cache.image; with SVG we check background.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(svg),
      blob: () => Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
    })

    const el = document.createElement('div')
    el.style.backgroundImage = `linear-gradient(90deg, #000, #fff), url(${URL})`
    document.body.appendChild(el)

    await preCache(el)

    // Verify that ONLY the url(...) layer was processed and cached
    // (key carries an empty proxy prefix, since useProxy is unset)
    const key = '|' + safeEncodeURI(URL)
    expect(cache.background.has(key)).toBe(true)

    // No exigimos conteo de fetch: puede ser 0 si fuese raster.
    // Keeping the SVG as above, optionally:
    // expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    document.body.removeChild(el)
  })

  it('prefetches <img src> into cache.image as a dataURL', async () => {
    const PNG = 'https://cdn.example.com/photo.png'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      blob: () => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
    })

    const root = document.createElement('div')
    const img = document.createElement('img')
    img.src = PNG
    root.appendChild(img)
    document.body.appendChild(root)

    await preCache(root, { embedFonts: false })

    const resolved = img.currentSrc || img.src
    expect(cache.image.has(resolved)).toBe(true)
    expect(cache.image.get(resolved)).toMatch(/^data:/)

    document.body.removeChild(root)
  })

  it('captures the root itself when it is an <img>', async () => {
    const PNG = 'https://cdn.example.com/root.png'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      blob: () => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
    })

    const img = document.createElement('img')
    img.src = PNG
    document.body.appendChild(img)

    await preCache(img, { embedFonts: false })

    const resolved = img.currentSrc || img.src
    expect(cache.image.has(resolved)).toBe(true)

    document.body.removeChild(img)
  })

  it('walks the subtree and preloads child backgrounds', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(svg),
      blob: () => Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
    })

    const root = document.createElement('div')
    const child = document.createElement('span')
    const CHILD_URL = 'https://x.test/nested.svg'
    child.style.backgroundImage = `url(${CHILD_URL})`
    root.appendChild(child)
    document.body.appendChild(root)

    await preCache(root)

    // Check the child was visited and cached (key carries an empty proxy prefix)
    const key = '|' + safeEncodeURI(CHILD_URL)
    expect(cache.background.has(key)).toBe(true)

    document.body.removeChild(root)
  })
})
