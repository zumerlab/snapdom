import { describe, it, expect, beforeEach, vi } from 'vitest';
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js';

// Utilidad para limpiar estilos y links antes de cada test
function cleanFontEnvironment() {
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(s => s.remove());
}

describe('iconToImage', () => {
  it('genera un dataURL para un carácter unicode', async () => {
    const url = await iconToImage('★', 'Arial', 'bold', 32, '#000');
    expect(url.startsWith('data:image/')).toBe(true);
  });

  it('maneja diferentes pesos y colores de fuente', async () => {
    const url = await iconToImage('★', 'Arial', 700, 40, '#ff0000');
    expect(url.startsWith('data:image/')).toBe(true);
  });

  it('usa valores por defecto si no hay métricas', async () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function() {
      return {
        font: '',
        scale: vi.fn(), // mock necesario
        textAlign: '',
        textBaseline: '',
        fillStyle: '',
        fillText: vi.fn(),
        measureText: () => ({ width: 10 }) // sin ascent ni descent
      };
    };
    const url = await iconToImage('★', 'Arial', 'bold', 32, '#000');
    expect(url.startsWith('data:image/')).toBe(true);
    HTMLCanvasElement.prototype.getContext = orig;
  });
});

describe('embedCustomFonts', () => {
  beforeEach(() => {
    cleanFontEnvironment();
    vi.restoreAllMocks();
  });

  it('devuelve un string CSS (puede ser vacío si no hay fuentes)', async () => {
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');
  });

  it('funciona con ignoreIconFonts=false', async () => {
    const css = await embedCustomFonts({ ignoreIconFonts: false });
    expect(typeof css).toBe('string');
  });

  it('maneja fuentes ya presentes en el DOM', async () => {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: testfont; src: url("data:font/woff;base64,AAAA"); }`;
    document.head.appendChild(style);
    await new Promise(r => setTimeout(r, 10));
    const css = await embedCustomFonts();
    expect(css).toContain('testfont');
    document.head.removeChild(style);
  });

  it('maneja error de fetch para url de fuente', async () => {
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

  it('maneja error de FileReader', async () => {
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

  it('inserta style tag cuando preCached es true', async () => {
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

  it('maneja @import en <style> y error de fetch', async () => {
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

  it('maneja error de fetch para <link rel="stylesheet">', async () => {
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

  it('usa resourceCache para fuente dinámica', async () => {
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

  it('fetch+FileReader para fuente dinámica', async () => {
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

  it('maneja error de fetch dinámico', async () => {
    const fakeFont = { family: 'dynfont', status: 'loaded', _snapdomSrc: 'https://test.com/font.woff' };
    Object.defineProperty(document, 'fonts', { value: [fakeFont], configurable: true });
    const { resourceCache, processedFontURLs } = await import('../src/core/cache.js');
    resourceCache.clear();
    processedFontURLs.clear();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const css = await embedCustomFonts();
    // Puede que no se genere nada si fetch falla, pero no debe lanzar error
    expect(typeof css).toBe('string');
    resourceCache.clear();
    processedFontURLs.clear();
    delete globalThis.fetch;
  });

  it('inserta <style> cuando preCached y hay CSS', async () => {
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

  it('cubre el catch de acceso a stylesheet (Cannot access stylesheet)', async () => {
    // Mock de una hoja de estilos que lanza error al acceder a cssRules
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
    // Restaurar
    if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
    spy.mockRestore();
  });

  it('cubre la rama de processedFontURLs (fetch dinámico sin cache ni processed)', async () => {
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

    it('cubre injectLinkIfMissing cuando la hoja ya está cargada', async () => {
    const href = 'https://cdn.test.com/already-loaded.css';

    // Simular que la hoja ya está en document.styleSheets
    const origSheets = Object.getOwnPropertyDescriptor(document, 'styleSheets');
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => [{ href }]
    });

    // Insertar <style> con @import que use ese href (embedCustomFonts invocará injectLinkIfMissing)
    const style = document.createElement('style');
    style.textContent = `@import url('${href}');`;
    document.head.appendChild(style);

    // Ejecutar y verificar que no falle (y cubra el early return)
    const css = await embedCustomFonts();
    expect(typeof css).toBe('string');

    // Limpieza
    document.head.removeChild(style);
    if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
  });

  it('cubre los callbacks onload y onerror de injectLinkIfMissing', async () => {
  const href = 'https://cdn.test.com/manual.css';

  // Insertar <style> con @import para provocar injectLinkIfMissing
  const style = document.createElement('style');
  style.textContent = `@import url('${href}');`;
  document.head.appendChild(style);

  // Mockear document.styleSheets para que no simule hoja ya cargada
  const origSheets = Object.getOwnPropertyDescriptor(document, 'styleSheets');
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    get: () => []
  });

  // Ejecutar embedCustomFonts en paralelo para interceptar el <link> inyectado
  const promise = embedCustomFonts();

  // Esperar un tick para que el <link> se inserte
  await new Promise(r => setTimeout(r, 10));

  const injected = Array.from(document.querySelectorAll('link[data-snapdom="injected-import"]')).find(l => l.href === href);
  expect(injected).not.toBeNull();

  // Disparar manualmente onload y onerror
  injected.onload();
  injected.onerror();

  const css = await promise;
  expect(typeof css).toBe('string');

  // Limpieza
  document.head.removeChild(style);
  injected.remove();
  if (origSheets) Object.defineProperty(document, 'styleSheets', origSheets);
});
it('cubre el branch que ignora icon fonts con ignoreIconFonts=true', async () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://use.fontawesome.com/icons.css'; // URL típica de icon font
  document.head.appendChild(link);

  const css = await embedCustomFonts({ ignoreIconFonts: true });
  expect(typeof css).toBe('string');

  document.head.removeChild(link);
});



});
