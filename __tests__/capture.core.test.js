import { describe, it, expect, vi } from 'vitest';
import { captureDOM } from '../src/core/capture.js';

describe('captureDOM edge cases', () => {
  it('throws for unsupported element (unknown nodeType)', async () => {
    // Simulate a node with an invalid nodeType
    const fakeNode = { nodeType: 999 };
    await expect(captureDOM(fakeNode)).rejects.toThrow();
  });

  it('throws if element is null', async () => {
    await expect(captureDOM(null)).rejects.toThrow();
  });

  it('throws error if getBoundingClientRect fails', async () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => { throw new Error('fail'); });
    await expect(captureDOM(el)).rejects.toThrow('fail');
  });
});

describe('captureDOM functional', () => {
  it('captures a simple div and returns an SVG dataURL', async () => {
    const el = document.createElement('div');
    el.textContent = 'test';
    const url = await captureDOM(el);
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('supports scale and width/height options', async () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '50px';
    await captureDOM(el, { scale: 2 });
    await captureDOM(el, { width: 200 });
    await captureDOM(el, { height: 100 });
  });

  it('supports fast=false', async () => {
    const el = document.createElement('div');
    await captureDOM(el, { fast: false });
  });

  it('supports embedFonts', async () => {
    const el = document.createElement('div');
    await captureDOM(el, { embedFonts: true });
  });
});
