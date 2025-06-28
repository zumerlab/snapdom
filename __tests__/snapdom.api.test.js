import { describe, it, expect } from 'vitest';
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
});
