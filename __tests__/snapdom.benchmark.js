// "current" is this checkout; the published npm `latest` runs alongside as the baseline.
// That arm is UNPINNED on purpose: the question is always what this checkout buys over
// what users install today, so it follows the tag instead of a version bumped by hand
// (the fixed 1.9.9 / 2.16.0 / 2.24.12 arms were dropped on 2026-09-04). burst: false pins
// both arms to the cold pipeline: the memo would otherwise serve the repeated iterations
// and measure the hit instead (session.static / session.mutating measure that on purpose);
// v2 only bursts when the flag is true, and once v3 is `latest` the flag keeps it cold too.
import { bench, describe, afterEach } from 'vitest'
import { domToDataUrl } from 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm'
import * as htmlToImage from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
//import { toPng, toJpeg, toBlob, toPixelData, toSvg } from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.min.js';
import { snapdom as published } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@latest/dist/snapdom.mjs'
import { snapdom } from '../src/index'

// The published build carries no version export; the report needs the number.
const PUBLISHED = await fetch('https://cdn.jsdelivr.net/npm/@zumer/snapdom@latest/package.json')
  .then((r) => r.json()).then((p) => p.version).catch(() => 'unknown version')

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

    afterEach(() => {
      if (container) {
        container.remove()
        container = null
      }
    })

    bench('snapDOM current version', async () => {
      await setupContainer()
      await snapdom.toRaw(container, { burst: false })
    })

    bench(`snapDOM ${PUBLISHED} (npm latest)`, async () => {
      await setupContainer()
      await published.toRaw(container, { burst: false })
    })

    // toRaw ends at the SVG string: this is the pipeline without the raster stage. A raster
    // regression is invisible here and shows in category.benchmark.js, which ends at a PNG.
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

  bench('snapDOM current toPng (compress OFF)', async () => {
    await setupContainer()
    await snapdom.toPng(container, { scale: 2, dpr: 1, compress: false, burst: false })
  })

  bench('snapDOM current toPng (compress ON)', async () => {
    await setupContainer()
    await snapdom.toPng(container, { scale: 2, dpr: 1, compress: true, burst: false })
  })

  bench(`snapDOM ${PUBLISHED} toPng (compress OFF)`, async () => {
    await setupContainer()
    // Same scale/dpr as every other arm in this describe: without them v2 rasterized ~4x
    // fewer pixels in a comparison labeled "scale 2" and its number was not comparable.
    await published.toPng(container, { scale: 2, dpr: 1, compress: false, burst: false })
  })

  bench(`snapDOM ${PUBLISHED} toPng (compress ON)`, async () => {
    await setupContainer()
    await published.toPng(container, { scale: 2, dpr: 1, compress: true, burst: false })
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
