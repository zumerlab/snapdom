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

  it('snapdom.toBlob supports type options ', async () => {
  const el = document.createElement('div');
  el.style.width = '50px';
  el.style.height = '30px';
  document.body.appendChild(el);

  const result = await snapdom.capture(el);

  const pngBlob = await result.toBlob({ type: 'png' });
  expect(pngBlob).toBeInstanceOf(Blob);
  expect(pngBlob.type).toBe('image/png');

  const jpgBlob = await result.toBlob({ type: 'jpeg', quality: 0.8 });
  expect(jpgBlob).toBeInstanceOf(Blob);
  expect(jpgBlob.type).toBe('image/jpeg');

  const webpBlob = await result.toBlob({ type: 'webp', quality: 0.9 });
  expect(webpBlob).toBeInstanceOf(Blob);
  expect(webpBlob.type).toBe('image/webp');

  // default fallback
  const svgBlob = await result.toBlob();
  expect(svgBlob).toBeInstanceOf(Blob);
  expect(svgBlob.type).toBe('image/svg+xml');

  document.body.removeChild(el);
});

it('toPng, toJpg, toWebp return HTMLImageElement with  URLs', async () => {
  const el = document.createElement('div');
  el.style.width = '60px';
  el.style.height = '40px';
  document.body.appendChild(el);
  const snap = await snapdom.capture(el);

  const pngImg = await snap.toPng();
  expect(pngImg).toBeInstanceOf(HTMLImageElement);
  expect(typeof pngImg.src).toBe('string');
expect(pngImg.src.startsWith('data:image/png')).toBe(true);

  const jpgImg = await snap.toJpg();
  expect(jpgImg).toBeInstanceOf(HTMLImageElement);
  expect(typeof jpgImg.src).toBe('string');
expect(jpgImg.src.startsWith('data:image/jpeg')).toBe(true);

  const webpImg = await snap.toWebp();
  expect(webpImg).toBeInstanceOf(HTMLImageElement);
  expect(typeof webpImg.src).toBe('string');
expect(webpImg.src.startsWith('data:image/webp')).toBe(true);
  document.body.removeChild(el);
});

test('snapdom should support exclude option to filter out elements by CSS selectors', async () => {
  const el = document.createElement('div');
  el.innerHTML = `
    <h1>Title</h1>
    <div class="exclude-me">Should be excluded</div>
    <div data-private="true">Private data</div>
    <p>This should remain</p>
  `;
  document.body.appendChild(el);
  
  const result = await snapdom(el, { exclude: ['.exclude-me', '[data-private]'] });
  
  const svg = result.toRaw();
  expect(svg).not.toContain('Should be excluded');
  expect(svg).not.toContain('Private data');
  expect(svg).toContain('Title');
  expect(svg).toContain('This should remain');
});

test('snapdom should support filter option to exclude elements with custom logic', async () => {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="level-1">Level 1
      <div class="level-2">Level 2
        <div class="level-3">Level 3</div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  const result = await snapdom(target, { 
    filter: (element) => !element.classList.contains('level-3')
  });
  
  const svg = result.toRaw();
  expect(svg).toContain('Level 1');
  expect(svg).toContain('Level 2');
  expect(svg).not.toContain('Level 3');
});

test('snapdom should support combining exclude and filter options', async () => {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="exclude-by-selector">Exclude by selector</div>
    <div class="exclude-by-filter">Exclude by filter</div>
    <div class="keep-me">Keep this content</div>
  `;
  document.body.appendChild(el);

  const result = await snapdom(el, { 
    exclude: ['.exclude-by-selector'],
    filter: (element) => !element.classList.contains('exclude-by-filter')
  });
  
  const svg = result.toRaw();
  expect(svg).not.toContain('Exclude by selector');
  expect(svg).not.toContain('Exclude by filter');
  expect(svg).toContain('Keep this content');
});

});
