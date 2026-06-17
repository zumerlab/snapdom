import { bench, describe, afterEach } from 'vitest'
import { domToDataUrl } from 'https://unpkg.com/modern-screenshot'
import * as htmlToImage from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
//import { toPng, toJpeg, toBlob, toPixelData, toSvg } from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.min.js';
import { snapdom as sd } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@1.9.9/dist/snapdom.mjs'
import { snapdom } from '../src/index'

let html2canvasLoaded = false

async function loadHtml2Canvas() {
  if (html2canvasLoaded) return
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    script.onload = () => resolve()
    script.onerror = reject
    document.head.appendChild(script)
  })
  html2canvasLoaded = true
}

await loadHtml2Canvas()

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
  { width: 2000, height: 1500, label: 'Large scroll area (2000x1500)' },
  { width: 4000, height: 2000, label: 'Very large element (4000x2000)' },
]

for (const size of sizes) {
  describe(`Benchmark simple node at ${size.label}`, () => {
    let container

    async function setupContainer() {
      if (container && document.body.contains(container)) {
        return
      }
      container = document.createElement('div')
      container.style.width = `${size.width}px`
      container.style.height = `${size.height}px`
      container.style.background = 'linear-gradient(to right, red, blue)'
      container.style.fontFamily = 'Arial, sans-serif'
      container.style.display = 'flex'
      container.style.alignItems = 'center'
      container.style.justifyContent = 'center'
      container.style.fontSize = '24px'
      container.innerHTML = `<h1>${size.label}</h1>`
      document.body.appendChild(container)
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
        container.remove()
        container = null
      }
    })

    bench('snapDOM current version', async () => {
      await setupContainer()
      await snapdom.toRaw(container)
    })

     bench('snapDOM V1.9.9', async () => {
      await setupContainer()
      await sd.toRaw(container)
    })

    bench('html2canvas capture', async () => {
      await setupContainer()
      const canvas = await window.html2canvas(container, { logging: false, scale: 1 })
      await canvas.toDataURL()
    })

    bench('modern-screenshot capture', async () => {
      await setupContainer()
      await domToDataUrl(container)
    })

    bench('html-to-image capture', async () => {
      await setupContainer()
      await htmlToImage.toSvg(container)
    })
  })
}

// ── Image-heavy scenario (rasterized PNG) ───────────────────────────────────
// Captures with large raster images shown small — the case where snapdom's `compress` pays off.
// Rasterizing (toPng) is where the win lands: smaller embedded images decode/composite faster.
// Compares snapDOM (compress off vs on) against the other libraries on the same scene.
function bigPhoto(w, h, seed) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`)
  g.addColorStop(1, `hsl(${(seed * 47 + 120) % 360} 80% 35%)`)
  x.fillStyle = g; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 200; i++) {
    x.beginPath()
    x.arc((i * 97 + seed * 13) % w, (i * 53 + seed * 29) % h, ((i * 11) % 60) + 6, 0, Math.PI * 2)
    x.fillStyle = `hsla(${(i * 17) % 360} 90% 70% / 0.4)`; x.fill()
  }
  return c.toDataURL('image/png')
}

describe('Benchmark image gallery (rasterized PNG, scale 2)', () => {
  let container

  async function setupContainer() {
    if (container && document.body.contains(container)) return
    container = document.createElement('div')
    container.style.cssText = 'width:960px;background:#fff;font-family:Arial,sans-serif'
    container.innerHTML =
      '<div style="width:960px;height:360px;overflow:hidden;border-radius:12px">' +
      `<img style="width:100%;height:100%;object-fit:cover;display:block" src="${bigPhoto(3000, 1400, 1)}"></div>` +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px"></div>'
    const grid = container.querySelector('div:last-child')
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement('div')
      cell.style.cssText = 'height:130px;overflow:hidden;border-radius:8px'
      cell.innerHTML = `<img style="width:100%;height:100%;object-fit:cover;display:block" src="${bigPhoto(1500, 1000, i + 2)}">`
      grid.appendChild(cell)
    }
    document.body.appendChild(container)
    await Promise.allSettled(Array.from(container.querySelectorAll('img')).map(im => im.decode?.()))
  }

  afterEach(() => { if (container) { container.remove(); container = null } })

  bench('snapDOM toPng (compress OFF)', async () => {
    await setupContainer()
    await snapdom.toPng(container, { scale: 2, dpr: 1, compress: false })
  })

  bench('snapDOM toPng (compress ON)', async () => {
    await setupContainer()
    await snapdom.toPng(container, { scale: 2, dpr: 1, compress: true })
  })

  bench('html2canvas', async () => {
    await setupContainer()
    const canvas = await window.html2canvas(container, { logging: false, scale: 2 })
    await canvas.toDataURL('image/png')
  })

  bench('modern-screenshot', async () => {
    await setupContainer()
    await domToDataUrl(container, { scale: 2 })
  })

  bench('html-to-image', async () => {
    await setupContainer()
    await htmlToImage.toPng(container, { pixelRatio: 2 })
  })
})
