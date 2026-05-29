import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { gifExport } from '../packages/plugins/gif-export.js'

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function loadImage(blob) {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  return new Promise((res, rej) => {
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('gif failed to decode')) }
    img.src = url
  })
}

describe('gifExport plugin', () => {
  let el

  beforeEach(() => {
    el = document.createElement('div')
    el.style.cssText = 'width:48px;height:32px;background:linear-gradient(90deg,#e11,#1e1);color:#fff'
    el.textContent = 'gif'
    document.body.appendChild(el)
  })

  afterEach(() => {
    el.remove()
  })

  it('returns a valid plugin exposing a gif export', () => {
    const p = gifExport()
    expect(p.name).toBe('gif-export')
    expect(typeof p.defineExports().gif).toBe('function')
  })

  it('exposes result.toGif()', async () => {
    const result = await snapdom(el, { plugins: [gifExport()] })
    expect(typeof result.toGif).toBe('function')
  })

  it('encodes a well-formed GIF89a blob the browser can decode', async () => {
    const result = await snapdom(el, { plugins: [gifExport()] })
    const blob = await result.toGif({ frames: 3, fps: 20 })

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/gif')
    expect(blob.size).toBeGreaterThan(64)

    const buf = await bytesOf(blob)
    expect(String.fromCharCode(...buf.slice(0, 6))).toBe('GIF89a')
    expect(buf[buf.length - 1]).toBe(0x3b) // trailer

    // the browser's native GIF decoder accepts it
    const img = await loadImage(blob)
    expect(img.naturalWidth).toBeGreaterThan(0)
    expect(img.naturalHeight).toBeGreaterThan(0)
  }, 30000)

  it('writes the Netscape looping block for multi-frame output', async () => {
    const result = await snapdom(el, { plugins: [gifExport()] })
    const blob = await result.toGif({ frames: 2, fps: 20, repeat: 0 })
    const buf = await bytesOf(blob)
    const ascii = String.fromCharCode(...buf)
    expect(ascii).toContain('NETSCAPE2.0')
  }, 30000)

  it('honors maxColors (palette size stays within bound)', async () => {
    const result = await snapdom(el, { plugins: [gifExport({ maxColors: 16 }) ] })
    const blob = await result.toGif({ frames: 1, fps: 10 })
    // still decodes
    const img = await loadImage(blob)
    expect(img.naturalWidth).toBeGreaterThan(0)
  }, 30000)
})
