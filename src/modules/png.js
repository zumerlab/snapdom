/** Incremental RGBA8 PNG encoding. Only filtered rows and the compressed file are retained. */
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}

function chunk(type, data = new Uint8Array(0)) {
  const bytes = new Uint8Array(data.length + 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) bytes[i + 4] = type.charCodeAt(i)
  bytes.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0)
  return bytes
}

/**
 * Encode unpremultiplied sRGB RGBA bytes, top to bottom, without a full-image buffer.
 * Each yielded chunk must contain complete rows; its buffer may be reused after the next
 * iteration is requested. PNG requires ONE zlib stream across all consecutive IDAT chunks.
 * @param {number} width
 * @param {number} height
 * @param {AsyncIterable<Uint8Array|Uint8ClampedArray>} rows
 * @returns {Promise<Blob>}
 */
export async function encodePng(width, height, rows) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 0x7fffffff)) {
    throw new RangeError('[SnapDOM] PNG dimensions must be integers from 1 to 2147483647')
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6 // RGBA, no interlace, standard compression and filtering
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', new Uint8Array([0]))]
  const stride = width * 4
  const batchRows = Math.max(1, Math.floor(65536 / (stride + 1)))
  let previous = new Uint8Array(stride)
  let written = 0
  const compression = new CompressionStream('deflate') // WHATWG deflate is zlib, not raw DEFLATE
  const writer = compression.writable.getWriter()
  const reader = compression.readable.getReader()
  let readError
  // Drain concurrently: awaiting writes before reading can deadlock on stream backpressure.
  const drained = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        parts.push(chunk('IDAT', value))
      }
    } catch (error) {
      readError = error
      await writer.abort(error).catch(() => {})
    }
  })()
  try {
    for await (const data of rows) {
      if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || !data.length || data.length % stride) {
        throw new RangeError('[SnapDOM] PNG input must contain complete RGBA rows')
      }
      const count = data.length / stride
      if (written + count > height) throw new RangeError('[SnapDOM] PNG input exceeds the declared height')
      for (let first = 0; first < count; first += batchRows) {
        const end = Math.min(count, first + batchRows)
        const filtered = new Uint8Array((end - first) * (stride + 1))
        for (let row = first; row < end; row++) {
          const current = data.subarray(row * stride, (row + 1) * stride)
          const offset = (row - first) * (stride + 1)
          let subScore = 0, upScore = 0
          for (let x = 0; x < stride; x++) {
            const sub = (current[x] - (x < 4 ? 0 : current[x - 4])) & 255
            const up = (current[x] - previous[x]) & 255
            subScore += Math.min(sub, 256 - sub)
            upScore += Math.min(up, 256 - up)
            filtered[offset + x + 1] = up
          }
          filtered[offset] = upScore <= subScore ? 2 : 1
          if (subScore < upScore) {
            for (let x = 0; x < stride; x++) filtered[offset + x + 1] = current[x] - (x < 4 ? 0 : current[x - 4])
          }
          previous = current
        }
        await writer.write(filtered)
      }
      // Do not retain the caller's entire tile, or observe a reused tile after yielding.
      previous = previous.slice()
      written += count
    }
    if (written !== height) throw new RangeError('[SnapDOM] PNG input does not match the declared height')
    await writer.close()
    await drained
    if (readError) throw readError
    parts.push(chunk('IEND'))
    return new Blob(parts, { type: 'image/png' })
  } catch (error) {
    await Promise.allSettled([writer.abort(error), reader.cancel(error)])
    await drained
    throw error
  } finally {
    writer.releaseLock()
    reader.releaseLock()
  }
}
