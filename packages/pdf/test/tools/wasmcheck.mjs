/**
 * Would a WASM engine make this exporter faster? Asked as a number rather than as
 * an opinion, because the competing product ships one and the question keeps
 * coming back.
 *
 * Only one figure answers it: what fraction of an export's WALL CLOCK sits in JS
 * that a WASM could replace. Most of the pipeline is not portable at any price —
 * the text layer reads getComputedStyle and getClientRects, the raster is the
 * browser decoding a serialized SVG, the JPEG candidate is the browser's own DCT
 * encoder, and the Flate candidate is the browser's own zlib behind
 * CompressionStream. What is left to port is pagination, operator building, font
 * parsing and byte assembly, and this measures exactly that slice.
 *
 * Per document size it reports:
 *   - wall clock: capture, cold export, warm export, image-free export
 *   - a CPU profile of the cold export, self time attributed per file and grouped
 *     into "portable to WASM" against "cannot be ported"
 *
 *   node test/tools/wasmcheck.mjs [--pages=10,50,150] [--runs=2] [--interval=100]
 */

import { chromium } from 'playwright'
import { serve } from '../serve.mjs'

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}
const SIZES = String(arg('pages', '10,50,150')).split(',').map(Number)
const RUNS = Number(arg('runs', 2))
const INTERVAL = Number(arg('interval', 100)) // µs entre muestras

const ms = (n) => `${n.toFixed(0)} ms`
const pct = (n, of) => of > 0 ? `${(n / of * 100).toFixed(1)}%` : '—'

/**
 * Which group a profile frame belongs to.
 *
 * PORTABLE is work a Rust engine could do as well or better: bytes, fonts,
 * pagination, operators. NATIVE is the browser doing its own job — decoding the
 * SVG, layout, the image codecs, GC. DOM is measurement against the live tree: a
 * WASM has no access to it, and every call would cross the bridge, which costs
 * more than the measurement itself.
 */
function bucket(url, fn) {
  if (!url) {
    if (fn === '(garbage collector)') return 'gc'
    if (fn === '(idle)' || fn === '(program)') return 'native'
    return 'native'
  }
  if (url.includes('/snapdom/')) return 'snapdom-core'
  if (url.includes('/src/writer/')) return 'portable'
  if (url.includes('/src/text-layer.js')) return 'dom-measure'
  if (url.includes('/src/tagged.js')) return 'dom-measure'
  if (url.includes('/src/nav.js')) return 'dom-measure'
  if (url.includes('/src/frontmatter.js')) return 'dom-measure'
  if (url.includes('/src/mega/forms.js')) return 'dom-measure'
  if (url.includes('/src/mega/fonts.js')) return 'portable'
  if (url.includes('/src/paginate.js')) return 'portable'
  if (url.includes('/src/furniture.js')) return 'portable'
  if (url.includes('/src/mega/')) return 'portable'
  if (url.includes('/src/index.js')) return 'plugin-mixed'
  return 'other-js'
}

/** self-time por nodo del perfil → totales por grupo y por función. */
function attribute(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const groups = new Map()
  const fns = new Map()
  const { samples = [], timeDeltas = [] } = profile
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i])
    if (!node) continue
    const dt = (timeDeltas[i] || 0) / 1000 // µs → ms
    if (dt <= 0) continue
    const { url, functionName } = node.callFrame
    const g = bucket(url, functionName)
    groups.set(g, (groups.get(g) || 0) + dt)
    const short = url ? url.split('/').slice(-1)[0] : '(native)'
    const key = `${short}:${functionName || '(anon)'}`
    fns.set(key, (fns.get(key) || 0) + dt)
  }
  return { groups, fns }
}

const server = await serve(0)
const base = `http://localhost:${server.port}`
const browser = await chromium.launch()

async function run(pages) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${base}/test/fixtures/_bench.html?pages=${pages}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: INTERVAL })

  // Capture stays outside the profile: it is the engine's work, not the plugin's.
  const captureMs = await page.evaluate(async () => {
    const { snapdom } = await import('@zumer/snapdom')
    const mod = await import('/src/index.js')
    const el = document.getElementById('target')
    const t = performance.now()
    window.__shot = await snapdom(el, { scale: 2, dpr: 1, plugins: [mod.default()] })
    return performance.now() - t
  })

  // The cold export, profiled.
  await cdp.send('Profiler.start')
  const cold = await page.evaluate(async () => {
    const t = performance.now()
    const blob = await window.__shot.toPdf({ page: 'a4', margin: 36 })
    return { wall: performance.now() - t, bytes: blob.size }
  })
  const { profile } = await cdp.send('Profiler.stop')
  const { groups, fns } = attribute(profile)

  // The rest unprofiled: wall clock only.
  const rest = await page.evaluate(async () => {
    const shot = window.__shot
    const time = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t }
    const warm = await time(() => shot.toPdf({ page: 'a4', margin: 36 }))
    const textOnly = await time(() => shot.toPdf({ page: 'a4', margin: 36, image: false }))
    const jpeg = await time(() => shot.toPdf({ page: 'a4', margin: 36, codec: 'jpeg', quality: 0.92 }))
    let pageCount = 0
    await shot.toPdf({ page: 'a4', margin: 36, onProgress: e => { if (e.total) pageCount = e.total } })
    return { warm, textOnly, jpeg, pageCount }
  })

  await page.close()
  if (errors.length) console.error(`  ! errores en la página: ${errors.join(' | ')}`)
  return { pages, captureMs, cold, rest, groups, fns }
}

const ORDER = ['native', 'gc', 'snapdom-core', 'dom-measure', 'plugin-mixed', 'portable', 'other-js']
const LABEL = {
  native: 'browser (SVG decode, layout, codecs, idle)',
  gc: 'garbage collection',
  'snapdom-core': 'snapdom core (capture/raster)',
  'dom-measure': 'measurement against the DOM  [NOT portable]',
  'plugin-mixed': 'src/index.js orchestration  [mixed]',
  portable: 'bytes/fonts/pagination  [PORTABLE to WASM]',
  'other-js': 'other JS',
}

for (const pages of SIZES) {
  const results = []
  for (let r = 0; r < RUNS; r++) results.push(await run(pages))
  const last = results[results.length - 1]
  const avg = (pick) => results.reduce((s, x) => s + pick(x), 0) / results.length

  console.log(`\n${'='.repeat(72)}\n  a ~${pages}-page document → ${last.rest.pageCount} A4 pages, ` +
    `${(last.cold.bytes / 1048576).toFixed(2)} MB of PDF   (mean of ${RUNS} runs)`)
  console.log(`${'='.repeat(72)}`)
  console.log(`  snapdom capture      ${ms(avg(x => x.captureMs))}`)
  console.log(`  cold export          ${ms(avg(x => x.cold.wall))}`)
  console.log(`  warm export          ${ms(avg(x => x.rest.warm))}   (raster caches)`)
  console.log(`  image:false export   ${ms(avg(x => x.rest.textOnly))}   (no pixels: text layer + PDF)`)
  console.log(`  codec:jpeg export    ${ms(avg(x => x.rest.jpeg))}`)

  const total = [...last.groups.values()].reduce((a, b) => a + b, 0)
  console.log(`\n  CPU profile of the cold export — ${ms(total)} sampled over ${ms(last.cold.wall)} of wall clock`)
  for (const g of ORDER) {
    const v = last.groups.get(g) || 0
    if (!v) continue
    console.log(`    ${LABEL[g].padEnd(46)} ${ms(v).padStart(8)}   ${pct(v, last.cold.wall).padStart(6)} of wall clock`)
  }
  const portable = last.groups.get('portable') || 0
  const mixed = last.groups.get('plugin-mixed') || 0
  console.log(`\n    optimistic WASM ceiling (portable + ALL of index.js): ` +
    `${ms(portable + mixed)} = ${pct(portable + mixed, last.cold.wall)} of the export`)

  console.log(`\n  most expensive functions in the export:`)
  const top = [...last.fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  for (const [k, v] of top) console.log(`    ${ms(v).padStart(8)}  ${k}`)
}

await browser.close()
server.close()
