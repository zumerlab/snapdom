// Shared comparison harness — the SINGLE source of the competitor adapters, the realistic
// scenes and the capability oracle.
//
// It lives under docs/ because the live lab (docs/compare/live/) is a static page on the
// published site and can only import files the site serves. The repo's measurement suite
// imports it from here too — `__tests__/category.libs.js` (benchmarks) and
// `__tests__/category.capabilities.test.js` (matrix) — so the page users run in their own
// browser and the numbers the README quotes come from the same adapters, the same scenes and
// the same oracle. Duplicating them is how a live demo starts contradicting the docs.
//
// Two rules everything here exists to enforce:
//   1. ONE OUTPUT STAGE for every library: a PNG data URL. Comparing snapdom's SVG url
//      against a competitor's rasterized PNG is what produced the old "0.5 ms" README table.
//   2. DEFAULTS PROFILE at scale 1, versions pinned. Configured profiles get their own label.
//
// No imports, no build step, no framework: it runs as-is in a browser and under vite.

/** Normalize any library output (data URL | <img> | <canvas> | Blob) to a PNG data URL,
 *  so every caller ends at the same stage. */
export async function toDataUrl(out) {
  if (typeof out === 'string') return out
  if (out?.tagName === 'IMG') return out.src
  if (out?.tagName === 'CANVAS') return out.toDataURL('image/png')
  if (out instanceof Blob) return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(out) })
  if (out && typeof out.toPng === 'function') return toDataUrl(await out.toPng())
  throw new Error('unrecognized capture output')
}

// Vite statically analyses `import()` with a literal argument and tries to resolve it at
// build time; @vite-ignore hands the URL to the browser's own loader instead.
const cdn = (url) => import(/* @vite-ignore */ url)

const pick = (m) => (m.default && typeof m.default === 'object' ? m.default : m)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(undefined)
    script.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(script)
  })
}

/** name -> async () => (el) => Promise<pngDataUrl>.
 *  Competitors only: snapdom is added by each caller from the build it means to measure
 *  (the repo suite from src/, the live lab from the published bundle). Versions are pinned
 *  because an unpinned CDN specifier silently re-benchmarks a different library. */
export const COMPETITORS = {
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

  // domlens nests its options: `{ output: { scale } }`. A flat `{ scale: 1 }` is silently
  // ignored and the capture comes out at devicePixelRatio — 4x the pixels of every other row
  // on a retina screen, and a comparison that is no longer like-for-like. Headless chromium
  // runs at DPR 1, which is why this only surfaced in the live lab.
  'domlens.js 0.1.0': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm')
    return async (el) => toDataUrl(await m.capture(el, { output: { scale: 1 } }))
  },

  '@renoun/screenshot 0.3.3': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/@renoun/screenshot@0.3.3/+esm')
    return async (el) => toDataUrl(await m.screenshot.canvas(el, { scale: 1 }))
  },
}

// ── Scenes ──────────────────────────────────────────────────────────────────
// Fixture-free by design: everything here builds from strings and canvas, so the same scene
// runs in the test suite, in the live lab and offline. Scenes that need files on disk
// (webfont woff2, real image URLs) stay in __tests__/category.libs.js.

export function complexCardHTML() {
  let items = ''
  for (let i = 0; i < 12; i++) {
    items += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px dashed #d8d6cc">
      <div style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%, #ff8800, #cc00cc);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>
      <div style="flex:1"><b style="letter-spacing:.02em">Item ${i} 🚀</b><br><span style="color:#6b7069;font-size:11px">detail with <i>emphasis</i> and <code style="background:#eee;border-radius:3px;padding:0 3px">code</code></span></div>
      <span style="transform:rotate(${i * 3}deg);display:inline-block;background:linear-gradient(135deg,#0f5c48,#0a3d30);color:#fff;border-radius:10px;padding:2px 8px;font-size:10px">tag${i}</span>
    </div>`
  }
  // No class attributes anywhere in a scene: the host page's own CSS would style it. The
  // first live run of this scene picked up the docs site's `.hero { padding: 76px }` rule and
  // measured a different box than the test harness did.
  return `<div style="position:relative;border-radius:14px;padding:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border:1px solid #d8d6cc">
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

/** ~10k-rule utility stylesheet + a ~1000-node tree styled ONLY by classes — the Tailwind
 *  shape. Every inline-styled scene leaves the author-stylesheet scan unexercised. */
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
  // Three columns, not one stack: 240 cards in a single column is 900x25903, past the
  // 16384px canvas limit, and each library clamps to a DIFFERENT scale there — which
  // silently ends the one-output-stage rule the whole comparison rests on.
  root.style.cssText = 'width:900px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;align-items:start'
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

/** 150 open shadow hosts, nested 3 levels, ~3000 nodes — the design-system norm. */
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

/** Deep nested flex/grid tree: 16 top-level chains, 10 levels each, 11 leaves per level —
 *  ~2,100 elements at depth ~11. Ported from domlens's own benchmark corpus
 *  (tests/bench/pages/deep-tree.html), which is the scene their published table has snapdom
 *  losing worst on. Nothing else here nests this deep, and depth is its own cost: every level
 *  is a flex or grid container whose children resolve used values against it.
 *
 *  Their page stacks 24 chains: 1232x20340, past the 16384px decode limit, where snapdom
 *  downscales to 16384 and html2canvas/domlens rasterize the full height — two output sizes,
 *  and the one-output-stage rule ends (their own table has snapdom at 1031x16384 against
 *  1280x20340). Two chains per row fits the height but is 2472px wide, and domlens's
 *  viewport-sized clone iframe paints nothing past the viewport edge — a real limit, but not
 *  what this scene measures. So: the same chain, the same depth, 16 of the 24. */
export function deepTreeScenario() {
  const style = document.createElement('style')
  style.setAttribute('data-bench-deeptree', '')
  style.textContent = `
    [data-deep] .branch{display:flex;gap:2px;padding:2px;border:1px solid rgba(0,0,0,.08);border-radius:3px}
    [data-deep] .branch.col{flex-direction:column}
    [data-deep] .grid-branch{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:2px;border:1px dashed rgba(30,64,175,.25)}
    [data-deep] .leaf{flex:1;min-width:8px;min-height:8px;border-radius:2px;text-align:center;overflow:hidden}`
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.setAttribute('data-deep', '')
  // content-box and line-height are pinned because the host page reaches in: the docs site's
  // `* { box-sizing: border-box }` and body line-height laid this root out at 1200x27540
  // where vitest had 1232x20340. Same scene, same host-independent box.
  root.style.cssText = 'width:1200px;box-sizing:content-box;padding:16px;background:#fafafa;font-family:Arial,sans-serif;font-size:10px;line-height:normal;color:#333'
  const tree = document.createElement('div')
  tree.className = 'branch'
  tree.style.flexWrap = 'wrap'

  let count = 0
  const makeLeaf = (depth) => {
    const leaf = document.createElement('div')
    leaf.className = 'leaf'
    leaf.style.background = `hsl(${(count * 17) % 360}, 60%, ${88 - depth * 3}%)`
    leaf.textContent = String(count++)
    return leaf
  }
  const makeChain = (depth) => {
    const node = document.createElement('div')
    node.className = depth % 3 === 2 ? 'grid-branch' : (depth % 2 === 0 ? 'branch' : 'branch col')
    count++
    for (let i = 0; i < 11; i++) node.appendChild(makeLeaf(depth))
    if (depth < 10) node.appendChild(makeChain(depth + 1))
    return node
  }
  for (let c = 0; c < 16; c++) tree.appendChild(makeChain(0))
  root.appendChild(tree)
  document.body.appendChild(root)
  return { root, cleanup: () => { root.remove(); style.remove() } }
}

/** The dashboard the polling scenario re-captures every tick. */
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

// ── Capability matrix: fixture + pixel oracle ───────────────────────────────
// Verified by PIXELS, never by documentation. One marker colour per capability, all far
// apart in RGB, each 60x60 = 3600px at scale 1.

export const CAP_TARGETS = {
  sanity_render:       [[0x00, 0xc8, 0x00]],                     // green: if missing, the capture itself failed
  open_shadow_dom:     [[0xe0, 0x00, 0x00]],                     // red inside an open shadow root
  pseudo_elements:     [[0x00, 0x00, 0xe0]],                     // blue ::before
  conic_gradient:      [[0xff, 0x88, 0x00], [0xcc, 0x00, 0xcc]], // orange AND magenta halves
  slotted_content:     [[0x00, 0x90, 0x90]],                     // teal light-DOM child through <slot>
  adopted_stylesheets: [[0x80, 0x80, 0x00]],                     // olive via constructable stylesheet
  canvas_content:      [[0xff, 0x66, 0xaa]],                     // pink painted on a <canvas> in the subtree
}
export const CAPS = Object.keys(CAP_TARGETS).filter((k) => k !== 'sanity_render')
const TOL = 45        // per-channel tolerance
const THRESHOLD = 800 // pixels

/** `mutant: true` builds the same fixture with every capability REMOVED. The oracle must
 *  report all of them absent on it — if it cannot say "no", nothing it says means anything. */
export function buildCapabilityFixture({ mutant = false } = {}) {
  const stage = document.createElement('div')
  stage.style.cssText = 'width:420px;padding:20px;background:#fff;font-family:sans-serif'
  const sq = 'width:60px;height:60px;margin-top:10px;'

  const style = document.createElement('style')
  style.textContent = mutant
    ? '#cap-pseudo{position:relative}'
    : '#cap-pseudo{position:relative}#cap-pseudo::before{content:"";position:absolute;inset:0;background:#0000e0}'
  stage.appendChild(style)

  const plain = document.createElement('div'); plain.style.cssText = sq + 'margin-top:0;background:#00c800'
  const shadowHost = document.createElement('div'); shadowHost.style.cssText = sq
  const pseudo = document.createElement('div'); pseudo.id = 'cap-pseudo'; pseudo.style.cssText = sq
  const conic = document.createElement('div'); conic.style.cssText = sq + (mutant ? 'background:#fff' : 'background:conic-gradient(#ff8800 0deg 180deg,#cc00cc 180deg 360deg)')
  const slotHost = document.createElement('div'); slotHost.style.cssText = sq
  const adopted = document.createElement('div'); adopted.id = 'cap-adopted'; adopted.style.cssText = sq
  const cnv = document.createElement('canvas'); cnv.width = 60; cnv.height = 60; cnv.style.cssText = sq
  for (const el of [plain, shadowHost, pseudo, conic, slotHost, adopted, cnv]) stage.appendChild(el)

  const sr = shadowHost.attachShadow({ mode: 'open' })
  sr.innerHTML = mutant ? '' : '<div style="width:60px;height:60px;background:#e00000"></div>'

  const slotRoot = slotHost.attachShadow({ mode: 'open' })
  slotRoot.innerHTML = '<slot></slot>'
  const light = document.createElement('div')
  light.style.cssText = 'width:60px;height:60px;background:' + (mutant ? '#fff' : '#009090')
  slotHost.appendChild(light)

  const sheet = new CSSStyleSheet()
  sheet.replaceSync('#cap-adopted{background:' + (mutant ? '#fff' : '#808000') + '}')
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

  if (!mutant) { const ctx = cnv.getContext('2d'); ctx.fillStyle = '#ff66aa'; ctx.fillRect(0, 0, 60, 60) }
  return stage
}

/** capability -> boolean, by counting marker pixels in a captured PNG data URL. */
export async function analyzeCapabilities(dataUrl) {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  const counts = {}
  for (const k of Object.keys(CAP_TARGETS)) counts[k] = CAP_TARGETS[k].map(() => 0)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    for (const k of Object.keys(CAP_TARGETS)) CAP_TARGETS[k].forEach((t, j) => {
      if (Math.abs(r - t[0]) <= TOL && Math.abs(g - t[1]) <= TOL && Math.abs(b - t[2]) <= TOL) counts[k][j]++
    })
  }
  const res = {}
  for (const k of Object.keys(CAP_TARGETS)) res[k] = counts[k].every((n) => n >= THRESHOLD)
  return res
}
