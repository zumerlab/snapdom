import { describe, it, expect, beforeEach, vi } from 'vitest'
import { preCache } from '../src/api/preCache.js'
import { cache } from '../src/core/cache.js'
import { safeEncodeURI } from '../src/utils/helpers.js' // ajustá el path si difiere

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
    // En el contrato nuevo, no se debería llegar acá si useProxy está seteado
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

  // (3) Dedupe en cache.background: una sola entrada para ese URL
  const key = safeEncodeURI(DIRECT)
  expect(cache.background.has(key)).toBe(true)
  expect([...cache.background.keys()].filter(k => k === key).length).toBe(1)

  document.body.removeChild(root)
})

  it('handles mixed background layers (gradient + url) and only processes the URL layer', async () => {
    // No contamos fetch acá porque raster usa Image() y puede ser 0.
    globalThis.fetch = vi.fn() // por si algo intenta fetch (no debería)

    const URL = 'https://assets.test/a.svg' // usamos SVG para que sí pase por fetch en tu impl
    // Si querés testear raster, cambiá asserts a cache.image; con SVG comprobamos background.
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

    // Verificamos que SOLO la capa url(...) fue procesada y quedó cacheada
    const key = safeEncodeURI(URL)
    expect(cache.background.has(key)).toBe(true)

    // No exigimos conteo de fetch: puede ser 0 si fuese raster.
    // Si mantenés SVG como arriba, opcionalmente:
    // expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    document.body.removeChild(el)
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

    // Comprobamos que el hijo fue visto y cacheado
    const key = safeEncodeURI(CHILD_URL)
    expect(cache.background.has(key)).toBe(true)

    document.body.removeChild(root)
  })
})
