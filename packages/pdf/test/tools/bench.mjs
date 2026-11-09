/**
 * What a long PDF export actually costs.
 *
 * Two questions, both of which were reasoned from the code and neither of which
 * had been measured:
 *
 * 1. **Retention.** The exporter used to cache the CANVAS of every page region
 *    beside the encoded bytes. Both live on the capture result, which the caller
 *    holds, so the claim was that a long export kept one full-page bitmap per
 *    page alive for as long as that object lived. Measured here by tagging every
 *    canvas the export creates with a WeakRef, forcing a real GC through CDP, and
 *    counting which ones survive. The `--old` variant compared against a copy of
 *    the pre-fix code and that copy is gone; the retention question it settled is
 *    recorded in the commit that fixed it.
 *
 * 2. **Per-region cost.** The page raster is requested as one pre-decode crop per
 *    page, and snapdom windows the SVG by REWRITING ITS TEXT before decoding. So
 *    the painted area per page is bounded, but the parse may not be: every region
 *    walks the whole serialized document. `--fat` inlines megabytes of image that
 *    no single page slice paints, which separates the two — if per-region cost
 *    tracks SVG SIZE rather than crop area, the parse dominates.
 *
 *   node test/tools/bench.mjs [--pages=50] [--fat] [--runs=3]
 */

import { chromium } from 'playwright'
import { serve } from '../serve.mjs'

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}
const PAGES = Number(arg('pages', 50))
const RUNS = Number(arg('runs', 3))
const FAT = process.argv.includes('--fat')

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`
const ms = (n) => `${n.toFixed(0)} ms`

const server = await serve(0)
const base = `http://localhost:${server.port}`
const browser = await chromium.launch()

/**
 * One export, instrumented from inside the page.
 *
 * Canvases are tagged at creation — snapdom makes its own, so the hook is on
 * `document.createElement` rather than on anything the plugin exposes — and each
 * one's pixel footprint is read at the moment it is retired, because a retained
 * canvas can be resized to 0 by whoever holds it.
 */
async function measure({ variant, pages, fat }) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${base}/test/fixtures/_bench.html?pages=${pages}${fat ? '&fat=1' : ''}`,
    { waitUntil: 'load' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })

  const cdp = await page.context().newCDPSession(page)

  const result = await page.evaluate(async ({ variant }) => {
    const { snapdom } = await import('@zumer/snapdom')
    const mod = await import('/src/index.js')
    const pdf = mod.default

    // Every canvas this export creates, weakly. Size is recorded eagerly: a
    // canvas that is still referenced can be shrunk, and one that is collected
    // cannot be asked anything at all.
    const born = []
    const realCreate = document.createElement.bind(document)
    document.createElement = function (tag, ...rest) {
      const el = realCreate(tag, ...rest)
      if (String(tag).toLowerCase() === 'canvas') born.push(new WeakRef(el))
      return el
    }

    const el = document.getElementById('target')
    const t0 = performance.now()
    const shot = await snapdom(el, { scale: 2, dpr: 1, plugins: [pdf()] })
    const tCapture = performance.now()
    const blob = await shot.toPdf({ page: 'a4', margin: 36 })
    const tExport = performance.now()

    // The caller KEEPS the capture, which is the whole point: the caches live in
    // its closure, so a bench that drops it measures nothing.
    window.__shot = shot

    // Same capture, exported again — what the caches are for.
    const t2 = performance.now()
    await shot.toPdf({ page: 'a4', margin: 36 })
    const secondMs = performance.now() - t2

    // With no raster at all: text layer, links, structure and PDF writing alone.
    // The difference against the full export is what the pixels cost.
    const t3 = performance.now()
    await shot.toPdf({ page: 'a4', margin: 36, image: false })
    const textOnlyMs = performance.now() - t3

    // `codec: 'auto'` encodes each region TWICE and keeps the smaller. Pinning it
    // is the only way to see how much of the bill that comparison is.
    const t4 = performance.now()
    await shot.toPdf({ page: 'a4', margin: 36, codec: 'jpeg', quality: 0.92 })
    const jpegMs = performance.now() - t4

    document.createElement = realCreate
    window.__born = born
    // Nothing of this page's own is left holding a canvas: what survives the GC
    // below is held by the plugin, through the capture the caller kept.
    return {
      captureMs: tCapture - t0,
      exportMs: tExport - tCapture,
      secondMs,
      textOnlyMs,
      jpegMs,
      pdfBytes: blob.size,
      svgBytes: shot.url.length,
      vb: { w: shot.meta.vbW, h: shot.meta.vbH },
      created: born.length,
    }
  }, { variant })

  // A real collection, not a hint: `HeapProfiler.collectGarbage` is the only way
  // to make "still reachable" mean what it says.
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)))
  await cdp.send('HeapProfiler.collectGarbage')

  // Read live: a canvas somebody still holds can report its real footprint, and
  // one that was collected has none to report.
  const retained = await page.evaluate(() => {
    let alive = 0
    let bytes = 0
    let biggest = 0
    for (const ref of window.__born) {
      const c = ref.deref()
      if (!c) continue
      const px = c.width * c.height
      if (!px) continue
      alive++
      bytes += px * 4
      biggest = Math.max(biggest, px * 4)
    }
    return { alive, bytes, biggest, total: window.__born.length }
  })

  // Only NOW, with retention already read, is it safe to make more canvases:
  // one region cut three times at different offsets. If this tracks the SVG's
  // SIZE rather than the strip's area, the per-region parse is the cost.
  const crop = await page.evaluate(async () => {
    const shot = window.__shot
    const stripH = Math.min(shot.meta.vbH / 3, 1123 / 0.75)
    const samples = []
    for (let i = 0; i < 3; i++) {
      const a = performance.now()
      await shot.toCanvas({ crop: { x: 0, y: stripH * i, width: shot.meta.vbW, height: stripH },
        backgroundColor: null })
      samples.push(performance.now() - a)
    }
    return { stripH, samples, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length }
  })

  await page.close()
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 2).join(' | ')}`)
  return { ...result, retained, ...crop, cropMeanMs: crop.meanMs, cropSamples: crop.samples }
}

console.log(`\ndocumento: ${PAGES} secciones${FAT ? ' + imágenes embebidas (fat)' : ''}, ${RUNS} corrida(s)\n`)

const variants = process.argv.includes('--compare') ? ['old', 'new'] : ['new']

for (const variant of variants) {
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await measure({ variant, pages: PAGES, fat: FAT }))
  const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length
  const last = runs[runs.length - 1]
  const label = variant === 'old' ? 'ANTES (con canvasCache)' : 'AHORA (sin canvasCache)'
  console.log(`── ${label} ──`)
  console.log(`  captura              ${ms(avg('captureMs'))}`)
  console.log(`  export a PDF         ${ms(avg('exportMs'))}`)
  console.log(`   · sin raster        ${ms(avg('textOnlyMs'))}  (capa de texto, enlaces, estructura, escritura)`)
  console.log(`   · 2º export igual   ${ms(avg('secondMs'))}  (mismas opciones: mide la caché)`)
  console.log(`   · codec:'jpeg'      ${ms(avg('jpegMs'))}  (vs 'auto', que codifica dos veces por región)`)
  console.log(`  PDF ${mb(last.pdfBytes)}   SVG serializado ${mb(last.svgBytes)}   viewBox ${last.vb.w.toFixed(0)}×${last.vb.h.toFixed(0)}`)
  console.log(`  canvas creados       ${last.retained.total}`)
  console.log(`  canvas RETENIDOS     ${last.retained.alive}  →  ${mb(last.retained.bytes)} vivos tras GC` +
    (last.retained.biggest ? `, mayor ${mb(last.retained.biggest)}` : ''))
  console.log(`  1 región de ${last.stripH.toFixed(0)}px   ${ms(last.cropMeanMs)} de media  [${last.cropSamples.map(n => n.toFixed(0)).join(', ')}]`)
  console.log()
}

await browser.close()
server.close()
