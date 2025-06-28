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
});
