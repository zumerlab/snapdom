/** Incremental baseline JPEG encoding with the Annex K tables. Only one MCU stripe is retained. */

// Natural (row-major) coefficient index -> zigzag position.
const ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42,
  3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60,
  21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63,
]
const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]
const CHROMA_Q = Array.from({ length: 64 }, (_, i) => (i & 7) < 4 && i < 32
  ? [17, 18, 24, 47, 18, 21, 26, 66, 24, 26, 56, 99, 47, 66, 99, 99][(i >> 3) * 4 + (i & 7)] : 99)
const AAN = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379]

// Annex K.3 AC symbol lists: an irregular prefix, then every other symbol in ascending order.
function acValues(prefix) {
  const all = [0, 0xf0]
  for (let run = 0; run < 16; run++) for (let size = 1; size <= 10; size++) all.push(run << 4 | size)
  return prefix.concat(all.filter(v => !prefix.includes(v)).sort((a, b) => a - b))
}
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const TABLES = [
  [0x00, 0, [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], DC_VALUES],
  [0x10, 0, [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], acValues([
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82])],
  [0x01, 1, [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], DC_VALUES],
  [0x11, 1, [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], acValues([
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1])],
]
// [code, length] per symbol, from the canonical code lengths.
const CODES = TABLES.map(([, , bits, values]) => {
  const codes = []
  let code = 0, k = 0
  for (let len = 1; len <= 16; len++, code <<= 1) {
    for (let i = 0; i < bits[len - 1]; i++) codes[values[k++]] = [code++, len]
  }
  return codes
})

function forwardDct(d) {
  for (let i = 0; i < 64; i += 8) dct1(d, i, 1)
  for (let i = 0; i < 8; i++) dct1(d, i, 8)
}

// AAN scaled 1-D DCT; its output scale is folded into the quantization divisors.
function dct1(d, o, s) {
  const t0 = d[o] + d[o + 7 * s], t7 = d[o] - d[o + 7 * s]
  const t1 = d[o + s] + d[o + 6 * s], t6 = d[o + s] - d[o + 6 * s]
  const t2 = d[o + 2 * s] + d[o + 5 * s], t5 = d[o + 2 * s] - d[o + 5 * s]
  const t3 = d[o + 3 * s] + d[o + 4 * s], t4 = d[o + 3 * s] - d[o + 4 * s]
  let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2
  d[o] = t10 + t11
  d[o + 4 * s] = t10 - t11
  const z1 = (t12 + t13) * 0.707106781
  d[o + 2 * s] = t13 + z1
  d[o + 6 * s] = t13 - z1
  t10 = t4 + t5
  t11 = t5 + t6
  t12 = t6 + t7
  const z5 = (t10 - t12) * 0.382683433
  const z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781
  const z11 = t7 + z3, z13 = t7 - z3
  d[o + 5 * s] = z13 + z2
  d[o + 3 * s] = z13 - z2
  d[o + s] = z11 + z4
  d[o + 7 * s] = z11 - z4
}

/**
 * Encode sRGB RGBA bytes, top to bottom, without a full-image buffer. Alpha is ignored, as
 * the native encoders ignore it: flatten the background first. Each yielded chunk must
 * contain complete rows; its buffer may be reused after the next iteration is requested.
 * @param {number} width
 * @param {number} height
 * @param {AsyncIterable<Uint8Array|Uint8ClampedArray>} rows
 * @param {number} [quality] - 0 to 1; anything else is 0.92, the canvas default.
 * @returns {Promise<Blob>}
 */
export async function encodeJpeg(width, height, rows, quality) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) {
    throw new RangeError('[SnapDOM] JPEG dimensions must be integers from 1 to 65535')
  }
  // IJG quality scaling, the curve libjpeg and the browsers' encoders use.
  const q = Math.min(100, Math.max(1, Math.round((typeof quality === 'number' && quality >= 0 && quality <= 1 ? quality : 0.92) * 100)))
  const factor = q < 50 ? 5000 / q : 200 - q * 2
  // Chroma 4:4:4 from quality 90 up, 4:2:0 below: Firefox's own encoder rule. At 4:2:0 a
  // default-quality export decoded 8x further from its source than Firefox's native one
  // on coloured detail (mean error 24.9 against 3.1 levels).
  const sub = q < 90 ? 1 : 0
  const mcu = 8 << sub
  const dqt = [0]
  const divisors = [LUMA_Q, CHROMA_Q].map((base, id) => {
    const zz = new Uint8Array(64)
    const div = new Float32Array(64)
    for (let i = 0; i < 64; i++) {
      const v = Math.min(255, Math.max(1, Math.floor((base[i] * factor + 50) / 100)))
      zz[ZIGZAG[i]] = v
      div[i] = 1 / (v * AAN[i >> 3] * AAN[i & 7] * 8)
    }
    dqt.push(...(id ? [1] : []), ...zz)
    return div
  })
  const segment = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
  const head = [0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, dqt),
    ...segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, sub ? 0x22 : 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...segment(0xc4, TABLES.flatMap(([id, , bits, values]) => [id, ...bits, ...values])),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])]
  const parts = [new Uint8Array(head)]

  let out = new Uint8Array(65536), pos = 0, acc = 0, bits = 0
  function put(code, len) {
    acc = (acc << len) | code
    bits += len
    while (bits >= 8) {
      bits -= 8
      const byte = (acc >>> bits) & 255
      if (pos >= out.length - 1) {
        parts.push(out.subarray(0, pos))
        out = new Uint8Array(65536)
        pos = 0
      }
      out[pos++] = byte
      if (byte === 255) out[pos++] = 0 // stuffing
    }
    acc &= (1 << bits) - 1
  }

  const block = new Float32Array(64)
  const coef = new Int32Array(64)
  const dcPrev = [0, 0, 0]
  function encodeBlock(c, table) {
    const div = divisors[table]
    forwardDct(block)
    for (let i = 0; i < 64; i++) coef[ZIGZAG[i]] = Math.round(block[i] * div[i])
    const dc = CODES[table * 2], ac = CODES[table * 2 + 1]
    let v = coef[0] - dcPrev[c]
    dcPrev[c] = coef[0]
    let size = v ? 32 - Math.clz32(Math.abs(v)) : 0
    put(dc[size][0], dc[size][1])
    if (size) put((v < 0 ? v - 1 : v) & ((1 << size) - 1), size)
    let run = 0
    for (let i = 1; i < 64; i++) {
      v = coef[i]
      if (!v) { run++; continue }
      for (; run > 15; run -= 16) put(ac[0xf0][0], ac[0xf0][1])
      size = 32 - Math.clz32(Math.abs(v))
      const sym = ac[run << 4 | size]
      put(sym[0], sym[1])
      put((v < 0 ? v - 1 : v) & ((1 << size) - 1), size)
      run = 0
    }
    if (run) put(ac[0][0], ac[0][1])
  }

  const stride = width * 4
  const stripe = new Uint8Array(stride * mcu)
  const y = new Float32Array(mcu * mcu), cb = new Float32Array(64), cr = new Float32Array(64)
  const w = sub ? 0.25 : 1
  // Edge MCUs replicate the last column and row, so no padding colour bleeds into the image.
  function encodeStripe(filled) {
    for (let mx = 0; mx < width; mx += mcu) {
      cb.fill(0)
      cr.fill(0)
      for (let py = 0; py < mcu; py++) {
        const row = Math.min(py, filled - 1) * stride
        for (let px = 0; px < mcu; px++) {
          const at = row + Math.min(mx + px, width - 1) * 4
          const r = stripe[at], g = stripe[at + 1], b = stripe[at + 2]
          y[py * mcu + px] = 0.299 * r + 0.587 * g + 0.114 * b - 128
          const c = (py >> sub) * 8 + (px >> sub)
          cb[c] += (-0.168736 * r - 0.331264 * g + 0.5 * b) * w
          cr[c] += (0.5 * r - 0.418688 * g - 0.081312 * b) * w
        }
      }
      for (let n = 0; n < (sub ? 4 : 1); n++) {
        const base = (n >> 1) * 128 + (n & 1) * 8
        for (let i = 0; i < 64; i++) block[i] = y[base + (i >> 3) * mcu + (i & 7)]
        encodeBlock(0, 0)
      }
      block.set(cb)
      encodeBlock(1, 1)
      block.set(cr)
      encodeBlock(2, 1)
    }
  }

  let written = 0, filled = 0
  for await (const data of rows) {
    if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || !data.length || data.length % stride) {
      throw new RangeError('[SnapDOM] JPEG input must contain complete RGBA rows')
    }
    const count = data.length / stride
    if (written + count > height) throw new RangeError('[SnapDOM] JPEG input exceeds the declared height')
    for (let row = 0; row < count;) {
      const take = Math.min(mcu - filled, count - row)
      stripe.set(data.subarray(row * stride, (row + take) * stride), filled * stride)
      filled += take
      row += take
      if (filled === mcu) {
        encodeStripe(mcu)
        filled = 0
      }
    }
    written += count
  }
  if (written !== height) throw new RangeError('[SnapDOM] JPEG input does not match the declared height')
  if (filled) encodeStripe(filled)
  if (bits) put((1 << (8 - bits)) - 1, 8 - bits)
  parts.push(out.subarray(0, pos), new Uint8Array([0xff, 0xd9]))
  return new Blob(parts, { type: 'image/jpeg' })
}
