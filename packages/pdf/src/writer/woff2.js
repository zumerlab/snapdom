/**
 * WOFF2 -> a plain sfnt (TrueType or OpenType/CFF), so the font the page is drawn
 * with can travel in the exported file.
 *
 * WOFF2 is not a wrapper round the original tables the way WOFF 1 is. Every table
 * sits behind ONE Brotli stream (`brotli.js`), and two of them are stored
 * TRANSFORMED: `glyf` is taken apart into seven parallel streams — contour counts,
 * point counts, flags, coordinates packed as "triplets", composites, bounding
 * boxes, instructions — with `loca` dropped altogether, and `hmtx` may have lost
 * the side bearings that can be read back off the outlines. A viewer cannot use
 * any of that; the tables have to be put back together the way the font compiler
 * wrote them. That is what this file does, to the letter of the W3C
 * recommendation (WOFF File Format 2.0, sections 4 and 5).
 *
 * What it does NOT do, and says so instead:
 *
 *  - **Font collections** (`ttcf` flavour): several faces behind shared tables;
 *    the caller would have to pick one and this exporter never knows which.
 *  - **Byte-for-byte identity with the original .ttf.** The transform is lossless
 *    for what a renderer reads — every point, flag meaning, instruction and
 *    metric — but not for how the compiler happened to pack them: flag runs are
 *    written unrepeated here and glyphs are padded to four bytes. The outlines are
 *    the same outlines (`test/verify-woff2.mjs` draws both and compares pixels).
 *
 * Loaded with `import()` from `font.js`, and only when a WOFF2 arrives.
 */

import { brotliDecode } from './brotli.js'

/** The 63 tags a table directory entry names by number (section 4.1). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

const fail = (message) => { throw new Error(`woff2: ${message}`) }

/** A forward-only reader over one stream of the transformed data. */
class Reader {
  constructor (bytes, start = 0, end = bytes.length) {
    this.b = bytes
    this.at = start
    this.end = end
  }

  need (n) { if (this.at + n > this.end) fail('a stream ends before its data does') }
  u8 () { this.need(1); return this.b[this.at++] }
  u16 () { this.need(2); const v = (this.b[this.at] << 8) | this.b[this.at + 1]; this.at += 2; return v }
  i16 () { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v }
  u32 () { this.need(4); const b = this.b; const v = ((b[this.at] << 24) | (b[this.at + 1] << 16) | (b[this.at + 2] << 8) | b[this.at + 3]) >>> 0; this.at += 4; return v }
  bytes (n) { this.need(n); const v = this.b.subarray(this.at, this.at + n); this.at += n; return v }

  /** UIntBase128: up to five bytes, seven bits each, no leading zeros. */
  base128 () {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      if (i === 0 && byte === 0x80) fail('a UIntBase128 with a leading zero')
      if (value > 0x1ffffff) fail('a UIntBase128 past 32 bits')
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    fail('a UIntBase128 longer than five bytes')
  }

  /** 255UInt16: one to three bytes. */
  u255 () {
    const code = this.u8()
    if (code === 253) return this.u16()
    if (code === 255) return this.u8() + 253
    if (code === 254) return this.u8() + 506
    return code
  }
}

/** A byte sink that grows. */
class Sink {
  constructor (size = 1024) { this.b = new Uint8Array(size); this.n = 0 }
  room (k) {
    if (this.n + k <= this.b.length) return
    let size = this.b.length * 2
    while (size < this.n + k) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.b.subarray(0, this.n))
    this.b = grown
  }

  u8 (v) { this.room(1); this.b[this.n++] = v & 0xff }
  u16 (v) { this.room(2); this.b[this.n++] = (v >> 8) & 0xff; this.b[this.n++] = v & 0xff }
  u32 (v) { this.room(4); this.b[this.n++] = (v >>> 24) & 0xff; this.b[this.n++] = (v >>> 16) & 0xff; this.b[this.n++] = (v >>> 8) & 0xff; this.b[this.n++] = v & 0xff }
  put (bytes) { this.room(bytes.length); this.b.set(bytes, this.n); this.n += bytes.length }
  pad (to) { while (this.n % to) this.u8(0) }
  done () { return this.b.subarray(0, this.n) }
}

const sign = (flag, value) => (flag & 1 ? value : -value)

/**
 * `glyf` and `loca` back from the transformed table (section 5.1).
 *
 * @param {Uint8Array} data  the transformed glyf table
 * @returns {{glyf: Uint8Array, loca: Uint8Array, indexFormat: number, numGlyphs: number, xMins: Int16Array}}
 */
function rebuildGlyf (data) {
  const head = new Reader(data)
  head.u16() // reserved
  const options = head.u16()
  const numGlyphs = head.u16()
  const indexFormat = head.u16()
  const sizes = []
  for (let i = 0; i < 7; i++) sizes.push(head.u32())
  let at = head.at
  const stream = (size) => { const r = new Reader(data, at, at + size); if (at + size > data.length) fail('a glyf stream runs past the table'); at += size; return r }
  const contours = stream(sizes[0])
  const points = stream(sizes[1])
  const flags = stream(sizes[2])
  const glyphs = stream(sizes[3])
  const composites = stream(sizes[4])
  const bboxes = stream(sizes[5])
  const instructions = stream(sizes[6])
  // The bbox stream opens with one bit per glyph: "this glyph's box is stored".
  const bitmapSize = 4 * Math.floor((numGlyphs + 31) / 32)
  const bboxBitmap = bboxes.bytes(bitmapSize)
  // Optional: one bit per glyph for OVERLAP_SIMPLE, which the flag stream has no room for.
  const overlapBitmap = options & 1 ? new Reader(data, at, data.length).bytes(Math.floor((numGlyphs + 7) / 8)) : null

  const out = new Sink(Math.max(1024, data.length * 2))
  const offsets = new Uint32Array(numGlyphs + 1)
  const xMins = new Int16Array(numGlyphs)

  for (let g = 0; g < numGlyphs; g++) {
    offsets[g] = out.n
    const nContours = contours.i16()
    const hasBox = !!(bboxBitmap[g >> 3] & (0x80 >> (g & 7)))

    if (nContours === 0) {
      if (hasBox) fail('an empty glyph with a stored bounding box')
      continue
    }

    if (nContours > 0) {
      // a simple glyph
      const ends = new Uint16Array(nContours)
      let total = 0
      for (let c = 0; c < nContours; c++) {
        total += points.u255()
        if (total > 0xffff + 1) fail('a glyph with more points than a glyph can have')
        ends[c] = total - 1
      }
      const xs = new Int32Array(total)
      const ys = new Int32Array(total)
      const on = new Uint8Array(total)
      let x = 0
      let y = 0
      let xMin = 0
      let yMin = 0
      let xMax = 0
      let yMax = 0
      for (let p = 0; p < total; p++) {
        let flag = flags.u8()
        on[p] = flag & 0x80 ? 0 : 1
        flag &= 0x7f
        let dx
        let dy
        if (flag < 10) {
          dx = 0
          dy = sign(flag, ((flag & 14) << 7) + glyphs.u8())
        } else if (flag < 20) {
          dx = sign(flag, (((flag - 10) & 14) << 7) + glyphs.u8())
          dy = 0
        } else if (flag < 84) {
          const b0 = flag - 20
          const b1 = glyphs.u8()
          dx = sign(flag, 1 + (b0 & 0x30) + (b1 >> 4))
          dy = sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))
        } else if (flag < 120) {
          const b0 = flag - 84
          dx = sign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphs.u8())
          dy = sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8())
        } else if (flag < 124) {
          const b0 = glyphs.u8()
          const b1 = glyphs.u8()
          const b2 = glyphs.u8()
          dx = sign(flag, (b0 << 4) + (b1 >> 4))
          dy = sign(flag >> 1, ((b1 & 0x0f) << 8) + b2)
        } else {
          dx = sign(flag, glyphs.u16())
          dy = sign(flag >> 1, glyphs.u16())
        }
        x += dx
        y += dy
        xs[p] = x
        ys[p] = y
        if (p === 0) { xMin = xMax = x; yMin = yMax = y } else {
          if (x < xMin) xMin = x
          if (x > xMax) xMax = x
          if (y < yMin) yMin = y
          if (y > yMax) yMax = y
        }
      }
      const instructionLength = glyphs.u255()
      const code = instructions.bytes(instructionLength)
      if (hasBox) { xMin = bboxes.i16(); yMin = bboxes.i16(); xMax = bboxes.i16(); yMax = bboxes.i16() }
      xMins[g] = xMin

      out.u16(nContours)
      out.u16(xMin); out.u16(yMin); out.u16(xMax); out.u16(yMax)
      for (let c = 0; c < nContours; c++) out.u16(ends[c])
      out.u16(instructionLength)
      out.put(code)
      // Flags, one per point and unrepeated: fewer ways to be wrong than a run-length
      // pass, at a cost in bytes the file's own compression takes back.
      const overlap = overlapBitmap && (overlapBitmap[g >> 3] & (0x80 >> (g & 7)))
      const dxs = new Int32Array(total)
      const dys = new Int32Array(total)
      for (let p = 0; p < total; p++) {
        dxs[p] = xs[p] - (p ? xs[p - 1] : 0)
        dys[p] = ys[p] - (p ? ys[p - 1] : 0)
        let f = on[p] ? 0x01 : 0
        const ax = Math.abs(dxs[p])
        const ay = Math.abs(dys[p])
        if (dxs[p] === 0) f |= 0x10 // same x, no bytes
        else if (ax < 256) f |= 0x02 | (dxs[p] > 0 ? 0x10 : 0) // one byte, bit 4 = positive
        if (dys[p] === 0) f |= 0x20
        else if (ay < 256) f |= 0x04 | (dys[p] > 0 ? 0x20 : 0)
        if (p === 0 && overlap) f |= 0x40
        out.u8(f)
      }
      for (let p = 0; p < total; p++) {
        const d = dxs[p]
        if (d === 0) continue
        if (Math.abs(d) < 256) out.u8(Math.abs(d))
        else out.u16(d)
      }
      for (let p = 0; p < total; p++) {
        const d = dys[p]
        if (d === 0) continue
        if (Math.abs(d) < 256) out.u8(Math.abs(d))
        else out.u16(d)
      }
      out.pad(4)
      continue
    }

    // a composite glyph: its component records are stored as they were
    if (nContours !== -1) fail('a glyph with a negative contour count other than -1')
    if (!hasBox) fail('a composite glyph without a stored bounding box')
    const start = composites.at
    let more = true
    let withInstructions = false
    while (more) {
      const f = composites.u16()
      composites.u16() // glyph index
      let args = f & 0x0001 ? 4 : 2
      if (f & 0x0008) args += 2
      else if (f & 0x0040) args += 4
      else if (f & 0x0080) args += 8
      composites.bytes(args)
      if (f & 0x0100) withInstructions = true
      more = !!(f & 0x0020)
    }
    const records = data.subarray(start, composites.at)
    const xMin = bboxes.i16()
    const yMin = bboxes.i16()
    const xMax = bboxes.i16()
    const yMax = bboxes.i16()
    xMins[g] = xMin
    out.u16(0xffff)
    out.u16(xMin); out.u16(yMin); out.u16(xMax); out.u16(yMax)
    out.put(records)
    if (withInstructions) {
      const instructionLength = glyphs.u255()
      out.u16(instructionLength)
      out.put(instructions.bytes(instructionLength))
    }
    out.pad(4)
  }
  offsets[numGlyphs] = out.n

  const glyf = out.done().slice()
  const loca = new Sink((numGlyphs + 1) * (indexFormat ? 4 : 2))
  for (let g = 0; g <= numGlyphs; g++) {
    if (indexFormat) loca.u32(offsets[g])
    else {
      if (offsets[g] > 0x1fffe) fail('a short loca for a glyf table that is too large for it')
      loca.u16(offsets[g] >> 1)
    }
  }
  return { glyf, loca: loca.done().slice(), indexFormat, numGlyphs, xMins }
}

/** `hmtx` back from the transformed table: the left side bearings it dropped are the glyphs' xMin (section 5.4). */
function rebuildHmtx (data, numGlyphs, numHMetrics, xMins) {
  const r = new Reader(data)
  const flags = r.u8()
  if (flags & 0xfc) fail('an hmtx transform with reserved flag bits set')
  const proportionalFromGlyf = !!(flags & 1)
  const monospaceFromGlyf = !!(flags & 2)
  if (!proportionalFromGlyf && !monospaceFromGlyf) fail('an hmtx transform that transforms nothing')
  if (numHMetrics < 1 || numHMetrics > numGlyphs) fail('an hhea that counts more metrics than there are glyphs')
  const advances = new Uint16Array(numHMetrics)
  for (let i = 0; i < numHMetrics; i++) advances[i] = r.u16()
  const out = new Sink(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2)
  const lsb = new Int16Array(numGlyphs)
  for (let g = 0; g < numHMetrics; g++) lsb[g] = proportionalFromGlyf ? xMins[g] : r.i16()
  for (let g = numHMetrics; g < numGlyphs; g++) lsb[g] = monospaceFromGlyf ? xMins[g] : r.i16()
  for (let g = 0; g < numHMetrics; g++) { out.u16(advances[g]); out.u16(lsb[g]) }
  for (let g = numHMetrics; g < numGlyphs; g++) out.u16(lsb[g])
  return out.done().slice()
}

/** The table checksum of the OpenType spec: big-endian uint32 words, zero-padded, summed mod 2^32. */
function checksum (bytes) {
  let sum = 0
  const whole = bytes.length & ~3
  for (let i = 0; i < whole; i += 4) {
    sum = (sum + (((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0)) >>> 0
  }
  if (whole < bytes.length) {
    let last = 0
    for (let i = whole; i < bytes.length; i++) last |= bytes[i] << (24 - 8 * (i - whole))
    sum = (sum + (last >>> 0)) >>> 0
  }
  return sum
}

const tagBytes = (tag) => [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)]

/**
 * @param {Uint8Array} bytes  a WOFF2 file
 * @param {object} [options]
 * @param {(input: Uint8Array, options: object) => Promise<Uint8Array>} [options.decode]
 *   the Brotli decoder to use; `brotli.js`'s by default
 * @returns {Promise<{sfnt: Uint8Array}|{error: string}>} the same shape `sfntFromBytes` answers with
 */
export async function woff2ToSfnt (bytes, { decode = brotliDecode } = {}) {
  try {
    const r = new Reader(bytes)
    if (r.u32() !== 0x774f4632) return { error: 'not a WOFF2 file' }
    const flavor = r.u32()
    r.u32() // length
    const numTables = r.u16()
    r.u16() // reserved
    r.u32() // totalSfntSize: a hint, and not one to allocate by
    const compressedSize = r.u32()
    r.bytes(24) // version, metadata and private blocks: nothing a renderer reads
    if (flavor === 0x74746366) {
      return { error: 'a WOFF2 font collection holds several faces behind shared tables; embedding it would leave the face choice to the viewer' }
    }
    if (!numTables || numTables > 512) return { error: 'a WOFF2 header that declares an implausible table count' }

    const tables = []
    let total = 0
    for (let i = 0; i < numTables; i++) {
      const flags = r.u8()
      const index = flags & 0x3f
      const tag = index === 63 ? String.fromCharCode(...r.bytes(4)) : KNOWN_TAGS[index]
      const version = flags >> 6
      const origLength = r.base128()
      // glyf and loca are transformed at version 0 and left alone at 3; every other table the other way round.
      const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
      const length = transformed ? r.base128() : origLength
      if (tag === 'loca' && transformed && length !== 0) fail('a transformed loca that carries data')
      tables.push({ tag, transformed, origLength, length, offset: total, data: null })
      total += length
    }
    if (r.at + compressedSize > bytes.length) return { error: 'a WOFF2 whose compressed data runs past the file' }
    const data = await decode(bytes.subarray(r.at, r.at + compressedSize), { sizeHint: total })
    if (data.length !== total) return { error: `a WOFF2 that decompressed to ${data.length} bytes where its directory promises ${total}` }

    const by = new Map()
    for (const t of tables) {
      if (by.has(t.tag)) return { error: `a WOFF2 that declares the table "${t.tag}" twice` }
      t.data = data.subarray(t.offset, t.offset + t.length)
      by.set(t.tag, t)
    }

    const glyf = by.get('glyf')
    const loca = by.get('loca')
    let rebuilt = null
    if (glyf && glyf.transformed) {
      if (!loca || !loca.transformed) return { error: 'a WOFF2 with a transformed glyf and no transformed loca' }
      rebuilt = rebuildGlyf(glyf.data)
      glyf.data = rebuilt.glyf
      loca.data = rebuilt.loca
      // The format the offsets were just written in is the one `head` has to announce.
      const head = by.get('head')
      if (head && head.data.length >= 52) {
        head.data = head.data.slice()
        head.data[50] = 0
        head.data[51] = rebuilt.indexFormat ? 1 : 0
      }
    } else if ((glyf && !loca) || (loca && !glyf)) {
      return { error: 'a WOFF2 with only one of glyf and loca' }
    }

    const hmtx = by.get('hmtx')
    if (hmtx && hmtx.transformed) {
      const hhea = by.get('hhea')
      if (!rebuilt || !hhea || hhea.data.length < 36) return { error: 'a WOFF2 whose hmtx depends on outlines it does not carry' }
      const numHMetrics = (hhea.data[34] << 8) | hhea.data[35]
      hmtx.data = rebuildHmtx(hmtx.data, rebuilt.numGlyphs, numHMetrics, rebuilt.xMins)
    }
    for (const t of tables) {
      if (t.transformed && t.tag !== 'glyf' && t.tag !== 'loca' && t.tag !== 'hmtx') {
        return { error: `a WOFF2 that transforms the table "${t.tag}", which this reader has no inverse for` }
      }
    }

    // ——— the sfnt: directory sorted by tag, tables on four-byte boundaries ———
    const sorted = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    const head = by.get('head')
    if (head) {
      // checkSumAdjustment is computed over a file in which it is zero.
      if (head.data.length < 12) return { error: 'a WOFF2 whose head table is too short to be one' }
      head.data = head.data.slice()
      head.data[8] = head.data[9] = head.data[10] = head.data[11] = 0
    }
    let entropy = 0
    while ((1 << (entropy + 1)) <= numTables) entropy++
    const searchRange = (1 << entropy) * 16
    const out = new Sink(12 + numTables * 16 + sorted.reduce((n, t) => n + t.data.length + 4, 0))
    out.u32(flavor)
    out.u16(numTables)
    out.u16(searchRange)
    out.u16(entropy)
    out.u16(numTables * 16 - searchRange)
    let offset = 12 + numTables * 16
    for (const t of sorted) {
      out.put(tagBytes(t.tag))
      out.u32(checksum(t.data))
      out.u32(offset)
      out.u32(t.data.length)
      t.at = offset
      offset += (t.data.length + 3) & ~3
    }
    for (const t of sorted) { out.put(t.data); out.pad(4) }
    const sfnt = out.done().slice()
    if (head) {
      const adjust = (0xb1b0afba - checksum(sfnt)) >>> 0
      sfnt[head.at + 8] = (adjust >>> 24) & 0xff
      sfnt[head.at + 9] = (adjust >>> 16) & 0xff
      sfnt[head.at + 10] = (adjust >>> 8) & 0xff
      sfnt[head.at + 11] = adjust & 0xff
    }
    return { sfnt }
  } catch (error) {
    return { error: `the WOFF2 could not be rebuilt: ${error && error.message ? error.message : String(error)}` }
  }
}

export default woff2ToSfnt
