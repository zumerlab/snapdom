import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js';
import { cache } from '../src/core/cache.js';

// === helpers locales ===
function cleanFontEnvironment() {
  document
    .querySelectorAll('style[data-test-font], link[data-test-font]')
    .forEach(el => el.remove());
}

function addStyleTag(css) {
  const style = document.createElement('style');
  style.setAttribute('data-test-font', 'true');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/**
 * Mock seguro de document.fonts (FontFaceSet "mínimo pero compatible")
 * @param {Array<{ family:string, status:string, weight?:string, style?:string, _snapdomSrc?:string }>} fontsArray
 */
function setDocumentFonts(fontsArray = []) {
  const items = [...fontsArray];

  // iterables y helpers típicos
  const iter = function* () { yield* items; };
  const fakeSet = {
    // iterator por defecto
    [Symbol.iterator]: iter,
    // API parecida a FontFaceSet
    values: iter,
    entries: function* () { for (const it of items) yield [it.family, it]; },
    forEach(cb, thisArg) { for (const it of items) cb.call(thisArg, it, it, fakeSet); },
    has(ff) { return items.includes(ff); },
    get size() { return items.length; },
    ready: Promise.resolve(),
  };

  Object.defineProperty(document, 'fonts', {
    configurable: true,
    get() { return fakeSet; },
  });

  return () => { delete document.fonts; };
}

let restoreFonts = () => {};

beforeEach(() => {
  // cache.reset() o resetCache() según exista
  if (typeof cache.reset === 'function') cache.reset();
  if (typeof cache.resetCache === 'function') cache.resetCache();
  if (cache.font?.clear) cache.font.clear?.();
  if (cache.resource?.clear) cache.resource.clear?.();

  cleanFontEnvironment();
  vi.restoreAllMocks();
  restoreFonts = setDocumentFonts([]); // mock vacío por defecto
});

afterEach(() => {
  restoreFonts?.();
});

// ========== iconToImage ==========
describe('iconToImage', () => {
  let ctxSpy, toDataURLSpy;

  afterEach(() => {
    ctxSpy?.mockRestore?.();
    toDataURLSpy?.mockRestore?.();
  });

  it('devuelve un data URL válido con dimensiones > 0', async () => {
    ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      scale: vi.fn(),
      font: '',
      textBaseline: '',
      fillStyle: '',
      fillText: vi.fn(),
      // mide algo > 0
      measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
      // opcionalmente usado por algunas impls:
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    }));

    toDataURLSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,AA==');

    const result = await iconToImage('★', 'Arial', 'bold', 32, '#000');
    expect(result.dataUrl.startsWith('data:image/')).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});

// ========== embedCustomFonts ==========
describe('embedCustomFonts', () => {
  it('conserva @font-face con solo local() en src', async () => {
    const style = addStyleTag(`
      @font-face {
        font-family: OnlyLocal;
        src: local("Arial");
        font-style: normal;
        font-weight: normal;
      }
    `);

    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?OnlyLocal['"]?/);
    expect(css).toMatch(/src:\s*local\(["']Arial["']\)/);
    document.head.removeChild(style);
  });

  it('filtra @font-face no utilizados segun document.fonts', async () => {
    restoreFonts?.(); // reemplazamos con fuentes usadas
    restoreFonts = setDocumentFonts([
      { family: 'UsedFont', status: 'loaded', weight: 'normal', style: 'normal' },
    ]);

    addStyleTag(`
      @font-face { font-family: 'UsedFont'; src: url(data:font/woff;base64,AA==); }
      @font-face { font-family: 'UnusedFont'; src: url(data:font/woff;base64,BB==); }
    `);

    const css = await embedCustomFonts();
    expect(css).toMatch(/UsedFont/);
    expect(css).not.toMatch(/UnusedFont/);
  });

  it('embebe fuentes locales provistas', async () => {
    const css = await embedCustomFonts({
      localFonts: [{ family: 'MyLocal', src: 'data:font/woff;base64,AA==' }],
    });
    expect(css).toMatch(/font-family:\s*['"]?MyLocal['"]?/);
    expect(css).toMatch(/AA==/);
  });

  it('usa _snapdomSrc para nuevas fuentes', async () => {
    restoreFonts?.();
    restoreFonts = setDocumentFonts([
      { family: 'DynFont', status: 'loaded', weight: 'normal', style: 'normal', _snapdomSrc: 'data:font/woff;base64,CC==' },
    ]);
    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?DynFont['"]?/);
    expect(css).toMatch(/CC==/);
  });

  it('conserva @font-face con local() y sin url()', async () => {
    const style = addStyleTag(`
      @font-face {
        font-family: LocalFont;
        src: local('MyFont'), local('FallbackFont');
        font-style: italic;
        font-weight: bold;
      }
    `);

    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:\s*['"]?LocalFont['"]?/);
    expect(css).toMatch(/src:\s*local\(['"]MyFont['"]\),\s*local\(['"]FallbackFont['"]\)/);
    expect(css).toMatch(/font-style:\s*italic/);
    document.head.removeChild(style);
  });
});
