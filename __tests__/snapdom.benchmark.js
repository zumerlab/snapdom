import { bench, describe, beforeEach, afterEach } from 'vitest';
import { domToDataUrl } from 'https://unpkg.com/modern-screenshot';
import { snapdom as sd } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@1.8.0/dist/snapdom.mjs';
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
  describe(`Benchmark simple node at ${size.label}`, () => {
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

    /*   async function setupContainer() {
        if (container && document.body.contains(container)) return;
      
        container = document.createElement('div');
        container.style.width = `${size.width}px`;
        container.style.height = `${size.height}px`;
        container.style.padding = '20px';
        container.style.overflow = 'auto';
        container.style.background = 'white';
        container.style.border = '2px solid black';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.color = '#333';
        container.style.position = 'relative';
      
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
        grid.style.gap = '10px';
      
        for (let i = 0; i < Math.floor((size.width * size.height) / 20000); i++) {
          const card = document.createElement('div');
          card.style.padding = '10px';
          card.style.borderRadius = '8px';
          card.style.background = i % 2 === 0 ? '#f0f0f0' : '#e0eaff';
          card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'center';
      
          const title = document.createElement('h3');
          title.textContent = `Card ${i + 1}`;
          title.style.margin = '0 0 10px 0';
          title.style.fontSize = '14px';
      
          const icon = document.createElement('div');
          icon.style.width = '30px';
          icon.style.height = '30px';
          icon.style.borderRadius = '50%';
          icon.style.background = i % 2 === 0 ? 'red' : 'blue';
          icon.style.marginBottom = '10px';
      
          const text = document.createElement('p');
          text.textContent = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
          text.style.fontSize = '12px';
          text.style.textAlign = 'center';
      
          card.appendChild(icon);
          card.appendChild(title);
          card.appendChild(text);
          grid.appendChild(card);
        }
      
        container.appendChild(grid);
        document.body.appendChild(container);
      }
       */
    afterEach(() => {
      if (container) {
        container.remove();
        container = null;
      }
    });

    bench('snapDOM current version', async () => {
      await setupContainer();
      await snapdom.toRaw(container);
    });

     bench('snapDOM V1.8.0', async () => {
      await setupContainer();
      await sd.toRaw(container);
    });

    bench('html2canvas capture', async () => {
      await setupContainer();
      const canvas = await window.html2canvas(container, { logging: false, scale: 1 });
      await canvas.toDataURL();
    });

    bench('modern-screenshot capture', async () => {
      await setupContainer();
      await domToDataUrl(container);
    });
  });
}
