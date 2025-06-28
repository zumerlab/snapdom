import { describe, it, expect, beforeEach } from 'vitest';
import { preCache } from '../src/api/preCache.js';
import { imageCache, bgCache, resourceCache } from '../src/core/cache.js';

describe('preCache', () => {
  beforeEach(() => {
    imageCache.clear();
    bgCache.clear();
    resourceCache.clear();
  });

  it('pre-caches images and backgrounds', async () => {
    const el = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==';
    el.appendChild(img);
    document.body.appendChild(el);
    await preCache(el);
    expect(imageCache.has(img.src)).toBe(true);
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

});
