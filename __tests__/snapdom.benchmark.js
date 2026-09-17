// Exploratory local microbenchmarks. Use `npm run test:benchmark` for regression
// checks against the exact published stable build in isolated browser contexts.
// Loading two SnapDOM versions in this page is unsafe: their document state collides.
// Fixtures mount outside timing; burst:false measures the pipeline without memo hits.
import { bench, describe } from 'vitest'
import { domToDataUrl } from 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm'
import * as htmlToImage from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
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

// Enough warmup for both arms to reach steady JIT and cache state before timing.
const OPTS = { time: 1000, warmupTime: 300 }

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
  { width: 2000, height: 1500, label: 'Large scroll area (2000x1500)' },
  { width: 4000, height: 2000, label: 'Very large element (4000x2000)' },
]

for (const size of sizes) {
  describe(`Benchmark simple node at ${size.label}`, () => {
    let container = null
    const hooks = {
      setup() {
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
      },
      teardown() {
        container?.remove()
        container = null
      },
    }

    // toRaw ends at the SVG string: this is the pipeline without the raster stage. A raster
    // regression is invisible here and shows in category.benchmark.js, which ends at a PNG.
    bench('snapDOM current source', async () => {
      await snapdom.toRaw(container, { burst: false })
    }, { ...OPTS, ...hooks })
  })
}

// ── Image-heavy scenario (rasterized PNG) ───────────────────────────────────
// Captures with large raster images shown small — the case where snapdom's `compress` pays off.
// Rasterizing is where the win lands: smaller embedded images decode/composite faster.
// Every arm ends at a PNG URL; image-element decoding for display is not timed.
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

// One scene for every gallery describe. Nine large canvas encodes: made once, not per setup.
let galleryContainer = null
let photos = null
const gallery = {
  async setup() {
    photos ||= [bigPhoto(3000, 1400, 1), ...Array.from({ length: 8 }, (_, i) => bigPhoto(1500, 1000, i + 2))]
    galleryContainer = document.createElement('div')
    galleryContainer.style.cssText = 'width:960px;background:#fff;font-family:Arial,sans-serif'
    galleryContainer.innerHTML =
      '<div style="width:960px;height:360px;overflow:hidden;border-radius:12px">' +
      `<img style="width:100%;height:100%;object-fit:cover;display:block" src="${photos[0]}"></div>` +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px"></div>'
    const grid = galleryContainer.querySelector('div:last-child')
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement('div')
      cell.style.cssText = 'height:130px;overflow:hidden;border-radius:8px'
      cell.innerHTML = `<img style="width:100%;height:100%;object-fit:cover;display:block" src="${photos[i + 1]}">`
      grid.appendChild(cell)
    }
    document.body.appendChild(galleryContainer)
    await Promise.allSettled(Array.from(galleryContainer.querySelectorAll('img')).map(im => im.decode?.()))
  },
  teardown() {
    galleryContainer?.remove()
    galleryContainer = null
  },
  // Raster exports need a longer window than the raw SVG node sizes above.
  time: 3000,
  warmupTime: 1000,
}

describe('Benchmark image gallery (PNG URL, scale 2)', () => {
  bench('snapDOM current (compress OFF)', async () => {
    const canvas = await snapdom.toCanvas(galleryContainer, { scale: 2, dpr: 1, compress: false, burst: false })
    canvas.toDataURL('image/png')
  }, gallery)

  bench('snapDOM current (compress ON)', async () => {
    const canvas = await snapdom.toCanvas(galleryContainer, { scale: 2, dpr: 1, compress: true, burst: false })
    canvas.toDataURL('image/png')
  }, gallery)

  bench('html2canvas', async () => {
    const canvas = await window.html2canvas(galleryContainer, { logging: false, scale: 2 })
    await canvas.toDataURL('image/png')
  }, gallery)

  bench('modern-screenshot', async () => {
    await domToDataUrl(galleryContainer, { scale: 2 })
  }, gallery)

  bench('html-to-image', async () => {
    await htmlToImage.toPng(galleryContainer, { pixelRatio: 2 })
  }, gallery)
})
