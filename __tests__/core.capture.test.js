import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureDOM } from '../src/core/capture.js';
// importa createContext solo si realmente lo necesitás en un test puntual
// import { createContext } from '../src/core/context.js';

afterEach(() => vi.restoreAllMocks());

describe('captureDOM edge cases', () => {
  it('throws for unsupported element (unknown nodeType)', async () => {
    const fakeNode = { nodeType: 999 };
    await expect(captureDOM(fakeNode)).rejects.toThrow();
  });

  it('throws if element is null', async () => {
    await expect(captureDOM(null)).rejects.toThrow();
  });

  it('throws error if getBoundingClientRect fails', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => { throw new Error('fail'); });

    const el = document.createElement('div');
    await expect(captureDOM(el, { fast: true })).rejects.toThrow(/fail/);
  });
});

describe('captureDOM functional', () => {
  it('captures a simple div and returns an SVG dataURL', async () => {
    const el = document.createElement('div');
    el.textContent = 'test';
    const url = await captureDOM(el, { fast: true, embedFonts: false });
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('supports scale and width/height options', async () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '50px';
    await captureDOM(el, { fast: true, scale: 2 });
    await captureDOM(el, { fast: true, width: 200 });
    await captureDOM(el, { fast: true, height: 100 });
  });

  it('supports fast=false', async () => {
    const el = document.createElement('div');
    await captureDOM(el, { fast: false, embedFonts: false });
  });

  it('supports embedFonts (stubbed)', async () => {
    // opcional: stub para que no haga IO real
    // const mod = await import('../src/modules/fonts.js');
    // vi.spyOn(mod, 'embedCustomFonts').mockResolvedValue('/* inlined */');

    const el = document.createElement('div');
    await captureDOM(el, { fast: true, embedFonts: true });
  });
});
