import { describe, it, expect, vi } from 'vitest';
import { snapdom } from '../src/api/snapdom.js';

describe('snapdom API (direct)', () => {
  it('throws on null element', async () => {
    await expect(snapdom(null)).rejects.toThrow();
  });

  it('snapdom.capture returns export methods', async () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '50px';
    document.body.appendChild(el);
    const result = await snapdom.capture(el);
    expect(result).toHaveProperty('toRaw');
    expect(result).toHaveProperty('toImg');
    expect(result).toHaveProperty('download');
    document.body.removeChild(el);
  });

  it('snapdom.toRaw, toImg, toCanvas, toBlob, toPng, toJpg, toWebp, download', async () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '50px';
    document.body.appendChild(el);
    await snapdom.toRaw(el);
    await snapdom.toImg(el);
    await snapdom.toCanvas(el);
    await snapdom.toBlob(el);
    await snapdom.toPng(el);
    await snapdom.toJpg(el);
    await snapdom.toWebp(el);
    await snapdom.download(el, { format: 'png', filename: 'test' });
    document.body.removeChild(el);
  });

  it('cubre rama Safari en toImg', async () => {
    vi.resetModules();
    vi.mock('../utils/helpers.js', async () => {
      const actual = await vi.importActual('../utils/helpers.js');
      return { ...actual, isSafari: true };
    });
    const { snapdom } = await import('../src/api/snapdom.js');
    const el = document.createElement('div');
    el.style.width = '10px';
    el.style.height = '10px';
    document.body.appendChild(el);
    // Forzar un SVG dataURL simple
    const img = new Image();
    img.width = 10;
    img.height = 10;
    img.decode = () => Promise.resolve();
    globalThis.Image = function() { return img; };
    const res = await snapdom.capture(el);
    await res.toImg();
    document.body.removeChild(el);
    vi.resetModules();
  });

  it('cubre rama de download SVG', async () => {
    const el = document.createElement('div');
    el.style.width = '10px';
    el.style.height = '10px';
    document.body.appendChild(el);
    // Mock a.click y URL.createObjectURL
    const a = document.createElement('a');
    document.body.appendChild(a);
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:url';
    const origClick = a.click;
    a.click = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    const { snapdom } = await import('../src/api/snapdom.js');
    await snapdom.download(el, { format: 'svg', filename: 'testsvg' });
    URL.createObjectURL = origCreate;
    a.click = origClick;
    document.body.removeChild(a);
    document.body.removeChild(el);
  });
});
