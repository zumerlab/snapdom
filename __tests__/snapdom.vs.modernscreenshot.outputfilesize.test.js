import { describe, it, beforeEach, afterEach, afterAll } from 'vitest';
import { domToDataUrl} from 'https://unpkg.com/modern-screenshot';
import { snapdom }  from '../src/index';
//ok

describe('Output file size snapdom vs modern-screeenshot (cdn with averaging)', () => {
  let container;

  let report;

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    container.style.background = 'linear-gradient(to right, red, blue)';
    container.innerHTML = '<h1>Hello Benchmark</h1><p>Testing multiple runs...</p>';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  afterAll(() => {
    console.log(report)
  })

  it('snapdom output file size should be smaller than modern-screenshot', async () => {
   
    // SnapDOM capture
    const snapdomDataURL = await snapdom.toRaw(container, {compress: true});
    const snapdomSizeKB = (snapdomDataURL.length * 3 / 4) / 1024; // Base64 to bytes approx
  
    // domToDataUrl capture
    const domToDataUrlDataURL = await domToDataUrl(container);
    const domToDataUrlSizeKB = (domToDataUrlDataURL.length * 3 / 4) / 1024; // Base64 to bytes approx
  
    const differencePercent = ((domToDataUrlSizeKB - snapdomSizeKB) / domToDataUrlSizeKB) * 100;

    report =`snapdom captured file size is ${differencePercent.toFixed(2)}% smaller compared to modern-screenshot (${snapdomSizeKB.toFixed(2)} KB vs. ${domToDataUrlSizeKB.toFixed(2)} KB)`

})

})
