import { describe, it, expect, vi, beforeEach } from 'vitest';
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js';
import { cache } from '../src/core/cache.js';

// === helpers locales ===
function cleanFontEnvironment() {
  document.querySelectorAll('style[data-test-font], link[data-test-font]').forEach(el => el.remove());
}

function addStyleTag(css) {
  const style = document.createElement('style');
  style.setAttribute('data-test-font', 'true');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/**
 * Mock seguro de document.fonts (FontFaceSet es read-only).
 * @param {Array} fontsArray - elementos tipo { family, status, weight, style, _snapdomSrc? }
 */
function setDocumentFonts(fontsArray = []) {
  const fakeSet = [...fontsArray];
  // iterable
  fakeSet[Symbol.iterator] = Array.prototype[Symbol.iterator];
  // ready
  fakeSet.ready = Promise.resolve();
  // define getter configurable
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    get() { return fakeSet; }
  });
}

describe('iconToImage', () => {
  it('devuelve un data URL válido con dimensiones > 0', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        scale: vi.fn(),
        font: '',
        textBaseline: '',
        fillStyle: '',
        fillText: vi.fn(),
        measureText: () => ({ width: 10 }),
      };
    };

    try {
      const result = await iconToImage('★', 'Arial', 'bold', 32, '#000');
      expect(result.dataUrl.startsWith('data:image/')).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });
});

describe('embedCustomFonts', () => {
  beforeEach(() => {
    cache.reset();
    cache.font.clear();
    cache.resource.clear();
    cleanFontEnvironment();
    vi.restoreAllMocks();
    setDocumentFonts([]); // inicializamos el mock vacío
  });

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
    expect(css).toMatch(/font-family:\s*OnlyLocal/);
    expect(css).toMatch(/src:\s*local\(["']Arial["']\)/);
    document.head.removeChild(style);
  });

  it('filtra @font-face no utilizados segun document.fonts', async () => {
    setDocumentFonts([
      { family: 'UsedFont', status: 'loaded', weight: 'normal', style: 'normal' }
    ]);
    addStyleTag(`
      @font-face {font-family: 'UsedFont'; src: url(data:font/woff;base64,AA==);}
      @font-face {font-family: 'UnusedFont'; src: url(data:font/woff;base64,BB==);}
    `);
    const css = await embedCustomFonts();
    expect(css).toMatch(/UsedFont/);
    expect(css).not.toMatch(/UnusedFont/);
  });

  it('embebe fuentes locales provistas', async () => {
  const css = await embedCustomFonts({
    localFonts: [
      { family: 'MyLocal', src: 'data:font/woff;base64,AA==' }
    ]
  });
  expect(css).toMatch(/font-family:'MyLocal'/);
  expect(css).toMatch(/AA==/);
});

  it('usa _snapdomSrc para nuevas fuentes', async () => {
    setDocumentFonts([
      { family: 'DynFont', status: 'loaded', weight: 'normal', style: 'normal', _snapdomSrc: 'data:font/woff;base64,CC==' }
    ]);
    const css = await embedCustomFonts();
    expect(css).toMatch(/font-family:'DynFont'/);
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
    expect(css).toMatch(/font-family:\s*LocalFont/);
    expect(css).toMatch(/src:\s*local\(['"]MyFont['"]\),\s*local\(['"]FallbackFont['"]\)/);
    expect(css).toMatch(/font-style:\s*italic/);
    document.head.removeChild(style);
  });
});
