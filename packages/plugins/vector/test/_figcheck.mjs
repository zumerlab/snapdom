// The bug that mattered: the plugin rejected the engine's own payload. This runs
// the REAL `figma-plugin/code.js` — the file the sandbox loads, not a
// copy of its logic — against every saved .svd.json, through `svdToFigma` and
// then through the plugin's own `readPayload` + `build`, on a simulated Figma API.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { svdToFigma } from '../src/emit/figma-json.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out/vector')
const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']

// ——— a Figma sandbox that is strict where the real one is strict ———
const FACES = [
  'Inter', 'Roboto', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman',
  'Courier New', 'SF Pro Text', 'SF Pro Display', 'Menlo', 'system-ui',
]
const STYLES = ['Thin', 'Light', 'Regular', 'Italic', 'Medium', 'Semi Bold', 'Bold', 'Bold Italic', 'Black']

let created = 0
class FigNode {
  constructor (type) {
    this.type = type
    this.children = []
    this.parent = null
    this.x = 0; this.y = 0; this.width = 1; this.height = 1
    this.characters = ''
    this.pluginData = {}
    created++
  }
  appendChild (child) { child.parent = this; this.children.push(child) }
  resize (w, h) {
    if (!(w > 0) || !(h > 0)) throw new Error(`resize(${w}, ${h}): Figma refuses non-positive dimensions`)
    this.width = w; this.height = h
  }
  resizeWithoutConstraints (w, h) { this.resize(w, h) }
  setPluginData (k, v) {
    if (typeof v !== 'string') throw new Error(`setPluginData(${k}): value must be a string, got ${typeof v}`)
    this.pluginData[k] = v
  }
  getPluginData (k) { return this.pluginData[k] || '' }
  setRangeFontName (s, e) { this.#range('fontName', s, e) }
  setRangeFontSize (s, e) { this.#range('fontSize', s, e) }
  setRangeFills (s, e) { this.#range('fills', s, e) }
  setRangeTextDecoration (s, e) { this.#range('decoration', s, e) }
  setRangeTextDecorationStyle (s, e) { this.#range('decorationStyle', s, e) }
  setRangeTextDecorationColor (s, e) { this.#range('decorationColor', s, e) }
  setRangeTextDecorationThickness (s, e) { this.#range('decorationThickness', s, e) }
  setRangeHyperlink (s, e) { this.#range('hyperlink', s, e) }
  // Both are applied by `buildText` now (tracking per run, and small caps, which
  // `text-transform` does not encode into `characters`). Present here so the range
  // bounds are checked: a stub missing the method turns a real out-of-range call into
  // a caught "not a function" and the payload "passes".
  setRangeLetterSpacing (s, e, v) {
    this.#range('letterSpacing', s, e)
    if (!v || typeof v.value !== 'number' || (v.unit !== 'PIXELS' && v.unit !== 'PERCENT')) {
      throw new Error(`letterSpacing: needs {unit:'PIXELS'|'PERCENT', value:number}, got ${JSON.stringify(v)}`)
    }
  }
  setRangeTextCase (s, e, v) {
    this.#range('textCase', s, e)
    const OK = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED']
    if (OK.indexOf(v) < 0) throw new Error(`textCase: ${v} is not one of ${OK.join(', ')}`)
  }
  // The real API throws on an out-of-bounds or inverted range; so does this one,
  // because a silently ignored setRange is exactly how a payload "passes".
  #range (what, s, e) {
    if (!Number.isInteger(s) || !Number.isInteger(e)) throw new Error(`${what}: range must be integers (${s}, ${e})`)
    if (s < 0 || e > this.characters.length || e <= s) {
      throw new Error(`${what}: range ${s}..${e} is outside characters (length ${this.characters.length})`)
    }
  }
  remove () { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this) }
}

function makeFigma () {
  created = 0
  const page = new FigNode('PAGE')
  return {
    skipInvisibleInstanceChildren: false,
    currentPage: page,
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView () {} },
    ui: { postMessage () {}, onmessage: null },
    showUI () {},
    notify () {},
    closePlugin () {},
    base64Decode: (b64) => Buffer.from(b64, 'base64'),
    createFrame: () => new FigNode('FRAME'),
    createRectangle: () => new FigNode('RECTANGLE'),
    createEllipse: () => new FigNode('ELLIPSE'),
    createVector: () => new FigNode('VECTOR'),
    createText: () => new FigNode('TEXT'),
    createImage: (bytes) => {
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('createImage: needs non-empty bytes')
      return { hash: `img_${bytes.length}_${bytes[0]}` }
    },
    createNodeFromSvg: (svg) => {
      if (typeof svg !== 'string' || !/<svg/i.test(svg)) throw new Error('createNodeFromSvg: not SVG markup')
      return new FigNode('FRAME')
    },
    group: (nodes, parent) => {
      if (!nodes.length) throw new Error('group: needs at least one node')
      const g = new FigNode('GROUP')
      parent.appendChild(g)
      for (const n of nodes) g.appendChild(n)
      return g
    },
    listAvailableFontsAsync: async () =>
      FACES.flatMap((family) => STYLES.map((style) => ({ fontName: { family, style } }))),
    loadFontAsync: async (font) => {
      if (!FACES.includes(font.family)) throw new Error(`Cannot load ${font.family} ${font.style}`)
    },
  }
}

/** Load the plugin exactly as the sandbox does: a classic script, no modules. */
function loadPlugin (figma) {
  const sandbox = {
    figma,
    __html__: '<html></html>',
    console: { log () {}, warn () {}, error () {} },
    setTimeout, clearTimeout, Promise, Uint8Array, Array, Object, JSON, Math, String, Number,
    Boolean, Error, Set, Map, Intl, TextDecoder, TextEncoder, isNaN, parseFloat, parseInt,
  }
  const ctx = vm.createContext(sandbox)
  const src = fs.readFileSync(path.join(ROOT, 'figma-plugin/code.js'), 'utf8')
  vm.runInContext(src, ctx, { filename: 'figma-plugin/code.js' })
  // The declarations are function statements at script scope, so they are on the
  // context's global object. Reaching for them is the whole point: nothing here
  // re-implements what the plugin does.
  return ctx
}

const results = []
for (const fixture of FIXTURES) {
  const svdPath = path.join(OUT, `${fixture}.svd.json`)
  const doc = JSON.parse(fs.readFileSync(svdPath, 'utf8'))
  const row = { fixture, nodes: Object.keys(doc.nodes).length }

  let payload
  try {
    payload = svdToFigma(doc)
  } catch (err) {
    row.error = `svdToFigma threw: ${err.message}`
    results.push(row)
    continue
  }
  row.figmaNodes = Object.keys(payload.nodes).length
  row.fonts = payload.fonts.length
  row.translationDiagnostics = payload.diagnostics.length
  row.translationErrors = payload.diagnostics.filter((d) => d.severity === 'error').length
  row.hasDocument = !!payload.document
  row.assets = Object.keys((payload.document && payload.document.assets) || {}).length

  const figma = makeFigma()
  const ctx = loadPlugin(figma)

  const read = ctx.readPayload(JSON.parse(JSON.stringify(payload)))
  row.payloadAccepted = read.ok
  row.payloadErrors = read.errors

  // And the negative control: the RAW SVD must still be refused, with a reason.
  const raw = ctx.readPayload(JSON.parse(JSON.stringify(doc)))
  row.rawSvdRefused = !raw.ok
  row.rawSvdReason = raw.errors[0] || null

  if (read.ok) {
    try {
      const pre = await ctx.preflight(read.doc)
      row.preflightFonts = (pre.fonts || []).length
      const built = await ctx.build(read.doc, {})
      row.built = built.created
      row.buildWarnings = (built.warnings || []).reduce((n, w) => n + w.count, 0)
      row.figNodesMade = created
    } catch (err) {
      row.error = `build threw: ${err.message}`
    }
  }
  results.push(row)
}

const bad = results.filter((r) => r.error || !r.payloadAccepted || !r.rawSvdRefused)
console.log(JSON.stringify(results, null, 2))
console.log(bad.length ? `FAIL: ${bad.length} fixture(s)` : 'PASS: 5/5 payloads accepted, 5/5 built, raw SVD refused every time')
