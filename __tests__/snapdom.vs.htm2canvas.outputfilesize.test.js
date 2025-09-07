import { describe, it, beforeEach, afterEach, afterAll } from 'vitest';
import { snapdom }  from '../src/index';
//ok

describe('Output file size snapdom vs html2canvas (cdn with averaging)', () => {
  let container;
  let html2canvas;
  let report;

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    container.style.background = 'linear-gradient(to right, red, blue)';
    container.innerHTML = '<h1>Hello Benchmark</h1><p>Testing multiple runs...</p>';
    document.body.appendChild(container);

    if (!html2canvas) {
      // Cargar html2canvas desde CDN
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = () => {
          html2canvas = window.html2canvas;
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  afterAll(() => {
    console.log(report)
  })

  it('snapdom output file size should be smaller than html2canvas', async () => {
   
    // SnapDOM capture
    const snapdomDataURL = await snapdom.toRaw(container);
    const snapdomSizeKB = (snapdomDataURL.length * 3 / 4) / 1024; // Base64 to bytes approx
  
    // html2canvas capture
    const canvas = await html2canvas(container, { logging: false });
    const html2canvasDataURL = await canvas.toDataURL();
    const html2canvasSizeKB = (html2canvasDataURL.length * 3 / 4) / 1024; // Base64 to bytes approx
  
    const differencePercent = ((html2canvasSizeKB - snapdomSizeKB) / html2canvasSizeKB) * 100;

    report =`snapDom Captured file size is ${differencePercent.toFixed(2)}% smaller compared to html2canvas (${snapdomSizeKB.toFixed(2)} KB vs. ${html2canvasSizeKB.toFixed(2)} KB)`

})

})
