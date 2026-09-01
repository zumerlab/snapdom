// __tests__/category.libs.js
// Shared, SIDE-EFFECT-FREE surface for the category comparison: the library adapters and the
// scenario builders. Importing a *.benchmark.js file from a test executes its top-level
// bench() calls, which throw "bench() is only available in benchmark mode" and take the whole
// test file down with them — so anything both a bench and a test need lives here instead.
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

const pick = (m) => (m.default && typeof m.default === 'object' ? m.default : m)

// Vite statically analyses `import()` with a literal argument and tries to resolve it at
// build time; @vite-ignore hands the URL to the browser's own loader instead.
const cdn = (url) => import(/* @vite-ignore */ url)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(undefined)
    script.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(script)
  })
}

// Normalize any library output (data URL | <img> | <canvas> | Blob) to a PNG data URL,
// so every caller ends at the same stage.
export async function toDataUrl(out) {
  if (typeof out === 'string') return out
  if (out?.tagName === 'IMG') return out.src
  if (out?.tagName === 'CANVAS') return out.toDataURL('image/png')
  if (out instanceof Blob) return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(out) })
  if (out && typeof out.toPng === 'function') return toDataUrl(await out.toPng())
  throw new Error('unrecognized capture output')
}

// Insertion order is the order every report renders in, so keep snapdom first.
const LOADERS = {
  // burst:false is load-bearing for FAIRNESS. tinybench runs each library's iterations
  // against the same mounted element, and snapdom's auto-burst memoizes after 3 captures of
  // one element inside 2s — so from iteration 3 the "pipeline" column was the memo while
  // every competitor ran its full pipeline. The memo is a real product win, but it is
  // measured honestly in session.static.benchmark.js under its own label; this table claims
  // steady-state PIPELINE cost, so it must pin the pipeline.
  'snapDOM current': async () => async (el) => toDataUrl(await snapdom.toPng(el, { scale: 1, burst: false })),

  'html2canvas 1.4.1': async () => {
    if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
    return async (el) => toDataUrl(await window.html2canvas(el, { logging: false, scale: 1 }))
  },

  'html-to-image 1.11.13': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm')
    return async (el) => toDataUrl(await m.toPng(el, { pixelRatio: 1 }))
  },

  'modern-screenshot 4.7.0': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm')
    return async (el) => toDataUrl(await m.domToPng(el, { scale: 1 }))
  },

  'dom-to-image-more 3.10.2': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image-more@3.10.2/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'dom-to-image 2.6.0': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image@2.6.0/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'dom-to-image-modern 1.0.2': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image-modern@1.0.2/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'domlens.js 0.1.0': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm')
    return async (el) => toDataUrl(await m.capture(el, { scale: 1 }))
  },

  '@renoun/screenshot 0.3.3': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/@renoun/screenshot@0.3.3/+esm')
    return async (el) => toDataUrl(await m.screenshot.canvas(el, { scale: 1 }))
  },
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

// ── Scenarios ───────────────────────────────────────────────────────────────

export function complexCardHTML() {
  let items = ''
  for (let i = 0; i < 12; i++) {
    items += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px dashed #d8d6cc">
      <div style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%, #ff8800, #cc00cc);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>
      <div style="flex:1"><b style="letter-spacing:.02em">Item ${i} 🚀</b><br><span style="color:#6b7069;font-size:11px">detail with <i>emphasis</i> and <code style="background:#eee;border-radius:3px;padding:0 3px">code</code></span></div>
      <span style="transform:rotate(${i * 3}deg);display:inline-block;background:linear-gradient(135deg,#0f5c48,#0a3d30);color:#fff;border-radius:10px;padding:2px 8px;font-size:10px">tag${i}</span>
    </div>`
  }
  return `<div class="hero" style="position:relative;border-radius:14px;padding:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border:1px solid #d8d6cc">
    <h2 style="margin:0 0 4px">Complex card</h2>
    <svg width="80" height="24" viewBox="0 0 80 24" style="display:block;margin:4px 0"><rect x="0" y="4" width="80" height="16" rx="8" fill="#0f5c48"/><circle cx="14" cy="12" r="6" fill="#ff8800"/><text x="28" y="16" font-size="10" fill="#fff">inline svg</text></svg>
    <div style="transform:rotate(-1.5deg) scale(.98);border:2px solid #0f5c48;border-radius:10px;overflow:hidden;background:linear-gradient(180deg,#fff,#f4f4ee)">${items}</div>
    <p style="margin:10px 0 0;column-count:2;column-gap:14px;font-size:11px">Two-column text to force non-trivial layout. Shadows, gradients, transforms, inline SVG, emoji and mixed typography in one viewport-sized subtree.</p>
  </div>`
}

export function bigTableHTML(rows = 500) {
  let trs = ''
  for (let i = 0; i < rows; i++) {
    trs += `<tr style="background:${i % 2 ? '#f4f4ee' : '#fff'}"><td style="padding:4px 8px;border:1px solid #d8d6cc;font-weight:600">#${i}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;color:#0f5c48">item-${(i * 7919) % 10000}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;background:linear-gradient(90deg,#e8e8e0,#fff)">${(i * 13.37).toFixed(2)}</td><td style="padding:4px 8px;border:1px solid #d8d6cc"><span style="border-radius:8px;background:#a85e00;color:#fff;padding:1px 6px">tag${i % 9}</span></td></tr>`
  }
  return `<table style="border-collapse:collapse;width:100%">${trs}</table>`
}

export const SCENARIOS = [
  { label: 'Complex card (viewport)', width: 520, html: complexCardHTML(), opts: { warmupIterations: 2, iterations: 8, time: 0 } },
  { label: 'Big table (500 rows, ~11.5k px tall)', width: 640, html: bigTableHTML(500), opts: { warmupIterations: 1, iterations: 3, time: 0 } },
  { label: 'Simple node, page view (1200x800)', width: 1200, height: 800, html: '<h1>Page view (1200x800)</h1>', opts: { warmupIterations: 2, iterations: 8, time: 0 } },
]

// ── Real-world scenario builders (benchmark realism roadmap) ────────────────
// Shared by the category.*.benchmark.js files; building here keeps them import-safe for
// tests too (no bench() calls in this module).

/** ~10k-rule utility stylesheet + a ~1000-node tree styled ONLY by classes. Today every
 *  other bench styles inline, so styleScan's property universe and per-pseudo gates — the
 *  machinery with its own reverted-optimization history — went unexercised by any bench. */
export function cssHeavyScenario() {
  const rules = []
  const props = [
    ['margin', (i) => `${i % 33}px`], ['padding', (i) => `${i % 17}px`],
    ['color', (i) => `rgb(${i % 255},${(i * 7) % 255},${(i * 13) % 255})`],
    ['background-color', (i) => `rgb(${(i * 3) % 255},${(i * 11) % 255},${i % 255})`],
    ['border-radius', (i) => `${i % 24}px`], ['font-size', (i) => `${10 + (i % 14)}px`],
    ['letter-spacing', (i) => `${(i % 5) / 10}px`], ['line-height', (i) => `${1 + (i % 8) / 10}`],
    ['border', (i) => `${i % 3}px solid rgb(${i % 200},${i % 200},${i % 200})`],
    ['box-shadow', (i) => `0 ${i % 4}px ${i % 9}px rgba(0,0,0,.${i % 5})`],
  ]
  for (let i = 0; i < 950; i++) {
    for (const [prop, val] of props) {
      rules.push(`.u-${prop.replace(/[^a-z]/g, '')}-${i}{${prop}:${val(i)}}`)
    }
  }
  // A few hundred pseudo rules so the per-pseudo selector gates have something to gate.
  for (let i = 0; i < 200; i++) {
    rules.push(`.badge-${i}::before{content:"${i}";color:rgb(${i % 255},0,0);margin-right:2px}`)
  }
  rules.push('@media (min-width: 100px){.u-margin-1{margin:1px}}')
  const style = document.createElement('style')
  style.setAttribute('data-bench-cssheavy', '')
  style.textContent = rules.join('\n')
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.style.width = '900px'
  let html = ''
  for (let i = 0; i < 240; i++) {
    html += `<div class="u-margin-${i % 950} u-padding-${(i * 3) % 950} u-backgroundcolor-${(i * 7) % 950} u-borderradius-${i % 950}">
      <span class="u-color-${i % 950} u-fontsize-${(i * 5) % 950}">card ${i}</span>
      <span class="badge-${i % 200} u-letterspacing-${i % 950}">tag</span>
      <p class="u-lineheight-${i % 950} u-border-${(i * 2) % 950}">body text for card ${i}</p>
    </div>`
  }
  root.innerHTML = html
  document.body.appendChild(root)
  return { root, cleanup: () => { root.remove(); style.remove() } }
}

/** 150 open shadow hosts, nested 3 levels, ~3000 nodes total — the design-system norm the
 *  capability matrix proves renders but nothing prices. */
export function shadowTreeScenario() {
  const root = document.createElement('div')
  root.style.cssText = 'width:800px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px'
  const makeHost = (depth, label) => {
    const host = document.createElement('div')
    const sr = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `.box{padding:4px;border:1px solid #ccc;border-radius:4px;background:#f8f8f${depth}}
      .t{font-size:12px;color:#333}.t::after{content:" •";color:rgb(${depth * 80},0,0)}`
    const box = document.createElement('div')
    box.className = 'box'
    box.innerHTML = `<span class="t">${label}</span><slot></slot>`
    sr.append(style, box)
    if (depth < 3) {
      const child = makeHost(depth + 1, `${label}.${depth}`)
      host.appendChild(child) // slotted light-DOM child
    }
    return host
  }
  for (let i = 0; i < 50; i++) root.appendChild(makeHost(1, `c${i}`))
  document.body.appendChild(root)
  return { root, cleanup: () => root.remove() }
}

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

/** The session.* dashboard, shared so the polling scenario measures the same scene. */
export function dashboardScenario() {
  const el = document.createElement('div')
  el.style.cssText = 'width:360px;padding:16px;background:#fff;font-family:Arial,sans-serif;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.15)'
  el.innerHTML = `
    <h2 style="margin:0 0 8px;color:#222">Live metrics</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${Array.from({ length: 6 }, (_, i) => `
        <div style="padding:10px;border-radius:8px;background:${i % 2 ? '#eef' : '#efe'}">
          <div style="font-size:12px;color:#666">Metric ${i + 1}</div>
          <div class="metric-v" style="font-size:20px;font-weight:bold">${(i + 1) * 137}</div>
        </div>`).join('')}
    </div>`
  document.body.appendChild(el)
  return { root: el, cleanup: () => el.remove() }
}
