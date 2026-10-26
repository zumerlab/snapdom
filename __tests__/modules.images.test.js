// __tests__/modules.images.more.test.js
import { describe, it, expect, beforeEach, vi, afterEach} from 'vitest'
import { inlineImages } from '../src/modules/images.js'

// mock of the module images.js depends on
vi.mock('../src/modules/snapFetch.js', async () => {
  // return a function each test can replace
  return {
    snapFetch: vi.fn(async () => ({ ok: true, data: 'data:image/png;base64,AAA' })),
  }
})
import { snapFetch } from '../src/modules/snapFetch.js'

describe('inlineImages', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)

    vi.restoreAllMocks()
    // Mock OK por defecto para fetch (evita red real en otros tests)
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () =>
          Promise.resolve(
            new Blob(
              [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], // header PNG
              { type: 'image/png' }
            )
          ),
        text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      })
    )
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('converts <img> to dataURL if the image loads', async () => {
    const img = document.createElement('img')
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
    container.appendChild(img)

    await inlineImages(container)

    expect(img.src.startsWith('data:image/')).toBe(true)
    // and the img itself must have survived — a fallback swap would leave the held
    // reference intact while removing it from the tree, passing the src check alone.
    expect(container.querySelector('img')).toBe(img)
  })

 it('points a failed <img> at a placeholder and keeps the element', async () => {
  const img = document.createElement('img')
  img.src = 'https://x/fail.png'
  container.appendChild(img)

  // force an explicit snapFetch failure for this case
  vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })

  await inlineImages(container)

  expect(container.querySelector('img')).toBe(img)
  expect(decodeURIComponent(img.src)).toContain('>img</text>')
})

})

describe('inlineImages – extra coverage', () => {
  let wrap

  beforeEach(() => {
    vi.clearAllMocks()
    wrap = document.createElement('div')
    document.body.appendChild(wrap)
  })

  it('normaliza src desde currentSrc y elimina srcset/sizes', async () => {
  const wrap = document.createElement('div')
  const img = document.createElement('img')

  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => 'https://ex.com/a.png' })
  img.setAttribute('srcset', 'a.png 1x, b.png 2x')
  img.setAttribute('sizes', '100vw')
  wrap.appendChild(img)

  // make sure the call is observed, then return OK
  vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,AAA' })

  await inlineImages(wrap)

  // called with the URL normalized from currentSrc
  expect(vi.mocked(snapFetch).mock.calls[0][0]).toBe('https://ex.com/a.png')

  // los atributos responsivos fueron removidos
  expect(img.hasAttribute('srcset')).toBe(false)
  expect(img.hasAttribute('sizes')).toBe(false)

  // y el resultado final es data:
  expect(img.src.startsWith('data:')).toBe(true)
})

  it('convierte a dataURL cuando snapFetch ok y garantiza dimensiones', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/ok.png'
    // natural sizes presentes, width/height 0 → deben fijarse
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 123 })
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 45 })
    wrap.appendChild(img)

    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,ZZZ' })
    await inlineImages(wrap)

    expect(img.src.startsWith('data:')).toBe(true)
    expect(img.width).toBe(123)
    expect(img.height).toBe(45)
  })

  it('when the first fetch fails it uses the STRING fallbackURL and keeps the estimated size', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/fails.png'
    // size data in dataset/attrs/style, used in priority order
    img.dataset.snapdomWidth = '200'
    img.dataset.snapdomHeight = '100'
    wrap.appendChild(img)

    // 1ª llamada falla, 2ª (fallback) ok
    vi.mocked(snapFetch)
      .mockResolvedValueOnce({ ok: false, data: null }) // original
      .mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,FALLBACK' }) // fallback

    await inlineImages(wrap, { fallbackURL: 'https://ex.com/fallback.png' })

    expect(img.src).toBe('data:image/png;base64,FALLBACK')
    expect(img.width).toBe(200)
    expect(img.height).toBe(100)
  })

  it('fallbackURL CALLBACK async recibe dimensiones inferidas y se aplica', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/fails2.png'
    // esta vez sin dataset/attr; que tome style → 150x60
    img.style.width = '150px'
    img.style.height = '60px'
    wrap.appendChild(img)

    vi.mocked(snapFetch)
      .mockResolvedValueOnce({ ok: false, data: null }) // original falla
      .mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,CB' }) // callback URL ok

    const cb = vi.fn(async ({ width, height, src }) => {
      expect(src).toBe('https://ex.com/fails2.png')
      expect(width).toBe(150)
      expect(height).toBe(60)
      return 'https://ex.com/fb.png'
    })

    await inlineImages(wrap, { fallbackURL: cb })

    expect(cb).toHaveBeenCalled()
    expect(img.src).toBe('data:image/png;base64,CB')
    expect(img.width).toBe(150)
    expect(img.height).toBe(60)
  })

  it('placeholders:false points the <img> at an empty image of the same size', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/down.png'
    img.style.width = '40px'
    img.style.height = '30px'
    wrap.appendChild(img)

    // fails, no fallbackURL: empty image
    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })
    await inlineImages(wrap, { placeholders: false })

    expect(wrap.firstElementChild).toBe(img)
    expect(decodeURIComponent(img.src)).toContain('width="40" height="30"></svg>')
  })

  it('processes in batches of 6 (7 images) and applies a placeholder on failure', async () => {
    // BATCH is 6 in src/modules/images.js — 7 images makes the loop iterate twice, so the
    // multi-batch path is actually exercised (the old 5-image fixture fit in one batch and
    // the boundary its title named was never crossed).
    for (let i = 0; i < 7; i++) {
      const img = document.createElement('img')
      img.src = 'https://ex.com/down.png'
      wrap.appendChild(img)
    }
    // all of them fail
    vi.mocked(snapFetch).mockResolvedValue({ ok: false, data: null })

    await inlineImages(wrap)

    // every one of them now shows the placeholder
    const imgs = [...wrap.querySelectorAll('img')]
    expect(imgs.length).toBe(7)
    expect(imgs.every(i => decodeURIComponent(i.src).includes('>img</text>'))).toBe(true)
  })

  it('falls back to the default placeholder when fallbackURL throws', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/bad.png'
    wrap.appendChild(img)

    // the original fetch fails
    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })

    const badCb = vi.fn(async () => { throw new Error('boom') })
    await inlineImages(wrap, { fallbackURL: badCb })

    expect(decodeURIComponent(img.src)).toContain('>img</text>')
  })

  it('inlines the capture root when it is itself an <img> (bare img capture)', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/bare-root.jpg'
    wrap.appendChild(img)

    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/jpeg;base64,ROOT' })

    // the <img> itself is the capture root, with no wrapper
    await inlineImages(img)

    expect(img.src).toBe('data:image/jpeg;base64,ROOT')
  })

  it('inlines the capture root when it is itself an SVG <image>', async () => {
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    image.setAttribute('href', 'https://ex.com/bare-root-svg.png')

    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,SVGROOT' })

    await inlineImages(image)

    expect(image.getAttribute('href')).toBe('data:image/png;base64,SVGROOT')
  })

  it('#341: inlines SVG <image href="https://..."> to data URL', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    img.setAttribute('href', 'https://placehold.co/150x100')
    svg.appendChild(img)
    wrap.appendChild(svg)

    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,SVGIMG' })

    await inlineImages(wrap)

    const out = wrap.querySelector('image')
    expect(out?.getAttribute('href')).toBe('data:image/png;base64,SVGIMG')
  })
})
