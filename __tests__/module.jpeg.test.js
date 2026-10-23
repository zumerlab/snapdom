import { describe, expect, it } from 'vitest'
import { encodeJpeg } from '../src/modules/jpeg.js'

async function decode(blob, width, height) {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('The JPEG did not decode'))
      image.src = url
    })
    expect([image.naturalWidth, image.naturalHeight]).toEqual([width, height])
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return ctx.getImageData(0, 0, width, height).data
  } finally {
    URL.revokeObjectURL(url)
  }
}

function meanError(a, b) {
  let sum = 0, n = 0
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue
    sum += Math.abs(a[i] - b[i])
    n++
  }
  return sum / n
}

// Smooth gradients, hard-edged bars and a band of noise: the noise is what emits the rare
// long Huffman codes, which a smooth scene never reaches.
function scene(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  let seed = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const bar = (x >> 4) % 3
      pixels[at] = bar === 0 ? 230 : x * 255 / width
      pixels[at + 1] = bar === 1 ? 40 : y * 255 / height
      pixels[at + 2] = bar === 2 ? 200 : 128
      pixels[at + 3] = 255
      if (y > height / 2) {
        for (let c = 0; c < 3; c++) pixels[at + c] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
      }
    }
  }
  return pixels
}

describe('incremental JPEG encoder', () => {
  it('decodes as close to its source as the native encoder at the same quality, across odd chunks', async () => {
    const width = 257, height = 91
    const pixels = scene(width, height)
    async function* rows() {
      const buffer = new Uint8ClampedArray(width * 4 * 7)
      for (let y = 0; y < height; y += 7) {
        const count = Math.min(7, height - y)
        const view = buffer.subarray(0, count * width * 4)
        view.set(pixels.subarray(y * width * 4, (y + count) * width * 4))
        yield view
      }
    }
    const ours = await decode(await encodeJpeg(width, height, rows(), 0.92), width, height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0)
    const native = await decode(await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92)), width, height)
    const oursError = meanError(ours, pixels)
    const nativeError = meanError(native, pixels)
    expect(oursError, `ours ${oursError}, native ${nativeError}`).toBeLessThan(Math.max(2, nativeError * 1.5))
  })

  it.each([0.5, 0.92])('replicates the last row and column into the edge blocks at quality %s', async quality => {
    // 17x17 leaves padded columns and rows at both chroma samplings; zero padding would pull
    // the edge chroma and luma toward black.
    const width = 17, height = 17
    const color = [200, 120, 40]
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...color, 255], i)
    const out = await decode(await encodeJpeg(width, height, (async function* () { yield pixels })(), quality), width, height)
    for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
      const px = [...out.slice((y * width + x) * 4, (y * width + x) * 4 + 3)]
      expect(px.every((v, i) => Math.abs(v - color[i]) <= 4), `${px} at ${x},${y}`).toBe(true)
    }
  })

  it('maps quality onto file size', async () => {
    const width = 128, height = 128
    const pixels = scene(width, height)
    const sizes = []
    for (const quality of [0.2, 0.92, 1]) {
      sizes.push((await encodeJpeg(width, height, (async function* () { yield pixels })(), quality)).size)
    }
    expect(sizes[0]).toBeLessThan(sizes[1])
    expect(sizes[1]).toBeLessThan(sizes[2])
  })

  it('rejects partial rows, extra rows and a short image', async () => {
    const one = async function* (data) { yield data }
    await expect(encodeJpeg(2, 2, one(new Uint8Array(12)))).rejects.toThrow(/complete RGBA rows/)
    await expect(encodeJpeg(2, 1, one(new Uint8Array(16)))).rejects.toThrow(/exceeds/)
    await expect(encodeJpeg(2, 2, one(new Uint8Array(8)))).rejects.toThrow(/does not match/)
    await expect(encodeJpeg(65536, 1, one(new Uint8Array(0)))).rejects.toThrow(/65535/)
  })
})
