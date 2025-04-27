import { bench, describe, beforeEach, afterEach } from 'vitest';
import { domToDataUrl } from 'https://unpkg.com/modern-screenshot';
import { snapdom } from '../src/index';

let html2canvasLoaded = false;

async function loadHtml2Canvas() {
  if (html2canvasLoaded) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
  html2canvasLoaded = true;
}

await loadHtml2Canvas();

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
  { width: 2000, height: 1500, label: 'Large scroll area (2000x1500)' },
  { width: 4000, height: 2000, label: 'Very large element (4000x2000)' },
];

for (const size of sizes) {
  describe(`Benchmark at ${size.label}`, () => {
    let container;

    async function setupContainer() {
      if (container && document.body.contains(container)) {
        return;
      }
      container = document.createElement('div');
      container.style.width = `${size.width}px`;
      container.style.height = `${size.height}px`;
      container.style.background = 'linear-gradient(to right, red, blue)';
      container.style.fontFamily = 'Arial, sans-serif';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.fontSize = '24px';
      container.innerHTML = `<h1>${size.label}</h1>`;
      document.body.appendChild(container);
    }

    afterEach(() => {
      if (container) {
        container.remove();
        container = null;
      }
    });

    bench('snapDOM capture', async () => {
      await setupContainer();
      await snapdom(container);
    });

    bench('html2canvas capture', async () => {
      await setupContainer();
      const canvas = await window.html2canvas(container, { logging: false });
      await canvas.toDataURL();
    });

    bench('modern-screenshot capture', async () => {
      await setupContainer();
      await domToDataUrl(container);
    });
  });
}
