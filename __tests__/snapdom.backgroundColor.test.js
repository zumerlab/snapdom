import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { snapdom } from  '../src/index';

describe('snapdom.toJpg backgroundColor option', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '100px';
    container.style.height = '100px';
    container.style.background = 'transparent';
    document.body.appendChild(container);
  });

  it('applies white background by default', async () => {
    const img = await snapdom.toJpg(container );
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    // JPEG compresses, but for a solid color it should be near white
    expect(pixel[0]).toBeGreaterThan(240);
    expect(pixel[1]).toBeGreaterThan(240);
    expect(pixel[2]).toBeGreaterThan(240);
  });

  it('applies custom background color', async () => {
    const img = await snapdom.toJpg(container, { backgroundColor: '#00ff00', dataURL: true });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    // Green check (JPEG lossy, so check near values)
    expect(pixel[0]).toBeLessThan(30);    // red
    expect(pixel[1]).toBeGreaterThan(200); // green
    expect(pixel[2]).toBeLessThan(30);    // blue
  });
});
