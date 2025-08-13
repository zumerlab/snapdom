import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inlineImages } from '../src/modules/images.js';

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
    // 1) Forzamos que el <img> interno de fetchImage falle inmediatamente
    const OrigImage = globalThis.Image;
    globalThis.Image = class {
      onload = null;
      onerror = null;
      set src(_) {
        // dispara error inmediatamente
        if (this.onerror) this.onerror(new Event('error'));
      }
      // decode existe pero no se usa en la rama de error
      decode() { return Promise.resolve(); }
    };

    // 2) Hacemos que el fallback por fetch falle UNA SOLA VEZ
    const mockFetch = /** @type {any} */ (globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error('network fail'));

    const img = document.createElement('img');
    img.src = 'invalid-url.png';
    container.appendChild(img);

    await inlineImages(container);

    expect(container.querySelector('div')).not.toBeNull(); // div fallback presente
    expect(container.querySelector('img')).toBeNull();     // img reemplazado

    // restaurar Image
    globalThis.Image = OrigImage;
  });
});
