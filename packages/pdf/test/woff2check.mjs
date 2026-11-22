/**
 * WOFF2 -> sfnt: the Brotli decoder and the table reconstruction, against things
 * that are not this code.
 *
 *   node test/woff2check.mjs
 *
 * Three questions, three referees:
 *
 *  1. **Is the Brotli decoder right?** Node's `zlib` is the reference C decoder.
 *     Text, binary and mixed input is compressed at every quality worth
 *     distinguishing and several windows, and `brotli.js` has to give the bytes
 *     back. Then one hand-built stream per dictionary transform — all 121 of them,
 *     at every word length — is decoded by both.
 *  2. **Is the dictionary the dictionary?** Its SHA-256 is the Brotli project's.
 *  3. **Is the rebuilt font the same font?** The browser decides, twice: it has to
 *     ACCEPT the rebuilt sfnt as a font at all (its sanitizer rejects a table that
 *     is malformed), and then text drawn with the original WOFF2 and with the
 *     rebuilt file has to come out pixel for pixel the same, with the same
 *     advances — plain text, a sample of every font's own character set, and both
 *     ends of a variable font's weight axis.
 */
import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
import { loadChromium, instrument, check, report, setFixture } from './harness.mjs'
import { brotliDecodeSync, brotliDecode, NeedsDictionary, DICTIONARY_SIZE } from '../src/writer/brotli.js'
import { loadBrotliDictionary } from '../src/writer/brotli-dictionary.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '../..')
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

// ——— 1 and 2: Brotli, against zlib ———

setFixture('brotli')
const dictionary = await loadBrotliDictionary()
check('the static dictionary is the Brotli project\'s, byte for byte',
  dictionary.length === DICTIONARY_SIZE &&
  crypto.createHash('sha256').update(dictionary).digest('hex') === '20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70',
  `${dictionary.length} bytes`)

{
  const text = fs.readFileSync(path.join(REPO, 'README.md'))
  const html = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'mega.html'))
  const code = fs.readFileSync(path.join(ROOT, 'src', 'writer', 'brotli.js'))
  const font = fs.readFileSync(path.join(ROOT, 'demo', 'fonts', 'Inter-400.ttf')).subarray(0, 300000)
  // Fixed bytes rather than random ones: a failure has to be the same failure tomorrow.
  const noise = Buffer.alloc(60000)
  for (let i = 0, s = 12345; i < noise.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; noise[i] = s >>> 16 }
  const inputs = {
    text,
    html,
    code,
    font,
    noise,
    repeats: Buffer.alloc(150000, 'abcabcabd'),
    utf8: Buffer.from('El niño comió ñandú. Ünïcödé — “comillas” … 日本語のテキスト 한국어 Ελληνικά العربية '.repeat(300)),
    empty: Buffer.alloc(0),
    oneByte: Buffer.from('x'),
    short: Buffer.from('The quick brown fox. '),
    mixed: Buffer.concat([text.subarray(0, 20000), noise.subarray(0, 5000), html.subarray(0, 20000), font.subarray(0, 30000)]),
  }
  let tried = 0
  const wrong = []
  for (const [name, data] of Object.entries(inputs)) {
    for (const quality of [0, 1, 2, 4, 5, 9, 10, 11]) {
      for (const window of [10, 16, 22, 24]) {
        for (const mode of [0, 1, 2]) {
          tried++
          const packed = zlib.brotliCompressSync(data, { params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
            [zlib.constants.BROTLI_PARAM_LGWIN]: window,
            [zlib.constants.BROTLI_PARAM_MODE]: mode,
          } })
          try {
            if (!same(brotliDecodeSync(packed, { dictionary }), data)) wrong.push(`${name} q${quality} w${window} m${mode}: different bytes`)
          } catch (error) {
            wrong.push(`${name} q${quality} w${window} m${mode}: ${error.message}`)
          }
        }
      }
    }
  }
  check('brotli.js gives back what zlib compressed, at every quality, window and mode',
    wrong.length === 0, wrong.length ? `${wrong.length} of ${tried} wrong — ${wrong.slice(0, 4).join(' | ')}` : `${tried} streams`)

  const wordy = zlib.brotliCompressSync(Buffer.from('information about the international development of the government and the university'))
  let asked = false
  try { brotliDecodeSync(wordy) } catch (error) { asked = error instanceof NeedsDictionary }
  check('without the dictionary, a stream that needs it says so instead of guessing', asked)
  check('brotliDecode() loads the dictionary by itself when a stream needs it',
    Buffer.from(await brotliDecode(wordy)).toString().startsWith('information about the international'))
}

{
  // One stream per transform: nothing inserted, one copy, a distance that lands in the
  // dictionary at position 0. Every prefix code has a single symbol, so the stream is the
  // header, the three code descriptions and the extra bits of that one command.
  const BITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5]
  const COPY_BASE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118]
  const COPY_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24]
  class Writer {
    constructor () { this.bytes = []; this.acc = 0; this.n = 0 }
    put (value, count) {
      for (let i = 0; i < count; i++) {
        this.acc |= ((value >>> i) & 1) << this.n
        if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0 }
      }
    }

    done () { if (this.n) this.bytes.push(this.acc); return Buffer.from(this.bytes) }
  }
  const stream = (length, index, transform, outputLength) => {
    const w = new Writer()
    w.put(0, 1) // 16-bit window
    w.put(1, 1); w.put(0, 1) // last meta-block, not empty
    w.put(0, 2); w.put(outputLength - 1, 16) // MLEN in four nibbles
    w.put(0, 1); w.put(0, 1); w.put(0, 1) // one block type per category
    w.put(0, 2); w.put(0, 4); w.put(0, 2) // NPOSTFIX, NDIRECT, the context mode
    w.put(0, 1); w.put(0, 1) // one literal tree, one distance tree
    w.put(1, 2); w.put(0, 2); w.put(0, 8) // literals: a one-symbol code
    const copy = COPY_BASE.findIndex((base, i) => length >= base && length < base + (1 << COPY_BITS[i]))
    const command = copy < 8 ? 128 + copy : copy < 16 ? 192 + (copy - 8) : 384 + (copy - 16)
    w.put(1, 2); w.put(0, 2); w.put(command, 10) // commands: a one-symbol code
    const distance = 1 + index + (transform << BITS[length])
    const v = distance + 3
    const nbits = 31 - Math.clz32(v) - 1
    const half = (v >> nbits) & 1
    w.put(1, 2); w.put(0, 2); w.put(16 + 2 * (nbits - 1) + half, 6) // distances: a one-symbol code
    w.put(length - COPY_BASE[copy], COPY_BITS[copy])
    w.put(v - ((2 + half) << nbits), nbits)
    return w.done()
  }
  let compared = 0
  const seen = new Set()
  const wrong = []
  for (let transform = 0; transform < 121; transform++) {
    for (let length = 4; length <= 24; length++) {
      for (const index of [0, 1, 7, (1 << BITS[length]) - 1]) {
        // zlib says how long the transformed word is: only one MLEN decodes.
        let truth = null
        for (let n = 1; n <= length + 16 && !truth; n++) {
          try { const out = zlib.brotliDecompressSync(stream(length, index, transform, n)); if (out.length === n) truth = out } catch { /* not that long */ }
        }
        if (!truth) continue // a transform that leaves nothing of a short word: no stream can say so
        compared++
        try {
          if (same(brotliDecodeSync(stream(length, index, transform, truth.length), { dictionary }), truth)) seen.add(transform)
          else wrong.push(`transform ${transform}, a ${length}-letter word`)
        } catch (error) {
          wrong.push(`transform ${transform}, a ${length}-letter word: ${error.message}`)
        }
      }
    }
  }
  check('every dictionary transform writes what zlib writes',
    wrong.length === 0 && seen.size === 121,
    wrong.length ? wrong.slice(0, 4).join(' | ') : `${seen.size} of 121 transforms, ${compared} words`)
}

// ——— 3: the rebuilt font, judged by the browser ———

const FONTS = [
  ['__tests__/fixtures/fonts/inter-400.woff2', {}],
  ['__tests__/fixtures/fonts/inter-700.woff2', {}],
  ['__tests__/fixtures/fonts/jbmono-400.woff2', {}],
  ['__tests__/fixtures/fonts/mathjax-zero.woff2', {}],
  ['__tests__/fixtures/fonts/astral-icons.woff2', {}],
  ['demos/assets/fonts/roboto/roboto-latin.woff2', { variable: true }],
  ['demos/assets/fonts/roboto/roboto-greek.woff2', { variable: true }],
  ['demos/assets/fonts/roboto/roboto-math.woff2', { variable: true }],
  ['demos/assets/fonts/material-icons/material-icons.woff2', {}],
  ['docs/assets/fonts/roboto-mono.woff2', {}],
  ['docs/assets/fonts/roboto-italic.woff2', {}],
].filter(([file]) => fs.existsSync(path.join(REPO, file)))

const server = await serve(0)
const browser = await (await loadChromium(ROOT)).launch()
try {
  const page = await browser.newPage()
  const { errors } = instrument(page)
  await page.goto(`http://localhost:${server.port}/test/fixtures/fonts.html`)
  for (const [file, { variable }] of FONTS) {
    setFixture(path.basename(file))
    const r = await page.evaluate(async ({ url, variable }) => {
      const { sfntFromBytes, parseFont } = await import('/src/writer/font.js')
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      const started = performance.now()
      const read = await sfntFromBytes(bytes)
      const ms = performance.now() - started
      if (read.error) return { error: read.error }
      const parsed = parseFont(read.sfnt)
      if (parsed.error) return { error: `parseFont: ${parsed.error}` }
      const descriptors = variable ? { weight: '100 900' } : {}
      const original = new FontFace('WOriginal', bytes.buffer.slice(0), descriptors)
      const rebuilt = new FontFace('WRebuilt', read.sfnt.buffer.slice(read.sfnt.byteOffset, read.sfnt.byteOffset + read.sfnt.byteLength), descriptors)
      try { await original.load() } catch (e) { return { error: `the browser refuses the ORIGINAL: ${e.message}` } }
      try { await rebuilt.load() } catch (e) { return { accepted: false, why: String(e && e.message) } }
      document.fonts.add(original); document.fonts.add(rebuilt)

      // The font's own characters, evenly sampled, next to a line anybody can read.
      const points = [...parsed.cmap.keys()].filter((cp) => cp > 32).sort((a, b) => a - b)
      const step = Math.max(1, Math.floor(points.length / 320))
      const sample = []
      for (let i = 0; i < points.length; i += step) sample.push(String.fromCodePoint(points[i]))
      const lines = ['Hamburgefonstiv 0123456789 AVTo fi ÁÉñ', ...Array.from({ length: Math.ceil(sample.length / 40) }, (_, i) => sample.slice(i * 40, i * 40 + 40).join(''))]
      const draw = (family, size, weight) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1400
        canvas.height = Math.ceil(lines.length * size * 1.5 + size)
        const g = canvas.getContext('2d', { willReadFrequently: true })
        g.fillStyle = '#fff'
        g.fillRect(0, 0, canvas.width, canvas.height)
        g.fillStyle = '#000'
        g.font = `${weight} ${size}px ${family}`
        const widths = lines.map((line, i) => { g.fillText(line, 8, size * 1.5 * (i + 1)); return g.measureText(line).width })
        return { data: g.getImageData(0, 0, canvas.width, canvas.height).data, widths }
      }
      let off = 0
      let ink = 0
      let widths = true
      const runs = []
      for (const weight of variable ? [100, 400, 700, 900] : [400]) {
        for (const size of [13, 24, 61]) {
          const a = draw('WOriginal', size, weight)
          const b = draw('WRebuilt', size, weight)
          let differ = 0
          for (let i = 0; i < a.data.length; i += 4) {
            if (a.data[i] !== 255) ink++
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) differ++
          }
          off += differ
          if (a.widths.some((w, i) => w !== b.widths[i])) widths = false
          runs.push(`${weight}/${size}px ${differ}`)
        }
      }
      return { accepted: true, off, ink, widths, glyphs: parsed.numGlyphs, sampled: sample.length, runs: runs.join(', '), ms, from: bytes.length, to: read.sfnt.length }
    }, { url: `/snapdom/${file}`, variable: !!variable })
    if (r.error) { check('the WOFF2 is rebuilt into an sfnt', false, r.error); continue }
    check('the browser accepts the rebuilt sfnt as a font', r.accepted === true, r.accepted ? `${(r.from / 1024).toFixed(0)} kB -> ${(r.to / 1024).toFixed(0)} kB in ${r.ms.toFixed(0)}ms` : r.why)
    if (!r.accepted) continue
    check('text drawn with the rebuilt font is pixel-identical to the original WOFF2',
      r.off === 0 && r.ink > 0, `${r.off} pixels differ of ${r.ink} inked; ${r.sampled} of the font's characters sampled, ${r.glyphs} glyphs — ${r.runs}`)
    check('every line measures the same in both', r.widths === true)
  }
  setFixture('page')
  check('no page error while the fonts were rebuilt', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  server.close()
}
report()
