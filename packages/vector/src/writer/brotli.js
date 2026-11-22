/**
 * A Brotli decoder (RFC 7932), decode only.
 *
 * It is here for one caller: `woff2.js`. WOFF2 is the format nearly every web font
 * is served in, its tables sit behind ONE Brotli stream, and no browser hands a
 * page a Brotli decoder — `DecompressionStream` does gzip and deflate, and
 * `'brotli'` threw in Chromium 140 when this was written (2026-11-22). Without
 * this, a font the page itself is drawn with could not travel in the file.
 *
 * It is loaded lazily (`writer/font.js` imports `woff2.js` with `import()` and only
 * when a WOFF2 arrives), so an export that never meets one never pays for it.
 *
 * Shape, on purpose:
 *
 *  - **The whole output is one growing array.** A back-reference is then a plain
 *    read `distance` bytes behind the write position; the window only bounds how
 *    far back the stream may ask for, it is not a ring to maintain.
 *  - **Prefix codes are decoded bit by bit** from a canonical table (the `puff.c`
 *    method). A font is a few hundred kB; MEASURED on the 37 kB Roboto latin
 *    subset this decodes in a few milliseconds, and a lookup table would be more
 *    code to get wrong for nothing a capture would notice.
 *  - **The static dictionary is not loaded until a stream asks for it.** It is
 *    122,784 bytes (58 kB deflated, in `brotli-dictionary.js`). Binary tables
 *    almost never match English words, but a `name` table's copyright line can, so
 *    the decoder runs without it first and only on a dictionary reference inflates
 *    it and starts again.
 *
 * Checked against Node's own `zlib.brotliDecompressSync` (the reference C decoder):
 * every quality and window size on text, binary and mixed input, and one
 * hand-built stream per dictionary transform, all 121 (`test/verify-woff2.mjs`).
 */

/** The order code-length code lengths arrive in (RFC 7932 §3.5). */
const CODE_LENGTH_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]

/** Block count code -> [base, extra bits] (§6). */
const BLOCK_BASE = [1, 5, 9, 13, 17, 25, 33, 41, 49, 65, 81, 97, 113, 145, 177, 209, 241, 305, 369, 497, 753, 1265, 2289, 4337, 8433, 16625]
const BLOCK_BITS = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24]

/** Insert length code -> [base, extra bits] (§5). */
const INSERT_BASE = [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594]
const INSERT_BITS = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24]

/** Copy length code -> [base, extra bits] (§5). */
const COPY_BASE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118]
const COPY_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24]

/** Which third of the insert and of the copy codes each 64-symbol range of a command uses. */
const INSERT_RANGE = [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16]
const COPY_RANGE = [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16]

/** Distance codes 0..15: which past distance, and how far off it (§4). */
const SHORT_INDEX = [3, 2, 1, 0, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2]
const SHORT_OFFSET = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3]

/** Static dictionary: bits of word index per word length, and where each length starts. */
const DICT_BITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5]
const DICT_OFFSET = (() => {
  const at = new Array(25).fill(0)
  for (let len = 4; len < 24; len++) at[len + 1] = at[len] + (len << DICT_BITS[len])
  return at
})()
export const DICTIONARY_SIZE = DICT_OFFSET[24] + (24 << DICT_BITS[24]) // 122784

// ——— literal context lookup (§7.1) ———

const LUT0 = new Uint8Array(256)
const LUT1 = new Uint8Array(256)
const LUT2 = new Uint8Array(256)
;(() => {
  const row = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 4, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    8, 12, 16, 12, 12, 20, 12, 16, 24, 28, 12, 12, 32, 12, 36, 12,
    44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 32, 32, 24, 40, 28, 12,
    12, 48, 52, 52, 52, 48, 52, 52, 52, 48, 52, 52, 52, 52, 52, 48,
    52, 52, 52, 52, 52, 48, 52, 52, 52, 52, 52, 24, 12, 28, 12, 12,
    12, 56, 60, 60, 60, 56, 60, 60, 60, 56, 60, 60, 60, 60, 60, 56,
    60, 60, 60, 60, 60, 56, 60, 60, 60, 60, 60, 24, 12, 28, 12, 0,
  ]
  for (let i = 0; i < 128; i++) LUT0[i] = row[i]
  for (let i = 128; i < 192; i++) LUT0[i] = i & 1
  for (let i = 192; i < 256; i++) LUT0[i] = 2 + (i & 1)

  const second = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1,
    1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1,
    1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 0,
  ]
  for (let i = 0; i < 128; i++) LUT1[i] = second[i]
  // Lead bytes of two-byte sequences (192..223) are 0; only three- and four-byte leads are 2.
  for (let i = 224; i < 256; i++) LUT1[i] = 2

  for (let i = 1; i < 16; i++) LUT2[i] = 1
  for (let i = 16; i < 64; i++) LUT2[i] = 2
  for (let i = 64; i < 128; i++) LUT2[i] = 3
  for (let i = 128; i < 192; i++) LUT2[i] = 4
  for (let i = 192; i < 240; i++) LUT2[i] = 5
  for (let i = 240; i < 255; i++) LUT2[i] = 6
  LUT2[255] = 7
})()

// ——— dictionary transforms (Appendix B) ———

const ID = 0 // identity; 1..9 = omit last N; 12..20 = omit first N (N = type - 11)
const UF = 10 // uppercase first
const UA = 11 // uppercase all
const OL = (n) => n
const OF = (n) => 11 + n

/** [prefix, type, suffix], in the order of RFC 7932 Appendix B. */
const TRANSFORMS = [
  ['', ID, ''], ['', ID, ' '], [' ', ID, ' '], ['', OF(1), ''], ['', UF, ' '],
  ['', ID, ' the '], [' ', ID, ''], ['s ', ID, ' '], ['', ID, ' of '], ['', UF, ''],
  ['', ID, ' and '], ['', OF(2), ''], ['', OL(1), ''], [', ', ID, ' '], ['', ID, ', '],
  [' ', UF, ' '], ['', ID, ' in '], ['', ID, ' to '], ['e ', ID, ' '], ['', ID, '"'],
  ['', ID, '.'], ['', ID, '">'], ['', ID, '\n'], ['', OL(3), ''], ['', ID, ']'],
  ['', ID, ' for '], ['', OF(3), ''], ['', OL(2), ''], ['', ID, ' a '], ['', ID, ' that '],
  [' ', UF, ''], ['', ID, '. '], ['.', ID, ''], [' ', ID, ', '], ['', OF(4), ''],
  ['', ID, ' with '], ['', ID, "'"], ['', ID, ' from '], ['', ID, ' by '], ['', OF(5), ''],
  ['', OF(6), ''], [' the ', ID, ''], ['', OL(4), ''], ['', ID, '. The '], ['', UA, ''],
  ['', ID, ' on '], ['', ID, ' as '], ['', ID, ' is '], ['', OL(7), ''], ['', OL(1), 'ing '],
  ['', ID, '\n\t'], ['', ID, ':'], [' ', ID, '. '], ['', ID, 'ed '], ['', OF(9), ''],
  ['', OF(7), ''], ['', OL(6), ''], ['', ID, '('], ['', UF, ', '], ['', OL(8), ''],
  ['', ID, ' at '], ['', ID, 'ly '], [' the ', ID, ' of '], ['', OL(5), ''], ['', OL(9), ''],
  [' ', UF, ', '], ['', UF, '"'], ['.', ID, '('], ['', UA, ' '], ['', UF, '">'],
  ['', ID, '="'], [' ', ID, '.'], ['.com/', ID, ''], [' the ', ID, ' of the '], ['', UF, "'"],
  ['', ID, '. This '], ['', ID, ','], ['.', ID, ' '], ['', UF, '('], ['', UF, '.'],
  ['', ID, ' not '], [' ', ID, '="'], ['', ID, 'er '], [' ', UA, ' '], ['', ID, 'al '],
  [' ', UA, ''], ['', ID, "='"], ['', UA, '"'], ['', UF, '. '], [' ', ID, '('],
  ['', ID, 'ful '], [' ', UF, '. '], ['', ID, 'ive '], ['', ID, 'less '], ['', UA, "'"],
  ['', ID, 'est '], [' ', UF, '.'], ['', UA, '">'], [' ', ID, "='"], ['', UF, ','],
  ['', ID, 'ize '], ['', UA, '.'], ['Â ', ID, ''], [' ', ID, ','], ['', UF, '="'],
  ['', UA, '="'], ['', ID, 'ous '], ['', UA, ', '], ['', UF, "='"], [' ', UF, ','],
  [' ', UA, '="'], [' ', UA, ', '], ['', UA, ','], ['', UA, '('], ['', UA, '. '],
  [' ', UA, '.'], ['', UA, "='"], [' ', UA, '. '], [' ', UF, '="'], [' ', UA, "='"],
  [' ', UF, "='"],
].map(([prefix, type, suffix]) => ({
  prefix: Uint8Array.from(prefix, (c) => c.charCodeAt(0)),
  type,
  suffix: Uint8Array.from(suffix, (c) => c.charCodeAt(0)),
}))

/** Brotli's own notion of upper case, on UTF-8 bytes in place. Returns how many it consumed. */
function upperCase (out, at) {
  const c = out[at]
  if (c < 0xc0) {
    if (c >= 97 && c <= 122) out[at] ^= 32
    return 1
  }
  if (c < 0xe0) {
    out[at + 1] ^= 32
    return 2
  }
  out[at + 2] ^= 5
  return 3
}

// ——— the decoder ———

/** Raised when a stream reaches into the static dictionary and none was given. */
export class NeedsDictionary extends Error {}

class Decoder {
  constructor (input, dictionary, sizeHint) {
    this.input = input
    this.at = 0
    this.acc = 0
    this.have = 0
    this.dictionary = dictionary || null
    this.out = new Uint8Array(Math.max(1024, sizeHint || input.length * 4))
    this.pos = 0
  }

  /** `n` bits (0..24), the first one read in the lowest position. */
  bits (n) {
    if (n === 0) return 0
    while (this.have < n) {
      if (this.at >= this.input.length) {
        // A stream may end mid-byte; reading PAST its last byte is corruption.
        if (this.at > this.input.length + 3) throw new Error('brotli: the stream ends before its data does')
        this.at++
        this.have += 8
        continue
      }
      this.acc = (this.acc | (this.input[this.at++] << this.have)) >>> 0
      this.have += 8
    }
    const value = this.acc & ((1 << n) - 1)
    this.acc >>>= n
    this.have -= n
    return value
  }

  alignToByte () {
    const drop = this.have & 7
    if (drop) this.bits(drop)
  }

  room (n) {
    if (this.pos + n <= this.out.length) return
    let size = this.out.length * 2
    while (size < this.pos + n) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.out.subarray(0, this.pos))
    this.out = grown
  }

  /** A canonical prefix code over `lengths` (0 = symbol unused). */
  build (lengths) {
    const count = new Uint16Array(16)
    let used = 0
    let only = -1
    for (let s = 0; s < lengths.length; s++) {
      if (lengths[s]) { count[lengths[s]]++; used++; only = s }
    }
    if (used === 0) throw new Error('brotli: a prefix code with no symbols')
    if (used === 1) return { single: only }
    const offset = new Uint16Array(16)
    for (let len = 1; len < 15; len++) offset[len + 1] = offset[len] + count[len]
    const symbol = new Uint16Array(used)
    for (let s = 0; s < lengths.length; s++) {
      if (lengths[s]) symbol[offset[lengths[s]]++] = s
    }
    return { single: -1, count, symbol }
  }

  /** One symbol of `code`, most significant code bit first. */
  symbol (code) {
    if (code.single >= 0) return code.single
    let value = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= 15; len++) {
      value |= this.bits(1)
      const n = code.count[len]
      if (value - n < first) return code.symbol[index + (value - first)]
      index += n
      first = (first + n) << 1
      value <<= 1
    }
    throw new Error('brotli: a code longer than 15 bits')
  }

  /** §3.4 / §3.5: a prefix code description for an alphabet of `size` symbols. */
  prefixCode (size) {
    const skip = this.bits(2)
    const lengths = new Uint8Array(size)
    if (skip === 1) {
      const n = this.bits(2) + 1
      let width = 0
      for (let v = size - 1; v; v >>= 1) width++
      const symbols = []
      for (let i = 0; i < n; i++) {
        const s = this.bits(width)
        if (s >= size || symbols.includes(s)) throw new Error('brotli: a simple prefix code names a symbol twice or out of range')
        symbols.push(s)
      }
      if (n === 1) return { single: symbols[0] }
      if (n === 2) { lengths[symbols[0]] = 1; lengths[symbols[1]] = 1 }
      if (n === 3) { lengths[symbols[0]] = 1; lengths[symbols[1]] = 2; lengths[symbols[2]] = 2 }
      if (n === 4) {
        if (this.bits(1)) { lengths[symbols[0]] = 1; lengths[symbols[1]] = 2; lengths[symbols[2]] = 3; lengths[symbols[3]] = 3 } else for (const s of symbols) lengths[s] = 2
      }
      return this.build(lengths)
    }

    const codeLengths = new Uint8Array(18)
    let space = 32
    let nonZero = 0
    for (let i = skip; i < 18 && space > 0; i++) {
      let v
      if (!this.bits(1)) v = this.bits(1) ? 3 : 0
      else if (!this.bits(1)) v = 4
      else if (!this.bits(1)) v = 2
      else v = this.bits(1) ? 5 : 1
      codeLengths[CODE_LENGTH_ORDER[i]] = v
      if (v) { space -= 32 >> v; nonZero++ }
    }
    if (nonZero !== 1 && space !== 0) throw new Error('brotli: the code-length code is not a complete prefix code')
    const lengthCode = this.build(codeLengths)

    let i = 0
    let previous = 8
    let repeat = 0
    let repeated = 0
    let left = 32768
    while (i < size && left > 0) {
      const s = this.symbol(lengthCode)
      if (s < 16) {
        lengths[i++] = s
        repeat = 0
        if (s) { previous = s; left -= 32768 >> s }
        continue
      }
      const extra = s === 16 ? 2 : 3
      const value = s === 16 ? previous : 0
      if (repeated !== value) { repeat = 0; repeated = value }
      const before = repeat
      if (repeat > 0) repeat = (repeat - 2) << extra
      repeat += this.bits(extra) + 3
      const more = repeat - before
      if (i + more > size) throw new Error('brotli: a code-length run passes the end of its alphabet')
      for (let k = 0; k < more; k++) lengths[i++] = value
      if (value) left -= more << (15 - value)
    }
    if (left !== 0) throw new Error('brotli: a prefix code is not complete')
    return this.build(lengths)
  }

  /** §9.2: 1..256, in 1 to 11 bits. */
  count256 () {
    if (!this.bits(1)) return 1
    const n = this.bits(3)
    return (1 << n) + 1 + this.bits(n)
  }

  blockCount (code) {
    const c = this.symbol(code)
    return BLOCK_BASE[c] + this.bits(BLOCK_BITS[c])
  }

  /** §7.3. */
  contextMap (size, trees) {
    const map = new Uint8Array(size)
    if (trees < 2) return map
    const runMax = this.bits(1) ? this.bits(4) + 1 : 0
    const code = this.prefixCode(trees + runMax)
    for (let i = 0; i < size;) {
      const s = this.symbol(code)
      if (s === 0) { map[i++] = 0; continue }
      if (s <= runMax) {
        const run = (1 << s) + this.bits(s)
        if (i + run > size) throw new Error('brotli: a context map run passes its end')
        i += run // already zero
        continue
      }
      map[i++] = s - runMax
    }
    if (this.bits(1)) {
      // inverse move-to-front
      const order = new Uint8Array(256)
      for (let k = 0; k < 256; k++) order[k] = k
      for (let k = 0; k < size; k++) {
        const index = map[k]
        const value = order[index]
        map[k] = value
        for (let j = index; j > 0; j--) order[j] = order[j - 1]
        order[0] = value
      }
    }
    return map
  }

  /** One block category (literals, commands or distances): its type and count codes and state. */
  category () {
    const types = this.count256()
    const state = { types, type: 0, previous: 1, typeCode: null, countCode: null, left: 16777216 }
    if (types >= 2) {
      state.typeCode = this.prefixCode(types + 2)
      state.countCode = this.prefixCode(26)
      state.left = this.blockCount(state.countCode)
    }
    return state
  }

  switchBlock (state) {
    const s = this.symbol(state.typeCode)
    let next
    if (s === 0) next = state.previous
    else if (s === 1) next = state.type + 1
    else next = s - 2
    if (next >= state.types) next -= state.types
    state.previous = state.type
    state.type = next
    state.left = this.blockCount(state.countCode)
  }

  run () {
    // §9.1: the window
    let wbits
    if (!this.bits(1)) wbits = 16
    else {
      const n = this.bits(3)
      if (n) wbits = 17 + n
      else {
        const m = this.bits(3)
        if (m === 0) wbits = 17
        else if (m === 1) throw new Error('brotli: large-window streams are not WOFF2')
        else wbits = 8 + m
      }
    }
    const window = (1 << wbits) - 16
    const ring = [16, 15, 11, 4]
    let ringAt = 0

    for (;;) {
      const last = this.bits(1)
      if (last && this.bits(1)) break // ISLASTEMPTY
      const nibbleCode = this.bits(2)
      if (nibbleCode === 3) {
        // a metadata block: skipped
        if (this.bits(1)) throw new Error('brotli: a reserved bit is set')
        const skipBytes = this.bits(2)
        let skip = 0
        for (let i = 0; i < skipBytes; i++) skip |= this.bits(8) << (8 * i)
        if (skipBytes) skip += 1
        this.alignToByte()
        for (let i = 0; i < skip; i++) this.bits(8)
        if (last) break
        continue
      }
      let left = 0
      const nibbles = nibbleCode + 4
      for (let i = 0; i < nibbles; i++) left |= this.bits(4) << (4 * i)
      left += 1

      if (!last && this.bits(1)) {
        // uncompressed
        this.alignToByte()
        this.room(left)
        for (let i = 0; i < left; i++) this.out[this.pos++] = this.bits(8)
        continue
      }

      const L = this.category()
      const I = this.category()
      const D = this.category()
      const postfix = this.bits(2)
      const direct = this.bits(4) << postfix
      const postfixMask = (1 << postfix) - 1
      const modes = new Uint8Array(L.types)
      for (let i = 0; i < L.types; i++) modes[i] = this.bits(2)
      const literalTrees = this.count256()
      const literalMap = this.contextMap(64 * L.types, literalTrees)
      const distanceTrees = this.count256()
      const distanceMap = this.contextMap(4 * D.types, distanceTrees)
      const literalCodes = []
      for (let i = 0; i < literalTrees; i++) literalCodes.push(this.prefixCode(256))
      const commandCodes = []
      for (let i = 0; i < I.types; i++) commandCodes.push(this.prefixCode(704))
      const distanceCodes = []
      for (let i = 0; i < distanceTrees; i++) distanceCodes.push(this.prefixCode(16 + direct + (48 << postfix)))

      while (left > 0) {
        if (I.left === 0) this.switchBlock(I)
        I.left--
        const command = this.symbol(commandCodes[I.type])
        const range = command >> 6
        const insertCode = INSERT_RANGE[range] + ((command >> 3) & 7)
        const copyCode = COPY_RANGE[range] + (command & 7)
        const insert = INSERT_BASE[insertCode] + this.bits(INSERT_BITS[insertCode])
        const copy = COPY_BASE[copyCode] + this.bits(COPY_BITS[copyCode])

        if (insert > left) throw new Error('brotli: more literals than the meta-block has left')
        this.room(insert)
        for (let k = 0; k < insert; k++) {
          if (L.left === 0) this.switchBlock(L)
          L.left--
          const p1 = this.pos > 0 ? this.out[this.pos - 1] : 0
          const p2 = this.pos > 1 ? this.out[this.pos - 2] : 0
          const mode = modes[L.type]
          let context
          if (mode === 0) context = p1 & 0x3f
          else if (mode === 1) context = p1 >> 2
          else if (mode === 2) context = LUT0[p1] | LUT1[p2]
          else context = (LUT2[p1] << 3) | LUT2[p2]
          this.out[this.pos++] = this.symbol(literalCodes[literalMap[L.type * 64 + context]])
        }
        left -= insert
        if (left === 0) break

        let distance
        let push = true
        if (command < 128) {
          distance = ring[(ringAt + 3) & 3]
          push = false
        } else {
          if (D.left === 0) this.switchBlock(D)
          D.left--
          const context = copy > 4 ? 3 : copy - 2
          const code = this.symbol(distanceCodes[distanceMap[D.type * 4 + context]])
          if (code < 16) {
            distance = ring[(ringAt + SHORT_INDEX[code]) & 3] + SHORT_OFFSET[code]
            if (code === 0) push = false
          } else if (code < 16 + direct) {
            distance = code - 15
          } else {
            const v = code - direct - 16
            const nbits = 1 + (v >> (postfix + 1))
            const extra = this.bits(nbits)
            const high = v >> postfix
            const low = v & postfixMask
            const offset = ((2 + (high & 1)) << nbits) - 4
            distance = ((offset + extra) << postfix) + low + direct + 1
          }
        }
        if (!(distance > 0)) throw new Error('brotli: a distance of zero or less')

        const reach = Math.min(window, this.pos)
        if (distance > reach) {
          // §8: a word of the static dictionary, transformed
          if (copy < 4 || copy > 24) throw new Error('brotli: a dictionary reference of impossible length')
          if (!this.dictionary) throw new NeedsDictionary('brotli: the stream uses the static dictionary')
          const id = distance - reach - 1
          const shift = DICT_BITS[copy]
          const index = id & ((1 << shift) - 1)
          const transform = TRANSFORMS[id >> shift]
          if (!transform) throw new Error('brotli: a dictionary transform that does not exist')
          const from = DICT_OFFSET[copy] + index * copy
          let start = from
          let length = copy
          const t = transform.type
          if (t >= 1 && t <= 9) length = Math.max(0, length - t)
          else if (t >= 12) { const cut = Math.min(length, t - 11); start += cut; length -= cut }
          this.room(transform.prefix.length + length + transform.suffix.length)
          this.out.set(transform.prefix, this.pos)
          let at = this.pos + transform.prefix.length
          const word = at
          for (let k = 0; k < length; k++) this.out[at++] = this.dictionary[start + k]
          if (t === UF && length > 0) upperCase(this.out, word)
          else if (t === UA) {
            for (let k = 0; k < length;) k += upperCase(this.out, word + k)
          }
          this.out.set(transform.suffix, at)
          at += transform.suffix.length
          const written = at - this.pos
          this.pos = at
          left -= written
          if (left < 0) throw new Error('brotli: a dictionary word runs past the meta-block')
          continue
        }

        if (push) { ring[ringAt & 3] = distance; ringAt++ }
        if (copy > left) throw new Error('brotli: a copy runs past the meta-block')
        this.room(copy)
        // Byte by byte on purpose: an overlapping copy repeats what it has just written.
        for (let k = 0; k < copy; k++) { this.out[this.pos] = this.out[this.pos - distance]; this.pos++ }
        left -= copy
      }
      if (last) break
    }
    return this.out.subarray(0, this.pos)
  }
}

/**
 * Decode one Brotli stream.
 *
 * @param {Uint8Array} input
 * @param {object} [options]
 * @param {Uint8Array|null} [options.dictionary]  the 122,784-byte static dictionary.
 *   Without it a stream that references it throws `NeedsDictionary`.
 * @param {number} [options.sizeHint]  the decoded size when the caller knows it
 * @returns {Uint8Array}
 */
export function brotliDecodeSync (input, { dictionary = null, sizeHint = 0 } = {}) {
  if (dictionary && dictionary.length !== DICTIONARY_SIZE) {
    throw new Error(`brotli: the static dictionary is ${dictionary.length} bytes, not ${DICTIONARY_SIZE}`)
  }
  return new Decoder(input, dictionary, sizeHint).run()
}

/**
 * Decode one Brotli stream, fetching the static dictionary only if the stream
 * turns out to need it.
 *
 * @param {Uint8Array} input
 * @param {object} [options]
 * @param {number} [options.sizeHint]
 * @param {() => Promise<Uint8Array>} [options.loadDictionary]
 * @returns {Promise<Uint8Array>}
 */
export async function brotliDecode (input, { sizeHint = 0, loadDictionary } = {}) {
  try {
    return brotliDecodeSync(input, { sizeHint })
  } catch (error) {
    if (!(error instanceof NeedsDictionary)) throw error
    const load = loadDictionary || (await import('./brotli-dictionary.js')).loadBrotliDictionary
    return brotliDecodeSync(input, { sizeHint, dictionary: await load() })
  }
}

export default brotliDecode
