import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inlineImages } from '../src/modules/images.js';

describe('inlineImages', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('converts <img> to dataURL if the image loads', async () => {
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==';
    container.appendChild(img);
    await inlineImages(container);
    expect(img.src.startsWith('data:image/')).toBe(true);
  });

  it('replaces <img> with a fallback if the image fails', async () => {
    const img = document.createElement('img');
    img.src = 'invalid-url.png';
    container.appendChild(img);
    await inlineImages(container);
    expect(container.querySelector('div')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
