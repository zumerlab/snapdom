// `compress` option: current pipeline (OFF) vs perceptual image downsampling.
// Benches toCanvas (full rasterize) — where the smaller embedded images pay off.
// Run: `npm run test:benchmark` (or target this file).
//
// NOTE: for stable numbers + an output-size + fidelity (pixel-diff) report, prefer the standalone
// harness `node bench/compress.mjs` (Playwright direct). vitest bench only reports time.
import { bench, describe } from 'vitest'
import { snapdom } from '../src/index.js'

// Build the image data URLs ONCE at module load (kept small so the per-iteration decode in the
// compress path is cheap and the benchmark produces many stable samples).
function bigPhoto(w, h, seed) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`)
  g.addColorStop(1, `hsl(${(seed * 47 + 120) % 360} 80% 35%)`)
  x.fillStyle = g; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 120; i++) {
    x.beginPath()
    x.arc((i * 97 + seed * 13) % w, (i * 53 + seed * 29) % h, ((i * 7) % 50) + 6, 0, Math.PI * 2)
    x.fillStyle = `hsla(${(i * 17) % 360} 90% 70% / 0.4)`; x.fill()
  }
  return c.toDataURL('image/png')
}
const PHOTOS = [1, 2, 3, 4].map(s => bigPhoto(1200, 900, s))

let container
function setupContainer() {
  if (container && document.body.contains(container)) return
  container = document.createElement('div')
  container.style.cssText = 'width:520px;color:#222;font-size:14px;font-family:system-ui'
  container.innerHTML = '<h2>Gallery</h2><div class="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px"></div>'
  const grid = container.querySelector('.grid')
  PHOTOS.forEach((src, i) => {
    const card = document.createElement('div')
    card.style.cssText = 'background:#f1f5f9;border-radius:8px;padding:8px'
    card.innerHTML =
      '<div class="thumb" style="width:100%;height:120px;border-radius:6px;overflow:hidden">' +
      `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block"></div>` +
      `<h3 style="margin:6px 0 2px;font-size:13px">Item ${i + 1}</h3>`
    grid.appendChild(card)
  })
  document.body.appendChild(container)
}

const opts = { scale: 2, dpr: 1 }
const benchOpts = { time: 2000, warmupIterations: 3 }

describe('compress: image gallery (toCanvas, scale 2)', () => {
  bench('baseline (compress OFF)', async () => {
    setupContainer()
    await snapdom.toCanvas(container, { ...opts })
  }, benchOpts)

  bench('compress: true', async () => {
    setupContainer()
    await snapdom.toCanvas(container, { ...opts, compress: true })
  }, benchOpts)
})

// CSS background-image gallery — exercises the background downsampling pass (no-repeat / cover).
const BG = [1, 2, 3, 4].map(s => bigPhoto(1500, 1100, s + 20))
let bgC
function setupBg() {
  if (bgC && document.body.contains(bgC)) return
  bgC = document.createElement('div')
  bgC.style.cssText = 'width:520px;font-family:system-ui'
  bgC.innerHTML =
    `<div style="width:520px;height:220px;background-repeat:no-repeat;background-size:cover;background-image:url('${bigPhoto(2600, 1200, 40)}')"></div>` +
    '<div class="g" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px"></div>'
  const g = bgC.querySelector('.g')
  BG.forEach(src => {
    const d = document.createElement('div')
    d.style.cssText = `height:120px;border-radius:8px;background-repeat:no-repeat;background-size:cover;background-image:url('${src}')`
    g.appendChild(d)
  })
  document.body.appendChild(bgC)
}

describe('compress: background-image gallery (toCanvas, scale 2)', () => {
  bench('baseline (compress OFF)', async () => {
    setupBg()
    await snapdom.toCanvas(bgC, { ...opts, compress: false })
  }, benchOpts)

  bench('compress: true', async () => {
    setupBg()
    await snapdom.toCanvas(bgC, { ...opts, compress: true })
  }, benchOpts)
})
