/**
 * The seam itself, end to end, in a real browser: `toPdf(el, {mode:'vector'})`
 * → the vector engine → `svdToPdf` → bytes → pdf.js.
 *
 * test/verify.mjs proves the RASTER path. This proves the other one exists and
 * that the options a caller sets actually reach the paper — which is exactly
 * what `pages` did not do before, and no amount of testing the emitter alone
 * would have caught, because the emitter was never asked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out/vector')
const require = createRequire(import.meta.url)
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))

let pass = 0
const bad = []
const ok = (cond, label) => { if (cond) pass++; else bad.push(label) }

const server = await serve()
const port = server.port
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e.message || e)))

// test/fixtures/vector.html, not prose.html: it is the only fixture whose import
// map points `@zumer/snapdom` at the v3 sibling checkout, which is what
// adapters/snapdom.js needs for the clone it gets from its hook. See that file's comment.
await page.goto(`http://localhost:${port}/test/fixtures/vector.html`, { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true')

/** Run toPdf in the page and bring the bytes back as an array. */
async function run (options) {
  return await page.evaluate(async (opts) => {
    const warns = []
    const realWarn = console.warn
    console.warn = (...a) => { warns.push(a.join(' ')); realWarn(...a) }
    try {
      const blob = await window.toPdf(document.querySelector('#target'), opts)
      const buf = new Uint8Array(await blob.arrayBuffer())
      return { bytes: Array.from(buf), warns, type: blob.type }
    } catch (err) {
      return { error: String(err && err.message || err), warns }
    } finally { console.warn = realWarn }
  }, options)
}

async function parse (res, name) {
  const bytes = new Uint8Array(res.bytes)
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), bytes)
  return await pdfjs.getDocument({ data: bytes }).promise
}

// ——— 1. it loads at all ————————————————————————————————————————————————
const fit = await run({ mode: 'vector' })
ok(!fit.error, `mode:'vector' threw: ${fit.error}`)
if (fit.error) { console.log(bad.join('\n')); await browser.close(); server.close(); process.exit(1) }
ok(fit.type === 'application/pdf', 'the blob is application/pdf')

const fitPdf = await parse(fit, 'e2e-prose-fit')
ok(fitPdf.numPages === 1, `page:'fit' is one page — got ${fitPdf.numPages}`)

const fitText = (await (await fitPdf.getPage(1)).getTextContent()).items.map(i => i.str).join('')
const words = await page.evaluate(() => window.__words.join(' '))
ok(fitText.replace(/\s+/g, ' ').includes(words.slice(0, 60)), 'the DOM text comes back out of the vector PDF')

// No image XObject anywhere: that is the whole difference from raster.
const fitOps = await (await fitPdf.getPage(1)).getOperatorList()
const imageOps = fitOps.fnArray.filter(f =>
  f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintJpegXObject ||
  f === pdfjs.OPS.paintInlineImageXObject).length
ok(imageOps === 0, `vector page has ${imageOps} image paints — it should have none`)
const invisible = fitOps.fnArray.filter((f, i) =>
  f === pdfjs.OPS.setTextRenderingMode && fitOps.argsArray[i][0] === 3).length
ok(invisible === 0, `vector page has ${invisible} Tr 3 runs — text must be painted, not hidden`)

// ——— 2. the raster PDF of the same element, for contrast ————————————————
const raster = await run({ mode: 'raster' })
ok(!raster.error, `mode:'raster' threw: ${raster.error}`)
if (!raster.error) {
  const rPdf = await parse(raster, 'e2e-prose-raster')
  const rOps = await (await rPdf.getPage(1)).getOperatorList()
  const rImages = rOps.fnArray.filter(f =>
    f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintJpegXObject).length
  const rInvisible = rOps.fnArray.filter((f, i) =>
    f === pdfjs.OPS.setTextRenderingMode && rOps.argsArray[i][0] === 3).length
  ok(rImages > 0, 'the raster page really does paint an image (control)')
  ok(rInvisible > 0, 'the raster page really does hide its text at Tr 3 (control)')
  console.log(`  control — raster: ${rImages} image paint(s), ${rInvisible} Tr3; ` +
    `vector: ${imageOps} image paint(s), ${invisible} Tr3`)
}

// ——— 3. `page`/`margin` must reach the paper ————————————————————————————
const a4 = await run({ mode: 'vector', page: 'a4', margin: 36 })
ok(!a4.error, `mode:'vector' page:'a4' threw: ${a4.error}`)
if (!a4.error) {
  const aPdf = await parse(a4, 'e2e-prose-a4')
  const vp = (await aPdf.getPage(1)).getViewport({ scale: 1 })
  ok(Math.abs(vp.width - 595.28) < 0.1 && Math.abs(vp.height - 841.89) < 0.1,
    `page:'a4' produced ${vp.width.toFixed(2)}×${vp.height.toFixed(2)}, not A4 — the geometry never reached the emitter`)
  ok(aPdf.numPages >= 1, 'the a4 run has pages')
  console.log(`  a4: ${aPdf.numPages} page(s) at ${vp.width.toFixed(2)}×${vp.height.toFixed(2)}`)

  // The content must sit INSIDE the margin. This is the assertion that fails
  // if `pages` is ignored and the emitter falls back to its natural page.
  const tc = await (await aPdf.getPage(1)).getTextContent()
  const xs = tc.items.filter(i => i.str.trim()).map(i => i.transform[4])
  ok(xs.length > 0, 'the a4 page has text to measure')
  if (xs.length) {
    const left = Math.min(...xs)
    ok(left >= 35 && left < 120, `leftmost glyph at x=${left.toFixed(2)}pt, expected just inside the 36pt margin`)
    console.log(`  a4 leftmost glyph x = ${left.toFixed(2)}pt (margin 36pt)`)
  }
}

// ——— 4. ignored options are declared, not swallowed ————————————————————
const noisy = await run({ mode: 'vector', scale: 4, quality: 0.1 })
ok(noisy.warns.some(w => w.includes('scale')), '`scale` in vector mode is warned about')
ok(noisy.warns.some(w => w.includes('quality')), '`quality` in vector mode is warned about')

// ——— 5. onWarn actually carries the emitter's diagnostics out —————————————
ok(noisy.warns.some(w => w.includes('emit/pdf')),
  "the emitter's own diagnostics reach the host console through onWarn")

ok(errors.length === 0, `uncaught page errors: ${errors.join(' | ')}`)

await browser.close()
server.close()

console.log(`\n${pass}/${pass + bad.length} vector-path checks passed`)
if (bad.length) {
  for (const b of bad) console.log(`  ✗ ${b}`)
  process.exitCode = 1
}
