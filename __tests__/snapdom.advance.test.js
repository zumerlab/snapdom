import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { snapdom } from  '../src/index';

describe('snapdom advanced tests', () => {
  let testElement;

  beforeEach(() => {
    testElement = document.createElement('div');
    testElement.style.width = '100px';
    testElement.style.height = '50px';
    testElement.innerHTML = '<h1>Hello World</h1>';
    document.body.appendChild(testElement);
  });

  afterEach(() => {
    document.body.removeChild(testElement);
  });

  it('should generate different SVGs for different scales', async () => {
    const svg1 = await snapdom.toImg(testElement, { scale: 1 });
    const svg2 = await snapdom.toImg(testElement, { scale: 2 });
    expect(svg1).not.toBe(svg2);
  });

  it('captured SVG should contain inner text content', async () => {
    const svgDataUrl = await snapdom.toRaw(testElement);
    const svgText = decodeURIComponent(svgDataUrl.split(',')[1]);
    expect(svgText).toContain('Hello World');
  });

  it('should throw an error if element is null', async () => {
    await expect(() => snapdom.toRaw(null)).rejects.toThrow();
  });

  it('should generate SVG with correct attributes', async () => {
    const svgDataUrl = await snapdom.toRaw(testElement);
    const svgText = decodeURIComponent(svgDataUrl.split(',')[1]);
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('100');
    expect(svg.getAttribute('height')).toBe('50');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 50');
  });

  it('snapdom.toBlob should contain valid SVG content', async () => {
    const blob = await snapdom.toBlob(testElement);
    const text = await blob.text();
    expect(text).toContain('<svg');
    expect(text).toContain('</svg>');
  });

  it('should replace iframes with fallback visuals', async () => {
  const iframe = document.createElement('iframe');
  iframe.style.width = '200px';
  iframe.style.height = '100px';
  testElement.appendChild(iframe);

  const svgDataUrl = await snapdom.toRaw(testElement);
  const svgText = decodeURIComponent(svgDataUrl.split(',')[1]);

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  // No debe haber iframes en el SVG
  expect(doc.querySelectorAll('iframe').length).toBe(0);

  // Buscamos divs con estilo inline que contengan repeating-linear-gradient
  const fallbackDivs = Array.from(doc.querySelectorAll('div')).filter(div => {
    const styleAttr = div.getAttribute('style') || '';
    return styleAttr.includes('repeating-linear-gradient');
  });

  expect(fallbackDivs.length).toBeGreaterThan(0);
});

  
});
