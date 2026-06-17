// Perceptual image compression (`compress: true`). Runs in real Chromium (vitest browser).
// Verifies BOTH halves of the promise: smaller/faster output AND no fidelity loss.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { downsampleDataURL, compressClonedImages } from '../src/modules/compress.js'
import { snapdom } from '../src/index.js'

// A real raster data URL (photo-like, hard to trivially compress) at a given size + codec.
function bigPhoto(w, h, seed = 1, mime = 'image/png', alpha = false) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')
  if (!alpha) {
    const g = x.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`)
    g.addColorStop(1, `hsl(${(seed * 47 + 120) % 360} 80% 35%)`)
    x.fillStyle = g; x.fillRect(0, 0, w, h)
  }
  for (let i = 0; i < 120; i++) {
    x.beginPath()
    x.arc((i * 97 + seed * 13) % w, (i * 53 + seed * 29) % h, ((i * 7) % 50) + 6, 0, Math.PI * 2)
    x.fillStyle = `hsla(${(i * 17) % 360} 90% 70% / ${alpha ? 0.9 : 0.4})`
    x.fill()
  }
  return c.toDataURL(mime)
}

function imageSize(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = dataURL
  })
}

// Mean absolute per-channel difference (0-255) between two equally-sized canvases.
function meanChannelDiff(a, b) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  const da = a.getContext('2d').getImageData(0, 0, w, h).data
  const db = b.getContext('2d').getImageData(0, 0, w, h).data
  let sum = 0
  const n = w * h * 4
  for (let i = 0; i < n; i++) sum += Math.abs(da[i] - db[i])
  return sum / n
}

describe('downsampleDataURL', () => {
  it('shrinks a large raster to the visible box (fewer bytes + fewer pixels, aspect preserved)', async () => {
    const src = bigPhoto(2000, 1500, 2)
    const out = await downsampleDataURL(src, 200, 150)
    expect(out).toBeTruthy()
    expect(out.length).toBeLessThan(src.length)
    const { w, h } = await imageSize(out)
    expect(w).toBeLessThanOrEqual(220)
    expect(h).toBeLessThanOrEqual(170)
    expect(Math.abs(w / h - 2000 / 1500)).toBeLessThan(0.05)
  })

  it('never upscales — returns null when the box is already >= natural', async () => {
    const src = bigPhoto(120, 90, 3)
    expect(await downsampleDataURL(src, 800, 600)).toBeNull()
  })

  it('skips SVG data URLs (vectors must not be rasterized)', async () => {
    const svg = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22999%22 height=%22999%22%3E%3C/svg%3E'
    expect(await downsampleDataURL(svg, 10, 10)).toBeNull()
  })

  it('preserves the source codec (PNG stays PNG lossless)', async () => {
    const src = bigPhoto(1600, 1200, 4, 'image/png')
    const out = await downsampleDataURL(src, 160, 120)
    expect(out.startsWith('data:image/png')).toBe(true)
  })
})

describe('compressClonedImages', () => {
  it('rewrites oversized <img> data URLs and reports bytes saved', async () => {
    const clone = document.createElement('div')
    const img = document.createElement('img')
    img.src = bigPhoto(1800, 1200, 5)
    img.dataset.snapdomWidth = '180'
    img.dataset.snapdomHeight = '120'
    clone.appendChild(img)
    const before = img.getAttribute('src').length
    const stats = await compressClonedImages(clone, { scale: 1, dpr: 1, compress: true })
    expect(stats.count).toBe(1)
    expect(stats.after).toBeLessThan(stats.before)
    expect(img.getAttribute('src').length).toBeLessThan(before)
  })

  it('is a no-op when the flag is off', async () => {
    const clone = document.createElement('div')
    const img = document.createElement('img')
    img.src = bigPhoto(1800, 1200, 6)
    img.dataset.snapdomWidth = '180'
    img.dataset.snapdomHeight = '120'
    clone.appendChild(img)
    const before = img.getAttribute('src')
    const stats = await compressClonedImages(clone, { scale: 1, dpr: 1, compress: false })
    expect(stats.count).toBe(0)
    expect(img.getAttribute('src')).toBe(before)
  })
})

describe('compress — end-to-end speed/size', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); host.style.width = '260px'; document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('shrinks the SVG data URL of a capture with a large image', async () => {
    const img = document.createElement('img')
    img.src = bigPhoto(2200, 1400, 7)
    img.style.cssText = 'width:260px;height:160px;object-fit:cover'
    host.appendChild(img)
    await img.decode().catch(() => {})

    const plain = await snapdom.toRaw(host, { scale: 1, dpr: 1 })
    const small = await snapdom.toRaw(host, { scale: 1, dpr: 1, compress: true })

    expect(plain.startsWith('data:image/svg+xml')).toBe(true)
    expect(small.startsWith('data:image/svg+xml')).toBe(true)
    expect(small.length).toBeLessThan(plain.length * 0.5) // expect a big win, not a marginal one
  })
})

describe('compress — fidelity (the capture must still match)', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); host.style.width = '300px'; document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('is visually ~identical to the uncompressed capture', async () => {
    const img = document.createElement('img')
    img.src = bigPhoto(2400, 1600, 8, 'image/png')
    img.style.cssText = 'width:300px;height:200px;object-fit:cover;display:block'
    host.appendChild(img)
    await img.decode().catch(() => {})

    const opts = { scale: 2, dpr: 1 }
    const plain = await snapdom.toCanvas(host, { ...opts })
    const comp = await snapdom.toCanvas(host, { ...opts, compress: true })

    const diff = meanChannelDiff(plain, comp)
    // Only difference is one-step vs two-step high-quality downscale of the same (lossless) pixels.
    expect(diff).toBeLessThan(3)
  })

  it('is a perfect no-op when the image is shown at (or below) its natural resolution', async () => {
    const img = document.createElement('img')
    img.src = bigPhoto(150, 100, 9, 'image/png') // small source, shown ~1:1
    img.style.cssText = 'width:150px;height:100px;display:block'
    host.appendChild(img)
    await img.decode().catch(() => {})

    const plain = await snapdom.toRaw(host, { scale: 1, dpr: 1 })
    const comp = await snapdom.toRaw(host, { scale: 1, dpr: 1, compress: true })
    // Nothing to downsample → byte-identical output.
    expect(comp).toBe(plain)
  })

  it('preserves transparency (alpha)', async () => {
    const img = document.createElement('img')
    img.src = bigPhoto(1600, 1600, 10, 'image/png', true) // transparent background + opaque blobs
    img.style.cssText = 'width:160px;height:160px;display:block'
    host.appendChild(img)
    await img.decode().catch(() => {})

    const out = await downsampleDataURL(img.src, 320, 320)
    expect(out.startsWith('data:image/png')).toBe(true)
    const probe = await snapdom.toCanvas(host, { scale: 1, dpr: 1, compress: true })
    const data = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height).data
    let hasTransparent = false
    for (let i = 3; i < data.length; i += 4) { if (data[i] < 250) { hasTransparent = true; break } }
    expect(hasTransparent).toBe(true)
  })
})
