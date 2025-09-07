// __tests__/utils.image.more.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackground, inlineSingleBackgroundEntry } from '../src/utils/image.js';
import { snapFetch } from '../src/modules/snapFetch.js';
import { cache } from '../src/core/cache.js';

// Silence our intentional rejections so Vitest doesn't flag them as unhandled
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || '');
    if (
      msg.includes('[SnapDOM - snapFetch] Fetch failed and no proxy provided') ||
      msg.includes('[SnapDOM - snapFetch] Recently failed (cooldown).') ||
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

  it('inlines via snapFetch on success (raster path → Image onload)', async () => {
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
// snapFetch
// -----------------------------
// -----------------------------
// snapFetch (helpers)
// -----------------------------
/**
 * @param {import('../src/modules/snapFetch.js').SnapFetchResult} r
 */
function expectOkDataURL(r) {
  expect(r.ok).toBe(true);
  expect(typeof r.data).toBe('string');
  expect(r.data).toMatch(/^data:/);
}

/**
 * @param {import('../src/modules/snapFetch.js').SnapFetchResult} r
 */
function expectOkBlob(r) {
  expect(r.ok).toBe(true);
  expect(r.data instanceof Blob).toBe(true);
}

/**
 * @param {import('../src/modules/snapFetch.js').SnapFetchResult} r
 */
function expectOkText(r) {
  expect(r.ok).toBe(true);
  expect(typeof r.data).toBe('string');
}

// -----------------------------
// snapFetch (raster path)
// -----------------------------
describe('snapFetch (raster path)', () => {
  it('resolves a DataURL when the image loads and decode succeeds', async () => {
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

    const r = await snapFetch('https://cdn.example.com/photo.jpg', { timeout: 100, as: 'dataURL' });
    expectOkDataURL(r);
    expect(r.mime).toMatch(/image\/png|image\/jpeg|image\/jpg/i);
  });

  it('uses credentials: "include" for same-origin URLs', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // first call uses our default globalThis.fetch mock; we only care about the opts it receives
    await snapFetch('/local.png', { timeout: 100, as: 'blob' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, opts] = spy.mock.calls[0];
    expect(opts.credentials).toBe('include');

    spy.mockRestore();
  });
});

// -----------------------------
// snapFetch (svg path)
// -----------------------------
describe('snapFetch (svg path)', () => {
  it('inlines SVG via direct text fetch when as:"text"', async () => {
    const r = await snapFetch('https://example.com/icon.svg', { as: 'text' });
    expectOkText(r);
    expect(String(r.data)).toMatch(/^<svg[\s>]/);
  });

  it('deduplicates in-flight fetches (single network call for concurrent requests)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Slow down first fetch so both calls overlap
    fetchSpy.mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 50));
      return {
        ok: true,
        status: 200,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        blob: async () => new Blob([new Uint8Array([137,80,78,71])], { type: 'image/png' }),
        headers: new Headers({ 'content-type': 'image/svg+xml' }),
      };
    });

    const p1 = snapFetch('https://slow.example.com/a.svg', { as: 'text' });
    const p2 = snapFetch('https://slow.example.com/a.svg', { as: 'text' });
    const [a, b] = await Promise.all([p1, p2]);

    expectOkText(a);
    expectOkText(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

 it('sets cooldown after failure and resolves ok:false; subsequent calls hit fromCache quickly', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  // Una sola falla de red es suficiente para poblar el error cache
  fetchSpy.mockRejectedValueOnce(new Error('boom'));

  const opts = { errorTTL: 5000, as: 'text' };

  // 1) Primer intento: falla y entra al error cache
  const r1 = await snapFetch('https://fail.example.com/x.svg', opts);
  expect(r1.ok).toBe(false);
  expect(['network', 'timeout', 'abort', 'http_error']).toContain(r1.reason);

  // 2) Retry inmediato con las MISMAS opciones → debe salir de cache
  fetchSpy.mockClear();
  const r2 = await snapFetch('https://fail.example.com/x.svg', opts);
  expect(r2.ok).toBe(false);
  expect(r2.fromCache).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();

  fetchSpy.mockRestore();
});


  it('uses proxy for cross-origin when provided and returns DataURL if requested', async () => {
    const f = /** @type {any} */ (globalThis.fetch);
    // La primera llamada en este test no falla; simplemente queremos chequear que se aplique el proxy y DataURL
    f.mockResolvedValueOnce({
      ok: true,
      status: 200,
      // devolvemos un PNG mínimo como blob
      blob: async () => new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }),
      text: async () => '<svg/>',
      headers: new Headers({ 'content-type': 'image/png' }),
    });

    const proxy = 'https://proxy.test/?';
    const url = 'https://blocked.example.com/asset.svg';
    const r = await snapFetch(url, { useProxy: proxy, as: 'dataURL' });

    expectOkDataURL(r);
    expect(r.url.startsWith(proxy)).toBe(true);
  });
});
