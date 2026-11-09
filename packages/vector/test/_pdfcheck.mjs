/**
 * Vector-PDF verification. Regenerates out/vector/*.pdf from the SVDs and then
 * proves, with pdf.js and nothing else, that the result is DRAWN and not a
 * picture: path operators vs image XObjects, text items with their render mode,
 * and the font each item actually uses.
 *
 *   node test/_pdfcheck.mjs            regenerate + verify all five
 *   node test/_pdfcheck.mjs fx-card    one fixture
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { svdToPdf } from '../src/emit/pdf.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out/vector')
const require = createRequire(import.meta.url)
const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']

const only = process.argv.slice(2).filter(a => !a.startsWith('-'))
const list = only.length ? FIXTURES.filter(f => only.some(o => f.startsWith(o))) : FIXTURES

// pdf.js in Node: the legacy build, no worker.
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

const PATH_OPS = new Set(['re', 'moveTo', 'lineTo', 'curveTo', 'curveTo2', 'curveTo3',
  'closePath', 'rectangle'])
const PAINT_OPS = new Set(['fill', 'eoFill', 'stroke', 'fillStroke', 'eoFillStroke',
  'closeFillStroke', 'closeEOFillStroke', 'closeStroke', 'endPath'])

const results = []
let failures = 0
const fail = (fixture, msg) => { failures++; results.push({ fixture, msg }) }

const rows = []
for (const fixture of list) {
  const svdPath = path.join(OUT, `${fixture}.svd.json`)
  const doc = JSON.parse(fs.readFileSync(svdPath, 'utf8'))

  const bytes = await svdToPdf(doc, { compress: true })
  fs.writeFileSync(path.join(OUT, `${fixture}.pdf`), bytes)
  // A second, uncompressed copy so the operators are greppable with `strings`.
  const raw = await svdToPdf(doc, { compress: false })
  fs.writeFileSync(path.join(OUT, `${fixture}.raw.pdf`), raw)

  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  const warnings = []
  const pdf = await task.promise
  const row = {
    fixture, kb: (bytes.length / 1024).toFixed(1), pages: pdf.numPages,
    pathOps: 0, paintOps: 0, shadings: 0, imageDo: 0, formDo: 0,
    textItems: 0, chars: 0, invisible: 0, fonts: new Map(), diagnostics: bytes.diagnostics.length,
  }

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const ops = await page.getOperatorList()
    for (let i = 0; i < ops.fnArray.length; i++) {
      const name = pdfjs.OPS ? Object.keys(pdfjs.OPS).find(k => pdfjs.OPS[k] === ops.fnArray[i]) : null
      if (!name) continue
      if (PATH_OPS.has(name)) row.pathOps++
      else if (name === 'constructPath') {
        // pdf.js coalesces m/l/c/re into one constructPath whose second arg is
        // the operator list. Count the real operators, not the wrapper.
        const args = ops.argsArray[i]
        const sub = args && args[0]
        row.pathOps += Array.isArray(sub) ? sub.length : 1
      } else if (PAINT_OPS.has(name)) row.paintOps++
      else if (name === 'shadingFill') row.shadings++
      else if (name === 'paintImageXObject' || name === 'paintJpegXObject' ||
               name === 'paintInlineImageXObject' || name === 'paintImageMaskXObject') row.imageDo++
      else if (name === 'paintFormXObjectBegin') row.formDo++
    }

    const tc = await page.getTextContent()
    for (const item of tc.items) {
      if (item.type === 'beginMarkedContent') continue
      row.textItems++
      row.chars += (item.str || '').length
      const f = item.fontName
      row.fonts.set(f, (row.fonts.get(f) || 0) + (item.str || '').length)
    }

    // Render mode is not on the text item — read it off the operator list.
    // OPS.setTextRenderingMode arg 3 = invisible (the raster path's layer).
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.setTextRenderingMode && ops.argsArray[i][0] === 3) row.invisible++
    }
  }

  // Resolve pdf.js's internal font ids to the PostScript names in the file.
  const names = new Map()
  for (const [id] of row.fonts) {
    const page = await pdf.getPage(1)
    const obj = page.commonObjs.has(id) ? page.commonObjs.get(id) : null
    names.set(id, (obj && (obj.name || obj.loadedName)) || id)
  }
  row.fontNames = [...row.fonts].map(([id, n]) => `${names.get(id)}×${n}`).sort()
  rows.push(row)

  // --- assertions ---------------------------------------------------------
  if (row.imageDo > 0) fail(fixture, `${row.imageDo} image XObject paint(s) — a vector page should have none unless the SVD carried a raster asset`)
  // The bar is "the page is DRAWN", and a page can be drawn entirely out of
  // glyphs — fx-type is a typography specimen whose boxes are a handful of
  // rules. So the floor is on geometry-per-visible-thing, not on paths alone.
  if (row.pathOps + row.chars < 400) {
    fail(fixture, `${row.pathOps} path ops + ${row.chars} chars — too little content to be a drawn page`)
  }
  if (row.pathOps < 20) fail(fixture, `only ${row.pathOps} path operators — even a text page has rules and boxes`)
  if (row.textItems === 0) fail(fixture, 'no extractable text')
  // Every href the SVD carries must come out as a real annotation.
  const wanted = new Set()
  for (const n of Object.values(doc.nodes || {})) {
    for (const r of (n.text && n.text.runs) || []) if (r.href) wanted.add(r.href)
  }
  const annots = await (await pdf.getPage(1)).getAnnotations()
  const got = new Set(annots.filter(a => a.subtype === 'Link').map(a => a.url || (a.unsafeUrl || '')))
  row.links = `${got.size}/${wanted.size}`
  for (const href of wanted) {
    if (![...got].some(g => g && g.startsWith(href))) fail(fixture, `href ${href} produced no /Link annotation`)
  }
  if (row.fontNames.length === 1 && row.fontNames[0].startsWith('Helvetica×')) {
    fail(fixture, 'every glyph is plain Helvetica — the weight/style/family mapping collapsed')
  }
  if (row.invisible > 0) fail(fixture, `${row.invisible} setTextRenderingMode(3) — text is INVISIBLE, this is the raster contract`)
  if (warnings.length) fail(fixture, `pdf.js warnings: ${warnings.join('; ')}`)
  await pdf.destroy()
}

// ——— the paginated contract ———
// What is under test is the EMITTER honouring `pages` — that the option is not
// silently ignored, which is exactly what it was before this run. It used to take
// its page list from the PDF product's `paginate.js`, back when that lived in the
// same repository; the emitter never called it, so the borrowed arithmetic was
// only ever a way to produce a plausible list. It is produced here instead, and
// the assertion below is unchanged.
{
  const PT = 0.75
  const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'fx-type.svd.json'), 'utf8'))
  const docW = doc.capture.root.w, docH = doc.capture.root.h
  const margin = 24
  const [pageW, pageH] = [595.28, 841.89]
  const drawScale = (pageW - margin * 2) / (docW * PT)
  const k = PT * drawScale
  const scaledH = docH * PT * drawScale
  const availH = pageH - margin * 2
  // Even slices down the content, which is what an empty block list always gave.
  const slices = Array.from({ length: Math.max(1, Math.ceil(scaledH / availH - 1e-9)) },
    (_, i) => ({ top: i * availH, height: Math.min(availH, scaledH - i * availH) }))
  const pages = slices.map(s => ({
    size: [pageW, pageH],
    clip: [margin, pageH - margin - s.height, pageW - margin * 2, s.height],
    matrix: [k, 0, 0, -k, margin, pageH - margin + s.top],
  }))

  const warned = []
  const bytes = await svdToPdf(doc, { pages, compress: true, onWarn: m => warned.push(m) })
  fs.writeFileSync(path.join(OUT, 'fx-type.a4.pdf'), bytes)
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise

  if (pdf.numPages !== pages.length) fail('a4', `asked for ${pages.length} pages, got ${pdf.numPages}`)
  const p1 = await pdf.getPage(1)
  const vp = p1.getViewport({ scale: 1 })
  if (Math.abs(vp.width - pageW) > 0.01 || Math.abs(vp.height - pageH) > 0.01) {
    fail('a4', `MediaBox is ${vp.width}×${vp.height}, asked for ${pageW}×${pageH}`)
  }
  if (!warned.length) fail('a4', 'onWarn was never called — the emitter has 6+ diagnostics on this document')

  // Every page must carry text, and the union of the pages must be the whole
  // document: a clip that is off by a slice silently drops rows.
  let total = 0
  const perPage = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent()
    const chars = tc.items.reduce((n, i) => n + (i.str || '').length, 0)
    perPage.push(chars); total += chars
  }
  console.log(`\npaginated a4: ${pdf.numPages} pages, MediaBox ${vp.width.toFixed(2)}×${vp.height.toFixed(2)}, ` +
    `chars/page ${perPage.join(',')}, onWarn calls ${warned.length}`)

  // A malformed page geometry must be loud, not a default page.
  for (const bad of [{ size: [0, 10], matrix: [1, 0, 0, 1, 0, 0] }, { size: [10, 10] }, { size: [10, 10], matrix: [1, 0, 0, 1, 0] }]) {
    let threw = false
    try { await svdToPdf(doc, { pages: [bad] }) } catch { threw = true }
    if (!threw) fail('a4', `a malformed page geometry ${JSON.stringify(bad)} was accepted silently`)
  }
  await pdf.destroy()
}

const pad = (s, n) => String(s).padEnd(n)
console.log('\n| fixture  | KB   | paths | paint | shad | imgs | text items | chars | fonts |')
console.log('|----------|------|-------|-------|------|------|------------|-------|-------|')
for (const r of rows) {
  console.log(`| ${pad(r.fixture, 8)} | ${pad(r.kb, 4)} | ${pad(r.pathOps, 5)} | ${pad(r.paintOps, 5)} | ${pad(r.shadings, 4)} | ${pad(r.imageDo, 4)} | ${pad(r.textItems, 10)} | ${pad(r.chars, 5)} | ${r.fontNames.join(' ')} |`)
}
console.log('')
for (const r of rows) console.log(`${r.fixture}: invisible-Tr3=${r.invisible} diagnostics=${r.diagnostics}`)

if (failures) {
  console.log(`\n${failures} FAILURE(S):`)
  for (const f of results) console.log(`  ✗ ${f.fixture}: ${f.msg}`)
  process.exitCode = 1
} else {
  console.log('\nAll vector assertions passed.')
}
