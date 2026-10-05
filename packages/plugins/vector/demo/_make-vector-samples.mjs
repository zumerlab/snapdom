/**
 * Regenerates the samples the vector product page hands out, and writes their real
 * numbers back into the page, which lives in the snapdom repo.
 *
 *   node demo/_make-vector-samples.mjs
 *
 * Same rules as `_make-samples.mjs` next to it, for the same reason: the samples are
 * the page's only evidence, so they come out of the engine itself and are read back
 * before they ship. Every figure printed on the page — node counts, the fidelity
 * histogram, clone drift, file sizes — is measured here and substituted into the
 * HTML, because a page whose argument is "check it yourself" cannot carry a number
 * nobody checked.
 *
 * What it produces, under `snapdom/docs/pro/vector/`:
 *
 *   assets/hero.svg      the emitted vector of the hero fixture
 *   assets/hero.png      the RASTER of the same capture — one snapdom() call, two
 *                        exports, which is what the zoom panel compares
 *   samples/*.svg        one flat SVG per fixture, untouched
 *   samples/card.svd.json    the document itself, so the format is inspectable
 *   samples/card.figma.json  what the Figma plugin is handed
 *   samples/_report.json     everything measured here, for the page and for diffing
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { serve } from '../test/serve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// The product pages are public content and live with the site, in the sibling
// snapdom checkout that builds snapdom.dev. Only this generator stays here, because
// producing the samples needs the engine.
const SITE = path.join(HERE, '..', '..', '..', 'snapdom', 'docs', 'pro', 'vector')
const OUT = path.join(SITE, 'samples')
const ASSETS = path.join(SITE, 'assets')
const PAGE = path.join(SITE, 'index.html')

/** Set once, when `xmllint` turns out not to be installed. */
let xmllintMissing = false

const require = createRequire(path.join(HERE, '..', 'package.json'))
const { chromium } = await import('playwright').catch(() =>
  require(path.join(HERE, '..', '..', '..', 'snapdom', 'node_modules', 'playwright')))

/**
 * `page` is the demo that carries the fixture, `fixture` its element id, `file` the
 * name it ships under. `target: 'self'` mirrors `test/verify-vector.mjs`: on
 * `vector.html` the fixture element IS the capture root, on the other two it wraps it.
 */
const SAMPLES = [
  {
    file: 'card', page: 'vector', fixture: 'fx-card', target: 'self', hero: true,
    what: 'Linear, radial and conic gradients, elliptic radii, two shadows, a struck-through price.',
  },
  {
    file: 'typography', page: 'challenges', fixture: 'fx-type', target: 'firstElementChild',
    what: 'Nine typographic traps: justified text, hyphenation, a wavy underline, small caps, RTL, emoji.',
  },
  {
    file: 'controls', page: 'challenges', fixture: 'fx-form', target: 'firstElementChild',
    what: 'Native form controls — the pixels no CSS property describes — rebuilt as geometry.',
  },
  {
    file: 'table', page: 'challenges', fixture: 'fx-table', target: 'firstElementChild',
    what: 'A border-collapse table: the resolved grid, painted as its own layer.',
  },
  {
    file: 'icons', page: 'challenges', fixture: 'fx-svg', target: 'firstElementChild',
    what: 'Inline SVG, four icons deep, three of them declaring the same element ids.',
  },
  // Was `challenges/fx-glass` until 2026-08-08. That fixture is the honest worst
  // case (backdrop-filter has no vector equivalent and the panel comes out
  // wrong), and it belongs in the limits, not in a row of downloads where the
  // reader has no way to tell a declared degradation from a broken export.
  {
    file: 'clone', page: 'figma', fixture: 'fx-clone', target: 'firstElementChild',
    what: 'A ::before with attr(), ::marker numbers, an open shadow root and an icon-font ligature.',
  },
]

const PAGES = {
  vector: '/demo/vector.html',
  figma: '/demo/figma.html',
  challenges: '/demo/challenges.html',
}

/**
 * Runs in the page. One capture, three exports off it: the document, the flat SVG,
 * and — for the hero — snapdom's own raster of the very same clone, which is the
 * only fair thing to put a vector next to.
 */
const CAPTURE = async (a) => {
  const [snapdomMod, vector, svgFlat, figmaJson, svd] = await Promise.all([
    import('@zumer/snapdom'),
    import('@zumer/snapdom-vector'),
    import('@zumer/snapdom-vector/emit/svg-flat.js'),
    import('@zumer/snapdom-vector/emit/figma-json.js'),
    import('@zumer/svd'),
  ])
  const snapdom = snapdomMod.snapdom
  const vectorPlugin = vector.vector || vector.default
  const svdToSvg = svgFlat.svdToSvg || svgFlat.default
  const toFigma = figmaJson.svdToFigma || figmaJson.default

  const host = document.getElementById(a.fixture)
  if (!host) return { error: `no element #${a.fixture} on this page` }
  for (const fx of document.querySelectorAll('.fx')) fx.classList.toggle('on', fx.id === a.fixture)
  const el = a.target === 'self' ? host : host.firstElementChild
  if (!el) return { error: `#${a.fixture} has no first element child to capture` }
  await document.fonts.ready

  const t0 = performance.now()
  const captured = await snapdom(el, { plugins: [vectorPlugin({ silent: true })] })
  const doc = await captured.toVector()
  const emitted = svdToSvg(doc)
  const ms = performance.now() - t0
  const svg = typeof emitted === 'string' ? emitted : emitted.svg
  const svgDiagnostics = (emitted && emitted.diagnostics) || []

  // The raster half of the hero, off the SAME capture. `toPng` hands back an
  // <img>; its src is the data URL, which is the only shape that survives the
  // trip back to Node.
  let png = null
  if (a.hero) {
    const img = await captured.toPng()
    png = img && img.src ? img.src : null
  }

  // Read the file back the way a buyer will: a strict parser, not the tolerant
  // one every browser uses for `text/html`.
  const xml = new DOMParser().parseFromString(svg, 'application/xml')
  const parseError = xml.querySelector('parsererror') ? xml.querySelector('parsererror').textContent : null
  const texts = xml.getElementsByTagName ? xml.getElementsByTagName('text').length : 0
  const images = xml.getElementsByTagName ? xml.getElementsByTagName('image').length : 0

  const grades = {}
  for (const node of Object.values(doc.nodes || {})) {
    const g = (node.fidelity && node.fidelity.grade) || 'E'
    grades[g] = (grades[g] || 0) + 1
  }

  const all = [...(doc.diagnostics || []), ...svgDiagnostics]
  const codes = {}
  for (const d of all) if (d && d.code) codes[d.code] = (codes[d.code] || 0) + 1

  let figma = null
  try {
    figma = toFigma(doc)
  } catch (err) {
    return { error: `svdToFigma threw: ${err && err.message}` }
  }

  return {
    svg,
    png,
    svd: JSON.stringify(doc, null, 2),
    figma: JSON.stringify(figma, null, 2),
    schema: svd.validate(doc),
    parseError,
    texts,
    images,
    grades,
    codes,
    ms,
    report: doc.report,
    // The first three lines a curious person sees when they open the file in an
    // editor. Quoted on the page verbatim, so it has to come from the file.
    banner: (svg.match(/<!--[\s\S]*?-->/) || [''])[0],
    diagnostics: all.map((d) => ({
      code: d.code, grade: d.grade, severity: d.severity, node: d.node,
      message: d.message || d.note || d.reason || '',
    })),
  }
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(ASSETS, { recursive: true })

const server = await serve(0)
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

const failures = []
page.on('pageerror', (e) => failures.push(String((e && e.message) || e)))

const made = []
let loaded = null
for (const s of SAMPLES) {
  const url = `http://localhost:${server.port}${PAGES[s.page]}`
  if (loaded !== url) {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction('window.__ready === true', null, { timeout: 60000 })
    loaded = url
  }

  const cap = await page.evaluate(CAPTURE, s)
  if (cap.error) throw new Error(`${s.file}: ${cap.error}`)
  if (cap.parseError) throw new Error(`${s.file}: the SVG does not parse strictly — ${cap.parseError}`)
  if (!cap.schema.ok) throw new Error(`${s.file}: the document failed its own schema — ${cap.schema.errors.join(' | ')}`)
  if (!cap.texts && s.file !== 'icons') throw new Error(`${s.file}: not one <text> element came out of it`)

  fs.writeFileSync(path.join(OUT, `${s.file}.svg`), cap.svg)
  xmllint(path.join(OUT, `${s.file}.svg`))
  const bytes = Buffer.byteLength(cap.svg)
  await thumbnail(page, cap.svg, path.join(OUT, `${s.file}.thumb.png`))

  if (s.hero) {
    fs.writeFileSync(path.join(ASSETS, 'hero.svg'), cap.svg)
    xmllint(path.join(ASSETS, 'hero.svg'))
    if (!cap.png) throw new Error(`${s.file}: the capture produced no raster to compare against`)
    const b64 = cap.png.slice(cap.png.indexOf(',') + 1)
    fs.writeFileSync(path.join(ASSETS, 'hero.png'), Buffer.from(b64, 'base64'))
    fs.writeFileSync(path.join(OUT, `${s.file}.svd.json`), cap.svd)
    fs.writeFileSync(path.join(OUT, `${s.file}.figma.json`), cap.figma)
  }

  made.push({ ...s, ...cap, bytes, svg: undefined, png: undefined, svd: undefined, figma: undefined })
  const r = cap.report
  console.log(
    `${s.file.padEnd(11)} ${String(r.nodes).padStart(4)} nodes / ${String(r.domElements).padStart(4)} el ` +
    `· ratio ${r.nodeRatio.toFixed(2)} · drift ${fmtDrift(r.drift)} · ${String(cap.texts).padStart(3)} <text> ` +
    `· ${String(Math.round(bytes / 1024)).padStart(3)} KB · ${Object.entries(cap.grades).map(([g, n]) => `${g}:${n}`).join(' ')}`
  )
}

await browser.close()
server.close()

if (failures.length) throw new Error(`the demo pages raised ${failures.length} error(s): ${failures.join(' | ')}`)

/**
 * The second parser, and the one that matters.
 *
 * `cap.parseError` above is Chromium's `DOMParser`, which is the browser the
 * engine was written against and therefore the browser least likely to complain.
 * Firefox and every XML toolchain use libxml2, which is stricter, and a sample
 * that opens in one and shows "AttValue: ' expected" in the other is worse than a
 * sample that fails everywhere: it ships, and the person who opens it concludes
 * the exporter is broken.
 *
 * `xmllint` comes with macOS and most Linuxes. When it is missing the generator
 * says so rather than pretending the file was checked.
 */
function xmllint (file) {
  if (xmllintMissing) return
  try {
    execFileSync('xmllint', ['--noout', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    if (err.code === 'ENOENT') {
      xmllintMissing = true
      console.warn('xmllint is not installed — the samples were only checked by Chromium, ' +
        'which is the lenient one. Install libxml2 before a release.')
      return
    }
    const detail = String((err.stderr && err.stderr.toString()) || err.message).trim()
    throw new Error(`${path.basename(file)} is not well-formed XML:\n${detail}`)
  }
}

/**
 * A PNG of the very SVG that is about to ship, rendered by this run.
 *
 * The card used to point its `<img>` straight at the `.svg`, which is the more
 * honest arrangement and was fine until it met a dev server. `live-server` injects
 * its reload snippet **before the first `</svg>`** — its own comment says "For SVG
 * support" — and in a capture that carries passthrough SVG assets the first
 * `</svg>` is an INNER one, so the snippet lands in the middle of the drawing and
 * the file stops parsing. Two of these six samples nest SVG; those two are exactly
 * the two that broke, and nothing the exporter writes can prevent it, because the
 * corruption happens on the wire.
 *
 * A PNG cannot be injected into. The picture still comes from the shipped file and
 * from nowhere else, so the card cannot advertise something the download does not
 * contain.
 *
 * @param {import('playwright').Page} page
 * @param {string} svg   the markup that was just written to disk
 * @param {string} out   where the PNG goes
 */
async function thumbnail (page, svg, out) {
  const shot = await page.evaluate(async (markup) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the SVG did not decode')); img.src = url })
      // The card's own window, at 2x for a retina screen, cropped from the top
      // exactly the way the CSS crops it. Rendering the whole artwork instead
      // and letting the browser crop cost 335 KB for a card shown 300px wide,
      // which is a third of a megabyte of decoration on a sales page.
      const W = 620
      const H = 310
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      const scale = W / img.naturalWidth
      ctx.drawImage(img, 0, 0, img.naturalWidth, Math.min(img.naturalHeight, H / scale),
        0, 0, W, Math.min(img.naturalHeight * scale, H))
      return canvas.toDataURL('image/png')
    } finally { URL.revokeObjectURL(url) }
  }, svg)
  fs.writeFileSync(out, Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64'))
}

function fmtDrift (drift) {
  if (!drift) return 'n/a'
  const median = drift.median != null ? drift.median : drift.p50
  return `${Number(median || 0).toFixed(2)}px`
}

const hero = made.find((m) => m.hero)
const heroPngBytes = fs.statSync(path.join(ASSETS, 'hero.png')).size
const heroSvgBytes = fs.statSync(path.join(ASSETS, 'hero.svg')).size

fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  hero: {
    file: hero.file,
    svgBytes: heroSvgBytes,
    pngBytes: heroPngBytes,
    report: hero.report,
    grades: hero.grades,
    diagnostics: hero.diagnostics,
    banner: hero.banner,
  },
  samples: made.map((m) => ({
    file: m.file, what: m.what, bytes: m.bytes, texts: m.texts, images: m.images,
    nodes: m.report.nodes, domElements: m.report.domElements, nodeRatio: m.report.nodeRatio,
    drift: m.report.drift, grades: m.grades, codes: m.codes, ms: Math.round(m.ms),
  })),
}, null, 2))

// ——— write the real numbers into the page ———
if (!fs.existsSync(PAGE)) {
  console.log(`\n${made.length} samples in ${OUT}`)
  console.log(`(${path.relative(process.cwd(), PAGE)} does not exist yet — nothing to back-fill)`)
  process.exit(0)
}

let html = fs.readFileSync(PAGE, 'utf8')
let linked = 0
let changed = 0

for (const m of made) {
  const before = html
  html = html.replace(
    new RegExp(`(href="samples/${m.file}\\.svg"[\\s\\S]*?<span class="meta">)[^<]*`),
    `$1${Math.round(m.bytes / 1024)} KB · ${m.report.nodes} nodes · ${m.texts} text`)
  if (html !== before) changed++
  if (new RegExp(`href="samples/${m.file}\\.svg"`).test(html)) linked++
}

/** Every `<b data-stat="…">` on the page is a number this run measured. */
const STATS = {
  'hero.nodes': hero.report.nodes,
  'hero.elements': hero.report.domElements,
  'hero.ratio': hero.report.nodeRatio.toFixed(2),
  'hero.drift': fmtDrift(hero.report.drift),
  'hero.ms': Math.round(hero.ms),
  'hero.svgkb': Math.round(heroSvgBytes / 1024),
  'hero.pngkb': Math.round(heroPngBytes / 1024),
  'hero.texts': hero.texts,
  'hero.exact': hero.grades.E || 0,
  'hero.approx': hero.grades.A || 0,
  'hero.diagnostics': hero.diagnostics.length,
  'samples.count': made.length,
}
// Global: a figure quoted twice on the page — once in the report card and once in
// the FAQ that argues from it — has to move in both places or the page contradicts
// itself, which is the one thing this page cannot afford to do.
for (const [key, value] of Object.entries(STATS)) {
  const before = html
  html = html.replace(new RegExp(`(<b data-stat="${key}">)[^<]*`, 'g'), `$1${value}`)
  if (html !== before) changed++
}

fs.writeFileSync(PAGE, html)
console.log(`\n${made.length} samples in ${OUT}`)
console.log(`${linked} linked from the product page · ${changed} value(s) written into it`)
