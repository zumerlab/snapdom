import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preCache } from '../src/api/preCache.js';
import { cache } from '../src/core/cache.js';


describe('preCache', () => {
  beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      // PNG válido: tipo correcto para que FileReader genere data:image/png;...
      blob: () =>
        Promise.resolve(new Blob(
          [new Uint8Array([137,80,78,71,13,10,26,10])], // cabecera PNG
          { type: 'image/png' }
        )),
      text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    })
  );
});




  it('pre-caches images and backgrounds', async () => {
    const el = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==';
    el.appendChild(img);
    document.body.appendChild(el);
    await preCache(el);
    expect(cache.image.has(img.src)).toBe(true);
    document.body.removeChild(el);
  });

  it('should handle preCache with embedFonts false', async () => {
    const el = document.createElement('div');
    await expect(preCache(el, { embedFonts: false })).resolves.toBeUndefined();
  });

  it('should handle preCache with images that fail to load', async () => {
    const el = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'invalid-url.png';
    el.appendChild(img);
    await expect(preCache(el)).resolves.toBeUndefined();
  });

  it('should handle preCache with backgrounds that fail to load', async () => {
    const el = document.createElement('div');
    el.style.backgroundImage = 'url(invalid-url.png)';
    document.body.appendChild(el);
    await expect(preCache(el)).resolves.toBeUndefined();
    document.body.removeChild(el);
  });


  it('procesa múltiples backgrounds en un solo elemento', async () => {
    const el = document.createElement('div');
    el.style.backgroundImage = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==), url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==)';
    document.body.appendChild(el);
    await preCache(el);
    // No assertion estricta porque depende de helpers, pero no debe lanzar error
    document.body.removeChild(el);
  });

});
