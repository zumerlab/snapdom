// What the move to snapdom's clone actually cost and bought, measured.
//
// Every number here is read off a real capture in a real browser:
//   · drift        — the mounted clone's boxes against the live boxes (report.drift)
//   · coverage     — nodes the live-DOM walk could not have produced (report.coverage)
//   · nodes/ratio  — against the pre-migration counts, so clone artifacts leaking
//                    into the export show up as a rise nobody asked for
//   · cost         — snapdom's half and the engine's half of the wall clock
//   · pixels       — the emitted SVG rendered standalone against a screenshot of
//                    the live element, mean absolute channel difference (0..255)
//   · leftovers    — 20 captures in a row, then a sweep for anything still mounted
//
// Usage: node test/_clonemetrics.mjs [baseUrl]
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'out/vector')
const BASE = process.argv[2] || 'http://localhost:4321'
const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']
const REPEATS = 5

// Pre-migration baseline (engine walked the live DOM). Kept here because the
// harness that produced it is gone; these are the numbers the migration has to
// answer for.
const BEFORE = {
  'fx-card': { nodes: 18, pixel: 2.164 },
  'fx-type': { nodes: 20, pixel: 5.575 },
  'fx-ui': { nodes: 43, pixel: 3.927 },
  'fx-table': { nodes: 94, pixel: 2.071 },
  'fx-z': { nodes: 21, pixel: 4.690 },
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const consoleErrors = []
const pageErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)))

await page.goto(`${BASE}/demo/vector.html`, { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', null, { timeout: 30000 })

// The demo's own module graph is the engine; import it again and get the same
// instances out of the module cache rather than a second copy.
await page.evaluate(async () => {
  const [snapdomMod, vector, svgFlat] = await Promise.all([
    import('@zumer/snapdom'),
    import('@zumer/snapdom-vector'),
    import('@zumer/snapdom-vector/emit/svg-flat.js'),
  ])
  const snapdom = snapdomMod.snapdom
  const vectorPlugin = vector.vector || vector.default
  // The engine is a snapdom plugin now, so there is no function that vectorises on
  // its own. `__m.toVector(el, opts)` keeps the old two-argument shape for the rest
  // of this script and does the registration itself.
  //
  // It also does the timing split that `doc.report.timings` used to carry:
  // `snapdomMs` was only ever measurable while the engine made the `snapdom()` call.
  // The caller makes it now, so the caller is what can hold a stopwatch — parked on
  // `window.__mLast` because the document no longer has anywhere to put it.
  window.__m = {
    svdToSvg: svgFlat.svdToSvg || svgFlat.default,
    async toVector (el, opts = {}) {
      const t0 = performance.now()
      const captured = await snapdom(el, { plugins: [vectorPlugin(opts)] })
      const t1 = performance.now()
      const doc = await captured.toVector()
      window.__mLast = { snapdomMs: t1 - t0, engineMs: performance.now() - t1 }
      return doc
    },
  }
})

const rows = []
for (const fixture of FIXTURES) {
  const row = await page.evaluate(async ({ fixture, REPEATS }) => {
    window.__vector.select(fixture)
    const el = document.getElementById(fixture)
    const opts = { mode: 'design', silent: true }

    // One warm-up: the first capture in a page pays for font loading and the
    // fetch of every background asset, and timing that would measure the cache.
    await window.__m.toVector(el, opts)

    const totals = []
    const snap = []
    let doc = null
    for (let i = 0; i < REPEATS; i++) {
      const t0 = performance.now()
      doc = await window.__m.toVector(el, opts)
      totals.push(performance.now() - t0)
      snap.push(window.__mLast ? window.__mLast.snapdomMs : null)
    }
    const median = (a) => {
      const s = a.filter((v) => typeof v === 'number').sort((x, y) => x - y)
      return s.length ? s[Math.floor(s.length / 2)] : null
    }

    const byCode = {}
    for (const d of doc.diagnostics || []) byCode[d.code] = (byCode[d.code] || 0) + 1

    const emitted = window.__m.svdToSvg(doc, {})
    const svg = typeof emitted === 'string' ? emitted : emitted.svg

    return {
      fixture,
      report: doc.report,
      byCode,
      foreignObject: (svg.match(/<foreignObject/g) || []).length,
      totalMs: median(totals),
      snapdomMs: median(snap),
      engineMs: median(totals) - (median(snap) || 0),
      svgBytes: svg.length,
    }
  }, { fixture, REPEATS })
  rows.push(row)
}

// ——— unmount(): 20 captures, then sweep the document ———
const leftovers = await page.evaluate(async () => {
  window.__vector.select('fx-ui')
  const el = document.getElementById('fx-ui')
  // Whole-document counts, not just the names the adapter uses: a leak under a
  // name nobody thought of still shows up as the document getting bigger.
  const sweep = () => ({
    marked: document.querySelectorAll('[data-snapdom-vector]').length,
    headStyles: document.head.querySelectorAll('style').length,
    headLinks: document.head.querySelectorAll('link').length,
    bodyKids: document.body.childElementCount,
    docElements: document.querySelectorAll('*').length,
    snapdomOwned: document.querySelectorAll(
      '[data-snapdom-sandbox],[data-snapdom-internal],[data-snapdom],#snapdom-sandbox').length,
    offscreen: document.querySelectorAll('body > div[aria-hidden="true"][style*="-99999"]').length,
  })
  const before = sweep()
  for (let i = 0; i < 20; i++) await window.__m.toVector(el, { mode: 'design', silent: true })
  const after = sweep()
  return { before, after }
})

// ——— artifacts + pixel diff ———
fs.mkdirSync(OUT, { recursive: true })
for (const fixture of FIXTURES) {
  const svg = await page.evaluate(async (fixture) => {
    window.__vector.select(fixture)
    const doc = await window.__m.toVector(document.getElementById(fixture), { mode: 'design', silent: true })
    const emitted = window.__m.svdToSvg(doc, {})
    return typeof emitted === 'string' ? emitted : emitted.svg
  }, fixture)
  fs.writeFileSync(path.join(OUT, `${fixture}.svg`), svg)
  await page.evaluate((fixture) => { window.__vector.select(fixture) }, fixture)
  await page.locator(`#${fixture}`).screenshot({ path: path.join(OUT, `${fixture}.orig.png`) })
}
await ctx.close()

const shotCtx = await browser.newContext({ deviceScaleFactor: 1 })
for (const fixture of FIXTURES) {
  const svg = fs.readFileSync(path.join(OUT, `${fixture}.svg`), 'utf8')
  const m = /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)
  const w = Math.ceil(Number(m ? m[1] : 800))
  const h = Math.ceil(Number(m ? m[2] : 600))
  const p = await shotCtx.newPage()
  await p.setViewportSize({ width: w, height: h })
  await p.setContent(`<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>${svg}`,
    { waitUntil: 'networkidle' })
  await p.waitForTimeout(250)
  await p.screenshot({ path: path.join(OUT, `${fixture}.standalone.png`) })
  await p.close()
}

// Diff in a canvas: node has no PNG decoder here and the browser is already open.
const diffPage = await shotCtx.newPage()
await diffPage.setContent('<canvas id=a></canvas><canvas id=b></canvas>')
for (const row of rows) {
  const orig = fs.readFileSync(path.join(OUT, `${row.fixture}.orig.png`)).toString('base64')
  const shot = fs.readFileSync(path.join(OUT, `${row.fixture}.standalone.png`)).toString('base64')
  row.pixel = await diffPage.evaluate(async ({ orig, shot }) => {
    const load = (b64) => new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = 'data:image/png;base64,' + b64
    })
    const [A, B] = await Promise.all([load(orig), load(shot)])
    // Compare over the union box; a size mismatch is itself a failure and
    // cropping to the intersection would hide it.
    const w = Math.max(A.width, B.width)
    const h = Math.max(A.height, B.height)
    const px = (img) => {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const g = c.getContext('2d', { willReadFrequently: true })
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h)
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, w, h).data
    }
    const a = px(A), b = px(B)
    let sum = 0
    let over8 = 0
    // A side-by-side with the difference amplified: the numbers say how much,
    // only the picture says where.
    const out = document.createElement('canvas')
    out.width = w * 3
    out.height = h
    const g = out.getContext('2d')
    const img = g.createImageData(w * 3, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
        sum += d
        if (d > 8) over8++
        const put = (col, r, gg, bb) => {
          const o = (y * w * 3 + col) * 4
          img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255
        }
        put(x, a[i], a[i + 1], a[i + 2])
        put(w + x, b[i], b[i + 1], b[i + 2])
        const heat = Math.min(255, d * 8)
        put(w * 2 + x, 255 - heat, 255 - heat, 255)
      }
    }
    g.putImageData(img, 0, 0)
    const n = a.length / 4
    return {
      meanAbs: sum / n,
      pctOver8: (100 * over8) / n,
      sizeA: `${A.width}x${A.height}`,
      sizeB: `${B.width}x${B.height}`,
      compare: out.toDataURL('image/png'),
    }
  }, { orig, shot })
  fs.writeFileSync(path.join(OUT, `${row.fixture}.compare.png`),
    Buffer.from(row.pixel.compare.split(',')[1], 'base64'))
  delete row.pixel.compare
}
await shotCtx.close()

// ——— the coverage page ———
// The five regression fixtures were built before the clone existed and contain
// no generated content, no shadow DOM and no icon fonts, so they can only show
// that nothing broke. `demo/figma.html` has a fixture that is all three, and it
// is the only place the migration's gain is visible at all.
const cover = []
const coverCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const cp = coverCtx.newPage ? await coverCtx.newPage() : null
const coverErrors = []
cp.on('console', (m) => { if (m.type() === 'error') coverErrors.push(m.text()) })
cp.on('pageerror', (e) => coverErrors.push('pageerror: ' + String((e && e.message) || e)))
await cp.goto(`${BASE}/demo/figma.html`, { waitUntil: 'load' })
await cp.waitForFunction('window.__ready === true', null, { timeout: 30000 })
await cp.evaluate(async () => {
  const [snapdomMod, mod] = await Promise.all([
    import('@zumer/snapdom'),
    import('/src/index.js'),
  ])
  const snapdom = snapdomMod.snapdom
  const vectorPlugin = mod.vector || mod.default
  window.__m = {
    async toVector (el, opts = {}) {
      const captured = await snapdom(el, { plugins: [vectorPlugin(opts)] })
      return captured.toVector()
    },
  }
})
for (const fixture of ['fx-clone', 'fx-card', 'fx-prose', 'fx-ui']) {
  const row = await cp.evaluate(async (fixture) => {
    for (const el of document.querySelectorAll('.fx')) el.classList.toggle('on', el.id === fixture)
    const el = document.getElementById(fixture)
    if (!el) return { fixture, missing: true }
    const doc = await window.__m.toVector(el, { silent: true })
    const byCode = {}
    for (const d of doc.diagnostics || []) byCode[d.code] = (byCode[d.code] || 0) + 1
    const named = []
    for (const id of Object.keys(doc.nodes)) {
      const n = doc.nodes[id]
      if (n.source && (n.source.pseudo || n.source.shadowHost || n.source.clone)) {
        named.push({ name: n.name, path: n.source.path, ...n.source })
      }
    }
    return { fixture, report: doc.report, byCode, named }
  }, fixture)
  cover.push(row)
}
await coverCtx.close()

// ——— the shape no demo fixture has ———
// A scrolled container: snapdom interposes a translate wrapper between it and
// its children, which is the one thing that can break the page's own cascade on
// a mounted clone. See test/fixtures/scrolldrift.html.
const scrollCtx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
const sp = await scrollCtx.newPage()
const scrollErrors = []
sp.on('console', (m) => { if (m.type() === 'error') scrollErrors.push(m.text()) })
sp.on('pageerror', (e) => scrollErrors.push('pageerror: ' + String((e && e.message) || e)))
await sp.goto(`${BASE}/test/fixtures/scrolldrift.html`, { waitUntil: 'load' })
await sp.waitForFunction('window.__ready === true', null, { timeout: 30000 })
const scroll = await sp.evaluate(async () => {
  const { captureClone } = await import('/src/adapters/snapdom.js')
  const cap = await captureClone(document.getElementById('root'))
  const drift = cap.drift
  cap.unmount()
  return { drift }
})
scroll.errors = scrollErrors
await scrollCtx.close()
await browser.close()

console.log('\n════ coverage page (demo/figma.html) ════')
console.log('errors:', coverErrors.length, coverErrors.slice(0, 5))
console.table(cover.filter((r) => !r.missing).map((r) => ({
  fx: r.fixture,
  nodes: r.report.nodes,
  dom: r.report.domElements,
  clone: r.report.cloneElements,
  pseudo: r.report.coverage.pseudo,
  shadow: r.report.coverage.shadow,
  icon: r.report.coverage.iconFont,
  artifact: r.report.coverage.artifact,
  synth: r.report.coverage.synthetic,
  driftMed: fmt(r.report.drift.median),
  driftP95: fmt(r.report.drift.p95),
  driftMax: fmt(r.report.drift.max),
})))
for (const r of cover) {
  if (r.missing) { console.log(r.fixture, 'MISSING'); continue }
  console.log('\n', r.fixture, JSON.stringify(r.byCode))
  for (const w of r.report.drift.worst || []) {
    console.log(`    DRIFT ${w.delta.toFixed(2)}px  <${w.tag}${w.id ? '#' + w.id : ''}${w.cls ? '.' + w.cls.trim().replace(/\s+/g, '.') : ''}>  clone ${w.clone} | live ${w.live}`)
  }
  for (const n of r.named) console.log('   ', n.pseudo || (n.shadowHost ? 'shadowHost' : n.clone), '·', n.name, '·', n.path)
}

console.log('\n════ scrolled containers (test/fixtures/scrolldrift.html) ════')
console.log('errors:', scroll.errors.length, scroll.errors.slice(0, 3))
console.log(`drift: median ${fmt(scroll.drift.median)}  p95 ${fmt(scroll.drift.p95)}  ` +
  `max ${fmt(scroll.drift.max)}  over ${scroll.drift.pairs} node(s)`)
for (const w of scroll.drift.worst || []) {
  console.log(`    DRIFT ${w.delta.toFixed(2)}px  <${w.tag}${w.cls ? '.' + w.cls.trim().replace(/\s+/g, '.') : ''}>  clone ${w.clone} | live ${w.live}`)
}

const result = { rows, leftovers, consoleErrors, pageErrors, cover, coverErrors, scroll }
fs.writeFileSync(path.join(ROOT, 'out/vector/_clonemetrics.json'), JSON.stringify(result, null, 2))

console.log('console errors:', consoleErrors.length, 'page errors:', pageErrors.length)
console.log('\n— drift (px, mounted clone vs live) —')
console.table(rows.map((r) => ({
  fx: r.fixture,
  pairs: r.report.drift && r.report.drift.pairs,
  median: fmt(r.report.drift && r.report.drift.median),
  p95: fmt(r.report.drift && r.report.drift.p95),
  max: fmt(r.report.drift && r.report.drift.max),
})))

console.log('\n— nodes & coverage —')
console.table(rows.map((r) => ({
  fx: r.fixture,
  before: BEFORE[r.fixture].nodes,
  after: r.report.nodes,
  dom: r.report.domElements,
  clone: r.report.cloneElements,
  ratio: r.report.nodeRatio.toFixed(3),
  pseudo: r.report.coverage.pseudo,
  shadow: r.report.coverage.shadow,
  icon: r.report.coverage.iconFont,
  artifact: r.report.coverage.artifact,
  synth: r.report.coverage.synthetic,
})))

console.log('\n— cost (ms, median of', REPEATS, 'warm captures) —')
console.table(rows.map((r) => ({
  fx: r.fixture,
  snapdom: r.snapdomMs && r.snapdomMs.toFixed(1),
  engine: r.engineMs && r.engineMs.toFixed(1),
  total: r.totalMs && r.totalMs.toFixed(1),
  share: r.snapdomMs ? `${Math.round((100 * r.snapdomMs) / r.totalMs)}%` : '—',
})))

console.log('\n— pixels (mean abs channel diff over the union box) —')
console.table(rows.map((r) => ({
  fx: r.fixture,
  before: BEFORE[r.fixture].pixel.toFixed(3),
  after: r.pixel.meanAbs.toFixed(3),
  delta: (r.pixel.meanAbs - BEFORE[r.fixture].pixel).toFixed(3),
  'px>8': `${r.pixel.pctOver8.toFixed(2)}%`,
  live: r.pixel.sizeA,
  svg: r.pixel.sizeB,
  fo: r.foreignObject,
})))

console.log('\n— leftovers after 20 captures —')
console.log(JSON.stringify(leftovers, null, 2))

console.log('\n— diagnostics by code —')
for (const r of rows) {
  console.log(r.fixture, JSON.stringify(r.byCode))
  for (const w of (r.report.drift && r.report.drift.worst) || []) {
    console.log(`    DRIFT ${w.delta.toFixed(2)}px  <${w.tag}${w.id ? '#' + w.id : ''}${w.cls ? '.' + w.cls.trim().replace(/\s+/g, '.') : ''}>  clone ${w.clone} | live ${w.live}`)
  }
}

function fmt (v) { return typeof v === 'number' ? v.toFixed(3) : String(v) }
