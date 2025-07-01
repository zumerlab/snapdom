import { describe, it, expect, beforeEach, vi } from 'vitest';
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js';

// Utility to clean styles and links before each test
function cleanFontEnvironment() {
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(s => s.remove());
}

describe('iconToImage', () => {
  it('generates a dataURL for a unicode character', async () => {
    const url = await iconToImage('\u2605', 'Arial', 'bold', 32, '#000');
    expect(url.startsWith('data:image/')).toBe(true);
  });

  it('handles different font weights and colors', async () => {
    const url = await iconToImage('\u2605', 'Arial', 700, 40, '#ff0000');
    expect(url.startsWith('data:image/')).toBe(true);
  });

  it('uses default values if there are no metrics', async () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function() {
      return {
        font: '',
        scale: vi.fn(), // required mock
        textAlign: '',
        textBaseline: '',
        fillStyle: '',
        fillText: vi.fn(),
        measureText: () => ({ width: 10 }) // no ascent or descent
      };
    };
    const url = await iconToImage('\u2605', 'Arial', 'bold', 32, '#000');
    expect(url.startsWith('data:image/')).toBe(true);
    HTMLCanvasElement.prototype.getContext = orig;
  });
});

describe('embedCustomFonts', () => {
  beforeEach(() => {
    cleanFontEnvironment();
    vi.restoreAllMocks();
  });

  it('returns a CSS string (may be empty if there are no fonts)', async () => {
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');
  });

  it('works with ignoreIconFonts=false', async () => {
    const css = await embedCustomFonts({ ignoreIconFonts: false });
    expect(typeof css).toBe('string');
  });

  it('handles fonts already present in the DOM', async () => {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: testfont; src: url("data:font/woff;base64,AAAA"); }`;
    document.head.appendChild(style);
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts();
    expect(css).toContain('testfont');
    document.head.removeChild(style);
  });

  it('handles fetch error for font URL', async () => {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: testfont; src: url("https://notfound/font.woff"); }`;
    document.head.appendChild(style);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts();
    expect(css).toContain('testfont');
    document.head.removeChild(style);
    vi.unstubAllGlobals();
  });

  it('handles FileReader error', async () => {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: testfont; src: url("https://test.com/font.woff"); }`;
    document.head.appendChild(style);
    const origFetch = window.fetch;
    window.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve('blob') });
    const origFileReader = window.FileReader;
    window.FileReader = class {
      readAsDataURL() { throw new Error('fail'); }
      set onload(_){}
    };
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts();
    expect(css).toContain('testfont');
    document.head.removeChild(style);
    window.fetch = origFetch;
    window.FileReader = origFileReader;
  });

  it('inserts style tag when preCached is true', async () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = `@font-face { font-family: testfont; src: url("data:font/woff;base64,AAAA"); }`;
    document.head.appendChild(styleEl);
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts({ preCached: true });
    const style = document.head.querySelector('style[data-snapdom="embedFonts"]');
    expect(style).not.toBeNull();
    expect(style.textContent).toBe(css);
    style.remove();
    document.head.removeChild(styleEl);
  });

  it('handles @import in <style> and fetch error', async () => {
    const style = document.createElement('style');
    style.textContent = `@import url('https://test.com/imported.css');`;
    document.head.appendChild(style);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');
    document.head.removeChild(style);
    vi.unstubAllGlobals();
  });

  it('handles fetch error for <link rel="stylesheet">', async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://test.com/bad.css';
    document.head.appendChild(link);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');
    document.head.removeChild(link);
    vi.unstubAllGlobals();
  });

  it('uses resourceCache for dynamic font', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'https://test.com/font.woff' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.set('https://test.com/font.woff', 'data:font/woff;base64,AAAA');
    processedFontURLs.clear();
    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?(dynfont|testfont)['"]?/);
    resourceCache.clear();
    processedFontURLs.clear();
  });

  it('fetch+FileReader for dynamic font', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'https://test.com/font.woff' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.clear();
    processedFontURLs.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve('blob') });
    globalThis.FileReader = class {
      readAsDataURL(blob) { setTimeout(() => this.onload({ target: { result: 'data:font/woff;base64,BBBB' } }), 0); }
      set onload(cb) { this._onload = cb; }
      get onload() { return this._onload; }
    };
    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?(dynfont|testfont)['"]?/);
    resourceCache.clear();
    processedFontURLs.clear();
    delete globalThis.fetch;
    delete globalThis.FileReader;
  });

  it('handles dynamic fetch error', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'https://test.com/font.woff' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.clear();
    processedFontURLs.clear();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const css = await embedCustomFonts();
    // May not generate anything if fetch fails, but should not throw error
    expect(typeof css).toBe('string');
    resourceCache.clear();
    processedFontURLs.clear();
    delete globalThis.fetch;
  });

  it('inserts <style> when preCached and there is CSS', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'data:font/woff;base64,AAAA' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.clear();
    processedFontURLs.clear();
    const css = await embedCustomFonts({ preCached: true });
    const style = document.head.querySelector('style[data-snapdom="embedFonts"]');
    expect(style).not.toBeNull();
    expect(style.textContent).toBe(css);
    style.remove();
    resourceCache.clear();
    processedFontURLs.clear();
  });

  it('covers the catch for accessing stylesheet (Cannot access stylesheet)', async () => {
    // Mock of a stylesheet that throws error when accessing cssRules
    const badSheet = {
      href: 'https://externo.com/estilo.css',
      get cssRules() { throw new Error('No access'); }
    };
    const origSheets = Object.getOwnPropertyDescriptor(document, 'styleSheets');
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => [badSheet]
    });
    const spy = vi.spyOn(console, 'warn');
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');
    expect(spy).toHaveBeenCalledWith(
      '[snapdom] Cannot access stylesheet',
      'https://externo.com/estilo.css',
      expect.any(Error)
    );
    // Restore
    if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
    spy.mockRestore();
  });

  it('covers the branch of processedFontURLs (dynamic fetch without cache or processed)', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'https://test.com/font.woff' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.clear();
    processedFontURLs.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve('blob') });
    globalThis.FileReader = class {
      readAsDataURL(blob) { setTimeout(() => this.onload({ target: { result: 'data:font/woff;base64,ZZZZ' } }), 0); }
      set onload(cb) { this._onload = cb; }
      get onload() { return this._onload; }
    };
    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?dynfont['"]?/);
    resourceCache.clear();
    processedFontURLs.clear();
    delete globalThis.fetch;
    delete globalThis.FileReader;
  });

    it('covers injectLinkIfMissing when the sheet is already loaded', async () => {
    const href = 'https://cdn.test.com/already-loaded.css';

    // Simulate that the sheet is already in document.styleSheets
    const origSheets = Object.getOwnPropertyDescriptor(document, 'styleSheets');
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => [{ href }]
    });

    // Insert <style> with @import using that href (embedCustomFonts will invoke injectLinkIfMissing)
    const style = document.createElement('style');
    style.textContent = `@import url('${href}');`;
    document.head.appendChild(style);

    // Execute and verify that it does not fail (and covers the early return)
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');

    // Cleanup
    document.head.removeChild(style);
    if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
  });

  it('covers the onload and onerror callbacks of injectLinkIfMissing', async () => {
  const href = 'https://cdn.test.com/manual.css';

  // Insert <style> with @import to provoke injectLinkIfMissing
  const style = document.createElement('style');
  style.textContent = `@import url('${href}');`;
  document.head.appendChild(style);

  // Mock document.styleSheets so it does not simulate sheet already loaded
  const origSheets = Object.getOwnPropertyDescriptor(document, 'styleSheets');
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    get: () => []
  });

  // Execute embedCustomFonts in parallel to intercept the injected <link>
  const promise = embedCustomFonts();

  // Wait for a tick for the <link> to be inserted
  await new Promise(r => setTimeout(r, 10));

  const injected = Array.from(document.querySelectorAll('link[data-snapdom="injected-import"]')).find(l => l.href === href);
  expect(injected).not.toBeNull();

  // Manually trigger onload and onerror
  injected.onload();
  injected.onerror();

  const css = await promise;
  expect(typeof css).toBe('string');

  // Cleanup
  document.head.removeChild(style);
  injected.remove();
  if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
});
it('covers the branch that ignores icon fonts with ignoreIconFonts=true', async () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://use.fontawesome.com/icons.css'; // Typical icon font URL
  document.head.appendChild(link);

  const css = await embedCustomFonts({ ignoreIconFonts: true });
  expect(typeof css).toBe('string');

  document.head.removeChild(link);
});



});
