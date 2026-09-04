// __tests__/category.libs.js
// Shared, SIDE-EFFECT-FREE surface for the category comparison: the library adapters and the
// scenario builders. Importing a *.benchmark.js file from a test executes its top-level
// bench() calls, which throw "bench() is only available in benchmark mode" and take the whole
// test file down with them — so anything both a bench and a test need lives here instead.
//
// The competitor adapters, the fixture-free scenes and the capability oracle live one level
// out, in `docs/compare/live/harness.js`, because the LIVE LAB on the docs site runs the same
// comparison in the user's own browser and can only import what the site serves. Same
// adapters, same scenes, same oracle, one place: a lab that drifts from the measured table is
// how a demo starts contradicting the README.
//
// Competitors are fetched from a CDN. A STATIC `import ... from 'https://…'` aborts
// collection of every file importing this module when the link is down or slow, which is why
// the capability matrix could not live inside `npm test`. Each competitor is loaded lazily
// and independently by loadLibs() instead: one unreachable payload costs one row, and the
// suites report it as unavailable. snapdom is local, so its row always runs, offline included.
//
// Every adapter has the same signature, (el) => Promise<pngDataUrl>, and every library is
// called with its DEFAULTS at scale 1, so the comparison is like-for-like.

import { snapdom } from '../src/index'
import { COMPETITORS, toDataUrl } from '../docs/compare/live/harness.js'

export {
  toDataUrl,
  complexCardHTML,
  bigTableHTML,
  cssHeavyScenario,
  shadowTreeScenario,
  deepTreeScenario,
  dashboardScenario,
  galleryScenario,
} from '../docs/compare/live/harness.js'

import { complexCardHTML, bigTableHTML } from '../docs/compare/live/harness.js'

// Insertion order is the order every report renders in, so keep snapdom first.
const LOADERS = {
  // burst:false is load-bearing for FAIRNESS. tinybench runs each library's iterations
  // against the same mounted element, and snapdom memoizes an element from its first capture,
  // so from the second iteration on the "pipeline" column would be the memo while every
  // competitor ran its full pipeline. The memo is a real product win, but it is
  // measured honestly in category.polling.benchmark.js under its own label; this table claims
  // steady-state PIPELINE cost, so it must pin the pipeline.
  //
  // dpr:1 matters as much as scale:1, and only shows up off headless. snapdom defaults `dpr`
  // to window.devicePixelRatio while every competitor adapter pins pixelRatio/scale to 1, so
  // on a retina screen snapdom alone rasterized and encoded FOUR TIMES the pixels — a ~10x
  // slower row for a reason that has nothing to do with the pipeline. Headless chromium runs
  // at DPR 1, which is why the repo table never showed it and the live lab did.
  // toCanvas + the harness's own toDataURL, the normalization html2canvas's canvas already
  // gets and the route modern-screenshot and html-to-image take internally (a synchronous
  // canvas.toDataURL). toPng reaches the same PNG data URL and then loads it into an <img>
  // for the caller — 40 ms on the 500-row table, 3 ms at 60 rows — a stage no other row pays;
  // toBlob takes the asynchronous encode plus a FileReader, 3–5 ms of latency per capture
  // that a 20-tick polling loop turned into 19.8 → 90.6 ms. Same finish line, cheapest
  // honest route, for everyone.
  'snapDOM current': async () => async (el) => toDataUrl(await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })),
  ...COMPETITORS,
}

/** Every library name the category covers, in report order. */
export const LIB_NAMES = Object.keys(LOADERS)

/** name → why it could not be loaded. Populated by loadLibs(). */
export const UNAVAILABLE = new Map()

let loaded = null

/**
 * Resolve every adapter this machine can actually reach: name → (el) => Promise<pngDataUrl>.
 * An unreachable library is absent from the result and lands in UNAVAILABLE with the reason.
 */
export async function loadLibs() {
  if (loaded) return loaded
  const libs = {}
  for (const [name, load] of Object.entries(LOADERS)) {
    try {
      libs[name] = await load()
    } catch (e) {
      UNAVAILABLE.set(name, String(e?.message || e).slice(0, 120))
    }
  }
  loaded = libs
  return libs
}

export const SCENARIOS = [
  { label: 'Complex card (viewport)', width: 520, html: complexCardHTML(), opts: { warmupIterations: 2, iterations: 8, time: 0 } },
  { label: 'Big table (500 rows, ~11.5k px tall)', width: 640, html: bigTableHTML(500), opts: { warmupIterations: 1, iterations: 8, time: 0 } },
  { label: 'Simple node, page view (1200x800)', width: 1200, height: 800, html: '<h1>Page view (1200x800)</h1>', opts: { warmupIterations: 2, iterations: 8, time: 0 } },
]

// ── Scenes that need files on disk ──────────────────────────────────────────
// These stay here rather than in the shared harness: they resolve fixtures through
// import.meta.url, which only points at __tests__/fixtures/ from this file.

/** 40 distinct same-origin PNGs in a grid — the real fetch → inline path, which the
 *  data:-URL galleries in the older benches never touch. */
export function imageGridScenario() {
  const root = document.createElement('div')
  root.style.cssText = 'width:880px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px'
  const urls = []
  for (let i = 0; i < 40; i++) {
    const url = new URL(`./fixtures/images/img-${String(i).padStart(2, '0')}.png`, import.meta.url).href
    urls.push(url)
    const img = document.createElement('img')
    img.src = url
    img.style.cssText = 'width:200px;height:200px;object-fit:cover;border-radius:6px'
    root.appendChild(img)
  }
  document.body.appendChild(root)
  const ready = Promise.allSettled([...root.querySelectorAll('img')].map((im) => im.decode?.()))
  return { root, urls, ready, cleanup: () => root.remove() }
}

/** Article card: two real webfont families (Inter 400/700 + JetBrains Mono, same-origin
 *  woff2 fixtures), ~80 text nodes. Competitors embed fonts BY DEFAULT, so the plain
 *  defaults profile systematically understated their cost while snapdom's font path went
 *  unmeasured. Callers must await `ready` and call `cleanup`. */
export function fontArticleScenario() {
  const face = (fam, w, file) =>
    `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;` +
    `src:url('${new URL(`./fixtures/fonts/${file}`, import.meta.url).href}') format('woff2')}`
  const style = document.createElement('style')
  style.setAttribute('data-bench-fonts', '')
  style.textContent = [
    face('BenchInter', 400, 'inter-400.woff2'),
    face('BenchInter', 700, 'inter-700.woff2'),
    face('BenchMono', 400, 'jbmono-400.woff2'),
  ].join('\n')
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.style.cssText = "width:600px;padding:24px;background:#fff;font-family:'BenchInter',sans-serif"
  let html = '<h1 style="font-weight:700;margin:0 0 12px">Quarterly engineering report</h1>'
  for (let i = 0; i < 20; i++) {
    html += `<h3 style="font-weight:700;margin:10px 0 4px">Section ${i + 1}</h3>
      <p style="margin:0 0 6px">Deployment frequency rose while incident count fell — the
      pipeline held at <code style="font-family:'BenchMono',monospace">p99=${120 + i}ms</code>
      across region ${i}.</p>
      <p style="margin:0">Attribution: team ${String.fromCharCode(65 + (i % 8))}.</p>`
  }
  root.innerHTML = html
  document.body.appendChild(root)
  const ready = document.fonts.ready.then(() => Promise.all(
    [['400 14px BenchInter'], ['700 14px BenchInter'], ['400 14px BenchMono']]
      .map(([f]) => document.fonts.load(f))))
  return { root, ready, cleanup: () => { root.remove(); style.remove() } }
}
