// The comparison on a REAL page: the docs site's own /compare/ page, with its stylesheets,
// its fonts and its scripts, instead of the bare harness the category benches run in. Every
// number a real page adds — the author `::before` rules, the `:hover` and `:first-child`
// selectors that once switched SnapDOM's fast paths off for the whole document — shows up
// here and nowhere else.
//
// Same rules as the category benches: one output stage (a PNG data URL) for every library,
// scale 1 and dpr 1, pinned competitor versions, the memo pinned off. Per-element COLD: the
// scene is mounted fresh for every capture, with unique content so no stage is served from an
// image cache — the number a one-shot user actually experiences.
//
//   npm run bench:realpage            (compiles, and serves the site itself when it is not up)
//   node scripts/realpage-bench.mjs [iterations=5]
//
// Prints a markdown table (median per cell). Chromium via Playwright, headless, DPR 1.
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The docs site, as `npm run site` serves it: started here unless one is already running.
const siteUp = () => fetch('http://127.0.0.1:4180/').then(() => true, () => false)
let site = null
if (!await siteUp()) {
  site = spawn(process.execPath, [fileURLToPath(new URL('./serve-site.mjs', import.meta.url))], { stdio: 'ignore' })
  for (let i = 0; i < 100 && !await siteUp(); i++) await new Promise((resolve) => setTimeout(resolve, 100))
}
// For a run that throws; a run that ends stops it by hand at the bottom.
process.on('exit', () => site?.kill())

const N = Number(process.argv[2] || 5)
const domlensHelper = await readFile(new URL('../__tests__/helpers/domlens.js', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('[page]', e.message))
// This module is available only inside this benchmark's browser; the docs server serves no tests.
await page.route('http://127.0.0.1:4180/__bench/domlens.js', (route) => route.fulfill({
  body: domlensHelper,
  contentType: 'text/javascript',
}))
await page.goto('http://127.0.0.1:4180/compare/', { waitUntil: 'load' })
// Keep the helper in the module cache, then restore HTTP caching before measuring captures.
await page.evaluate(async () => { await import('/__bench/domlens.js') })
await page.unroute('http://127.0.0.1:4180/__bench/domlens.js')

const rows = await page.evaluate(async ({ N }) => {
  const H = await import('/compare/live/harness.js')
  const { loadDomlens } = await import('/__bench/domlens.js')
  const { snapdom } = await import('/__dist/snapdom.mjs')
  const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const now = () => performance.now()
  const med = (a) => { a = a.slice().sort((x, y) => x - y); return +a[Math.floor(a.length / 2)].toFixed(1) }
  let salt = 0
  const stamp = (root) => { root.insertAdjacentHTML('afterbegin', `<div style="height:14px;font-size:11px">capture #${salt++}</div>`); return root }
  const scenes = {
    'Table, 500 rows': () => {
      const d = document.createElement('div')
      d.style.cssText = 'width:640px;box-sizing:content-box'
      d.innerHTML = H.bigTableHTML(500)
      document.body.appendChild(d)
      return { root: stamp(d), cleanup: () => d.remove() }
    },
    'Deep nested tree': () => { const s = H.deepTreeScenario(); stamp(s.root); return s },
    'Photo gallery': async () => { const s = await H.galleryScenario(); stamp(s.root); return s },
  }
  const libs = {
    'SnapDOM': async (el) => H.toDataUrl(await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })),
    'domlens.js 0.1.0': await loadDomlens(H.toDataUrl),
    'html2canvas 1.4.1': await H.COMPETITORS['html2canvas 1.4.1'](),
    'modern-screenshot 4.7.0': await H.COMPETITORS['modern-screenshot 4.7.0'](),
    'html-to-image 1.11.13': await H.COMPETITORS['html-to-image 1.11.13'](),
  }
  const out = []
  for (const [sceneName, mount] of Object.entries(scenes)) {
    const row = { scene: sceneName }
    for (const [lib, capture] of Object.entries(libs)) {
      // one untimed capture absorbs library initialisation
      { const s = await mount(); await tick(); try { await capture(s.root) } catch { /* init */ } s.cleanup(); await tick() }
      const t = []
      let size = ''
      for (let i = 0; i < N; i++) {
        const s = await mount()
        await tick()
        const t0 = now()
        const url = await capture(s.root)
        t.push(now() - t0)
        if (i === 0) { const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url }); size = `${img.naturalWidth}x${img.naturalHeight}` }
        s.cleanup()
        await tick()
      }
      row[lib] = med(t)
      row.size = row.size || size
      if (size !== row.size) row[lib] = `${med(t)} (${size} — not comparable)`
    }
    out.push(row)
  }
  return out
}, { N })

const libs = Object.keys(rows[0]).filter((k) => k !== 'scene' && k !== 'size')
const wide = Math.max(...libs.map((l) => l.length))
console.log(`\nPer-element cold capture on the docs site's /compare/ page, median of ${N}, in ms.\n`)
for (const r of rows) {
  const timed = libs.filter((l) => typeof r[l] === 'number').sort((a, b) => r[a] - r[b])
  console.log(`${r.scene} (${r.size})`)
  for (const l of timed) {
    const times = r[l] / r[timed[0]]
    console.log(`  ${l.padEnd(wide)}  ${String(r[l]).padStart(8)}  ${l === timed[0] ? 'fastest' : times.toFixed(1) + 'x'}`)
  }
  for (const l of libs) if (typeof r[l] !== 'number') console.log(`  ${l.padEnd(wide)}  ${String(r[l]).padStart(8)}`)
  console.log('')
}
await browser.close()
// Stopped by hand: a live child keeps this process from ending.
site?.kill()
