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
  it('genera un dataURL y dimensiones para un carácter unicode', async () => {
    const result = await iconToImage('★', 'Arial', 'bold', 32, '#000');
    expect(result.dataUrl.startsWith('data:image/')).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('maneja diferentes pesos y colores de fuente', async () => {
    const result = await iconToImage('★', 'Arial', 700, 40, '#ff0000');
    expect(result.dataUrl.startsWith('data:image/')).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('usa valores por defecto si no hay métricas', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function () {
      return {
        font: '',
        scale: vi.fn(),
        textAlign: '',
        textBaseline: '',
        fillStyle: '',
        fillText: vi.fn(),
        measureText: () => ({ width: 10 }),
      };
    };

    try {
      const result = await iconToImage('★', 'Arial', 'bold', 32, '#000');
      expect(result.dataUrl.startsWith('data:image/')).toBe(true);
      expect(result.width).toBeGreaterThan(0); // width debería seguir siendo > 0
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
