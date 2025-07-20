import { describe, it, expect, beforeEach, vi } from 'vitest';
import { iconToImage, embedCustomFonts } from '../src/modules/fonts.js';
import { cache } from '../src/core/cache.js';

// Utilidad para limpiar estilos y links antes de cada test
function cleanFontEnvironment() {
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(s => s.remove());
}

function addStyleTag(css) {
  const style = document.createElement('style');
  style.setAttribute('data-test-style', 'true');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
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
        scale: vi.fn(),
        textAlign: '',
        textBaseline: '',
        fillStyle: '',
        fillText: vi.fn(),
        measureText: () => ({ width: 10 })
      };
    };
    const url = await iconToImage('★', 'Arial', 'bold', 32, '#000');
    expect(url.startsWith('data:image/')).toBe(true);
    HTMLCanvasElement.prototype.getContext = orig;
  });
});

describe('embedCustomFonts', () => {
  beforeEach(() => {
    cache.reset();
    cache.font.clear();
    cache.resource.clear();
    cleanFontEnvironment();
    vi.restoreAllMocks();
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
