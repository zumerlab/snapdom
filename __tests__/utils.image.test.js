// __tests__/utils.image.more.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackground, inlineSingleBackgroundEntry, fetchImage } from '../src/utils/image.js';
import { cache } from '../src/core/cache.js';

// Silence our intentional rejections so Vitest doesn't flag them as unhandled
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || '');
    if (
      msg.includes('[SnapDOM - fetchImage] Fetch failed and no proxy provided') ||
      msg.includes('[SnapDOM - fetchImage] Recently failed (cooldown).') ||
      msg.includes('Image load timed out')
    ) {
      e.preventDefault();
    }
  });
}

function clearCaches() {
  cache.image?.clear?.();
  cache.background?.clear?.();
  cache.resource?.clear?.();
  cache.font?.clear?.();
}

let OrigImage;
let OrigFetch;

beforeEach(() => {
  vi.restoreAllMocks();
  clearCaches();

  OrigImage = globalThis.Image;
  OrigFetch = globalThis.fetch;

  // Default fetch: OK for both blob() and text() cases
  globalThis.fetch = vi.fn(async (url, opts) => ({
    ok: true,
    status: 200,
    blob: async () =>
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), // valid PNG header
    text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
  }));
});

afterEach(() => {
  globalThis.Image = OrigImage;
  globalThis.fetch = OrigFetch;
});

// -----------------------------
// createBackground
// -----------------------------
describe('createBackground', () => {
  it('returns the original canvas when no color is provided', () => {
    const c = document.createElement('canvas');
    c.width = 10; c.height = 10;
    const out = createBackground(c, '');
    expect(out).toBe(c);
  });

  it('returns the original canvas when canvas has zero size', () => {
    const c = document.createElement('canvas');
    c.width = 0; c.height = 0;
    const out = createBackground(c, 'red');
    expect(out).toBe(c);
  });

  it('paints a solid background and keeps dimensions', () => {
    const base = document.createElement('canvas');
    base.width = 4; base.height = 4;
    const out = createBackground(base, 'rgb(255,0,0)');
    expect(out).not.toBe(base);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);

    const ctx = out.getContext('2d');
    const px = ctx.getImageData(0, 0, 1, 1).data;
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);
    expect(px[3]).toBe(255);
  });
});

// -----------------------------
// inlineSingleBackgroundEntry
// -----------------------------
describe('inlineSingleBackgroundEntry', () => {
  it('returns gradients and "none" unchanged', async () => {
    await expect(inlineSingleBackgroundEntry('linear-gradient(white, black)')).resolves.toBe('linear-gradient(white, black)');
    await expect(inlineSingleBackgroundEntry('none')).resolves.toBe('none');
  });

  it('returns non-url entries unchanged', async () => {
    await expect(inlineSingleBackgroundEntry('foo bar baz')).resolves.toBe('foo bar baz');
  });

  it('returns cached data URL when present in cache.background', async () => {
    const url = 'https://example.com/img.png';
    const data = 'data:image/png;base64,AAA';
    cache.background.set(url, data);
    const out = await inlineSingleBackgroundEntry(`url("${url}")`);
    expect(out).toBe(`url("${data}")`);
  });

  it('inlines via fetchImage on success (raster path → Image onload)', async () => {
    // Simulate an <img> that loads immediately with non-zero size
    globalThis.Image = class {
      constructor() { setTimeout(() => this.onload && this.onload(), 0); }
      set src(_) {}
      decode() { return Promise.resolve(); }
      get naturalWidth() { return 2; }
      get naturalHeight() { return 2; }
      get width() { return 2; }
      get height() { return 2; }
      set crossOrigin(_) {}
      set onload(_) {}
      set onerror(_) {}
    };

    const out = await inlineSingleBackgroundEntry('url("https://assets.example.com/a.png")');
    expect(out).toMatch(/^url\("data:image\/png;base64,/);
  });

  it('degrades to "none" if inlining fails (no proxy)', async () => {
    // Force <img> error and make fetch fallback fail (no proxy)
    globalThis.Image = class {
      constructor() { setTimeout(() => this.onerror && this.onerror(), 0); }
      set src(_) {}
      set crossOrigin(_) {}
      set onload(_) {}
      set onerror(_) {}
    };
    const mockFetch = /** @type {any} */ (globalThis.fetch);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob([], { type: 'image/png' }) });

    const out = await inlineSingleBackgroundEntry('url("https://bad.example.com/x.png")');
    expect(out).toBe('none');
  });
});

// -----------------------------
// fetchImage
// -----------------------------
describe('fetchImage (raster path)', () => {
  it('resolves a data URL when the image loads and decodes', async () => {
    globalThis.Image = class {
      constructor() { setTimeout(() => this.onload && this.onload(), 0); }
      set src(_) {}
      decode() { return Promise.resolve(); }
      get naturalWidth() { return 3; }
      get naturalHeight() { return 4; }
      set crossOrigin(_) {}
      set onload(_) {}
      set onerror(_) {}
    };

    const out = await fetchImage('https://cdn.example.com/photo.jpg', { timeout: 100 });
    expect(out).toMatch(/^data:image\/png;base64,/);
  });

  it('uses "use-credentials" for same-origin URLs (crossOrigin assignment)', async () => {
    let assigned = '';
    globalThis.Image = class {
      constructor() { setTimeout(() => this.onload && this.onload(), 0); }
      set src(_) {}
      decode() { return Promise.resolve(); }
      get naturalWidth() { return 1; }
      get naturalHeight() { return 1; }
      set crossOrigin(v) { assigned = v; }
      set onload(_) {}
      set onerror(_) {}
    };

    await fetchImage('/local.png', { timeout: 100 });
    expect(assigned).toBe('use-credentials');
  });
});

describe('fetchImage (svg path)', () => {
  it('inlines SVG via direct text fetch', async () => {
    const out = await fetchImage('https://example.com/icon.svg');
    expect(out).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });

  it('returns cached value without fetching again', async () => {
    cache.image.set('https://site.com/logo.svg', 'data:image/svg+xml;charset=utf-8,AAA');
    const spy = vi.spyOn(globalThis, 'fetch'); // should not be called
    const out = await fetchImage('https://site.com/logo.svg');
    expect(out).toBe('data:image/svg+xml;charset=utf-8,AAA');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('deduplicates in-flight fetches (single fetch for concurrent calls)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Slow down the first fetch so both calls overlap
    fetchSpy.mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 50));
      return {
        ok: true,
        status: 200,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        blob: async () => new Blob([new Uint8Array([137,80,78,71])], { type: 'image/png' }),
      };
    });

    const p1 = fetchImage('https://slow.example.com/a.svg');
    const p2 = fetchImage('https://slow.example.com/a.svg');
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toMatch(/^data:image\/svg\+xml/);
    expect(b).toMatch(/^data:image\/svg\+xml/);
    // Only one network call for the same URL while in-flight
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('sets cooldown after failure and rejects subsequent calls quickly', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  // 1) Direct text fetch (SVG) falla
  fetchSpy.mockRejectedValueOnce(new Error('boom'));

  // 2) Fallback (blob) también falla (sin proxy): ok:false
  fetchSpy.mockResolvedValueOnce({
    ok: false,
    status: 500,
    blob: async () => new Blob([], { type: 'image/png' }),
    text: async () => '',
  });

  await expect(fetchImage('https://fail.example.com/x.svg', { errorTTL: 5000 }))
    .rejects.toThrow('[SnapDOM - fetchImage] Fetch failed and no proxy provided');

  // Retry inmediato debe golpear cooldown y no invocar fetch de nuevo
  fetchSpy.mockClear();
  await expect(fetchImage('https://fail.example.com/x.svg'))
    .rejects.toThrow('Recently failed (cooldown).');
  expect(fetchSpy).not.toHaveBeenCalled();

  fetchSpy.mockRestore();
});


  it('falls back to proxy when direct fetch fails and returns image data URL', async () => {
    const f = /** @type {any} */ (globalThis.fetch);
    // 1) Direct text fetch fails for the SVG path
    f.mockRejectedValueOnce(new Error('direct fail'));
    // 2) Fallback (blob) succeeds via proxy
    f.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      text: async () => '<svg/>',
    });

    const out = await fetchImage('https://blocked.example.com/asset.svg', {
      useProxy: 'https://proxy.test/?',
    });
    expect(out).toMatch(/^data:image\/png;base64,/);
  });
});
