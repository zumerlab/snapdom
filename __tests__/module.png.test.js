import { describe, expect, it } from 'vitest'
import { encodePng } from '../src/modules/png.js'

async function inspect(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  const chunks = []
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    // Independent bit-at-a-time CRC checks the encoded type AND payload, including IEND.
    let crc = 0xffffffff
    for (const byte of bytes.subarray(offset + 4, offset + length + 8)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    expect(view.getUint32(offset + length + 8)).toBe((crc ^ 0xffffffff) >>> 0)
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + length + 8) })
    offset += length + 12
    expect(offset).toBeLessThanOrEqual(bytes.length)
  }
  expect(chunks[0].type).toBe('IHDR')
  expect(chunks[1]).toEqual({ type: 'sRGB', data: new Uint8Array([0]) })
  expect(chunks.at(-1)).toEqual({ type: 'IEND', data: new Uint8Array(0) })
  expect(chunks.slice(2, -1).every(c => c.type === 'IDAT')).toBe(true)
  const header = chunks[0].data
  const ihdr = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const width = ihdr.getUint32(0), height = ihdr.getUint32(4)
  expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0])
  const compressed = new Blob(chunks.filter(c => c.type === 'IDAT').map(c => c.data))
  // Rejects extra zlib streams/trailers, so batching cannot silently restart compression.
  const inflated = new Uint8Array(await new Response(compressed.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const stride = width * 4
  expect(inflated.length).toBe(height * (stride + 1))
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]
    expect([1, 2]).toContain(filter)
    for (let x = 0; x < stride; x++) {
      const left = x < 4 ? 0 : pixels[y * stride + x - 4]
      const above = y === 0 ? 0 : pixels[(y - 1) * stride + x]
      pixels[y * stride + x] = inflated[y * (stride + 1) + x + 1] + (filter === 1 ? left : above)
    }
  }
  return { width, height, pixels, chunks }
}

describe('incremental PNG encoder', () => {
  it('preserves every RGBA byte across input chunks and reused buffers', async () => {
    const width = 257, height = 91
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < pixels.length; i++) pixels[i] = ((i % (width * 8)) * 37 + (i % 19)) & 255
    for (let y = 1; y < height; y += 2) pixels.copyWithin(y * width * 4, (y - 1) * width * 4, y * width * 4)
    const expected = pixels.slice()
    async function* rows() {
      const buffer = new Uint8ClampedArray(width * 4)
      for (let y = 0; y < height; y++) {
        buffer.set(pixels.subarray(y * width * 4, (y + 1) * width * 4))
        yield buffer
      }
    }
    const blob = await encodePng(width, height, rows())
    expect(blob.type).toBe('image/png')
    const result = await inspect(blob)
    expect([result.width, result.height]).toEqual([width, height])
    expect(result.pixels).toEqual(new Uint8Array(expected))
  })

  it('drains incompressible multirow chunks without blocking and produces one zlib stream', async () => {
    const width = 512, height = 256
    const pixels = new Uint8Array(width * height * 4)
    let random = 42
    for (let i = 0; i < pixels.length; i++) {
      random ^= random << 13
      random ^= random >>> 17
      random ^= random << 5
      pixels[i] = random & 255
    }
    async function* rows() {
      yield pixels.subarray(0, width * 4 * 100)
      yield pixels.subarray(width * 4 * 100)
    }
    const result = await inspect(await encodePng(width, height, rows()))
    expect(result.pixels).toEqual(pixels)
  })

  // Asserted against the canvas readback, not against native toBlob: Firefox's own encoder
  // unpremultiplies differently and its PNG decodes 2 levels above getImageData on alpha 128.
  it('decodes in the browser to the same colors and alpha as the canvas readback', async () => {
    const width = 16, height = 8
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.set([i % 256, (i * 3) % 256, (i * 7) % 256, i % 3 === 0 ? 0 : i % 7 === 0 ? 128 : 255], i)
    }
    const source = document.createElement('canvas')
    source.width = width
    source.height = height
    const sourceCtx = source.getContext('2d')
    sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0)
    const rendered = [sourceCtx.getImageData(0, 0, width, height).data]
    for (const blob of [await encodePng(width, height, [pixels])]) {
      const url = URL.createObjectURL(blob)
      try {
        const img = new Image()
        img.src = url
        await img.decode()
        expect([img.naturalWidth, img.naturalHeight]).toEqual([width, height])
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        rendered.push(ctx.getImageData(0, 0, width, height).data)
      } finally { URL.revokeObjectURL(url) }
    }
    expect(rendered[1]).toEqual(rendered[0])
  })

  it('rejects invalid dimensions before pulling input', async () => {
    async function* rows() { yield await Promise.reject(new Error('input was pulled')) }
    for (const bad of [0, -1, 1.5, NaN, Infinity, 0x80000000]) {
      await expect(encodePng(bad, 1, rows())).rejects.toThrow(/PNG dimensions/)
      await expect(encodePng(1, bad, rows())).rejects.toThrow(/PNG dimensions/)
    }
  })

  it('rejects incomplete, missing, or extra rows and closes the input iterator', async () => {
    for (const data of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(8), new Uint16Array(4)]) {
      let closed = false
      const rows = async function* () {
        try { yield data } finally { closed = true }
      }
      await expect(encodePng(1, 1, rows())).rejects.toThrow(/PNG input/)
      expect(closed).toBe(true)
    }
    await expect(encodePng(1, 2, [new Uint8Array(4)])).rejects.toThrow(/declared height/)
  })

  it('propagates a row-source rejection without hanging or returning a partial PNG', async () => {
    const failure = new Error('tile capture failed')
    let closed = false
    async function* rows() {
      try {
        yield new Uint8Array(400)
        throw failure
      } finally { closed = true }
    }
    await expect(encodePng(100, 2, rows())).rejects.toBe(failure)
    expect(closed).toBe(true)
  }, 2000)
})
