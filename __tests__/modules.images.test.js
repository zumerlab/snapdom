// __tests__/modules.images.more.test.js
import { describe, it, expect, beforeEach, vi, afterEach} from 'vitest'
import { inlineImages } from '../src/modules/images.js'

// mock del módulo que usa images.js
vi.mock('../src/modules/snapFetch.js', async () => {
  // devolvemos una función reemplazable por-test
  return {
    snapFetch: vi.fn(async () => ({ ok: true, data: 'data:image/png;base64,AAA' })),
  }
})
import { snapFetch } from '../src/modules/snapFetch.js'

describe('inlineImages', () => {
  let container;


if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || '';
    if (
      msg.includes('[SnapDOM - fetchImage] Fetch failed and no proxy provided') ||
      msg.includes('Image load timed out') ||
      msg.includes('[SnapDOM - fetchImage] Recently failed (cooldown).')
    ) {
      e.preventDefault(); // evita el banner de Vitest
    }
  });
}


  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    vi.restoreAllMocks();
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
    );
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('converts <img> to dataURL if the image loads', async () => {
    const img = document.createElement('img');
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==';
    container.appendChild(img);

    await inlineImages(container);

    expect(img.src.startsWith('data:image/')).toBe(true);
  });

 it('replaces <img> with a fallback if the image fails', async () => {
  const img = document.createElement('img')
  img.src = 'https://x/fail.png'
  container.appendChild(img)

  // fuerza fallo explícito de snapFetch para este caso
  vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })

  await inlineImages(container)

  expect(container.querySelector('div')).not.toBeNull() // fallback
  expect(container.querySelector('img')).toBeNull()
})


});



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

  // asegurá que vemos la llamada y luego devolvemos OK
  vi.mocked(snapFetch).mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,AAA' })

  await inlineImages(wrap)

  // se llamó con la URL normalizada desde currentSrc
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

  it('cuando primer fetch falla usa defaultImageUrl STRING como fallback y conserva tamaño estimado', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/fails.png'
    // datos de tamaño en dataset/attrs/estilo → se usan por prioridad
    img.dataset.snapdomWidth = '200'
    img.dataset.snapdomHeight = '100'
    wrap.appendChild(img)

    // 1ª llamada falla, 2ª (fallback) ok
    vi.mocked(snapFetch)
      .mockResolvedValueOnce({ ok: false, data: null }) // original
      .mockResolvedValueOnce({ ok: true, data: 'data:image/png;base64,FALLBACK' }) // fallback

    await inlineImages(wrap, { defaultImageUrl: 'https://ex.com/fallback.png' })

    expect(img.src).toBe('data:image/png;base64,FALLBACK')
    expect(img.width).toBe(200)
    expect(img.height).toBe(100)
  })

  it('defaultImageUrl CALLBACK async recibe dimensiones inferidas y se aplica', async () => {
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

    await inlineImages(wrap, { defaultImageUrl: cb })

    expect(cb).toHaveBeenCalled()
    expect(img.src).toBe('data:image/png;base64,CB')
    expect(img.width).toBe(150)
    expect(img.height).toBe(60)
  })

  it('placeholders:false genera un spacer invisible (no "img" visible)', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/down.png'
    wrap.appendChild(img)

    // falla → sin defaultImageUrl → spacer
    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })
    await inlineImages(wrap, { placeholders: false })

    const fallback = wrap.firstElementChild
    expect(fallback.tagName).toBe('DIV')
    expect(fallback.style.visibility).toBe('hidden')
    expect(fallback.textContent || '').not.toContain('img')
  })

  it('procesa en lotes de 4 (5 imágenes) y aplica placeholder por falla', async () => {
    const imgs = Array.from({ length: 5 }, (_, i) => {
      const n = document.createElement('img')
      n.src = `https://ex.com/${i}.png`
      wrap.appendChild(n)
      return n
    })
    // todas fallan
    vi.mocked(snapFetch).mockResolvedValue({ ok: false, data: null })

    await inlineImages(wrap)

    // todas reemplazadas por <div> de placeholder
    const divs = wrap.querySelectorAll('div')
    expect(divs.length).toBe(5)
  })

  it('si defaultImageUrl arroja error, cae en placeholder por defecto', async () => {
    const img = document.createElement('img')
    img.src = 'https://ex.com/bad.png'
    wrap.appendChild(img)

    // fetch del original falla
    vi.mocked(snapFetch).mockResolvedValueOnce({ ok: false, data: null })

    const badCb = vi.fn(async () => { throw new Error('boom') })
    await inlineImages(wrap, { defaultImageUrl: badCb })

    const div = wrap.querySelector('div')
    expect(div).toBeTruthy()
    expect((div?.textContent || '')).toBe('img')
  })
})
