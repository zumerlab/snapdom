// Live comparison lab — runs the repo's own measurement scenes in the visitor's browser.
//
// The adapters, the scenes and the capability oracle come from ./harness.js, which the
// benchmark suite in __tests__/ imports too. Nothing here decides who wins: the table sorts
// by measured time and highlights whatever is fastest, snapdom included or not.
//
// Two rules the UI must keep visible, because breaking them quietly is how comparison pages
// end up lying:
//   - ONE OUTPUT STAGE. Every library is timed to a PNG data URL. Timing snapdom's SVG url
//     against a competitor's rasterized PNG is a missing raster + encode stage, and on a big
//     scene that stage is most of the cost.
//   - COLD AND STEADY ARE DIFFERENT NUMBERS. A fresh element and a re-captured one differ by
//     ~1.4x for snapdom, and the ranking is not the same in both columns. They get their own
//     columns, never an average.

import { snapdom } from 'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs'
import {
  COMPETITORS, toDataUrl,
  complexCardHTML, bigTableHTML, cssHeavyScenario, shadowTreeScenario, deepTreeScenario,
  dashboardScenario, galleryScenario,
  buildCapabilityFixture, analyzeCapabilities, CAPS,
} from './harness.js'

// The version is in the label on purpose: this page imports the PUBLISHED package from unpkg
// unless `npm run site` serves it, which rewrites the import to the local build. A run that
// says v2 is a run of v2.
const SNAP = `SnapDOM v${snapdom.version || '?'}`
const CAPTURE_TIMEOUT = 45_000

// snapdom's pipeline rows pin burst:false for the same reason the repo benchmark does: the
// auto-burst memo engages on the first capture, and a memo timed
// against everyone else's full pipeline is not a pipeline comparison. The memo gets its own
// scenario ("Polling"), where it runs with defaults and the label says so.
//
// dpr:1 is the other half of scale:1. snapdom defaults `dpr` to window.devicePixelRatio;
// every competitor adapter pins pixelRatio/scale to 1. Left alone, snapdom would rasterize
// and encode four times the pixels on a retina screen and lose the row for a reason that has
// nothing to do with capture. Same output size for everyone, or the table means nothing.
const ADAPTERS = {
  // toCanvas + the harness's toDataURL: the same finish line as every other row (a PNG data
  // URL) by the route html2canvas's canvas already takes here. toPng would add the <img>
  // load no competitor pays. Mirrors __tests__/category.libs.js.
  [SNAP]: async () => async (el) => toDataUrl(await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })),
  ...COMPETITORS,
}
const DEFAULT_ON = [SNAP, 'html2canvas 1.4.1', 'html-to-image 1.11.13', 'modern-screenshot 4.7.0']

// ── Scenes ──────────────────────────────────────────────────────────────────
// `mount` returns { root, cleanup }. Everything is built fresh for the cold arm, so a scene
// must be able to build itself as many times as the run asks for.

const wrap = (html, width) => () => {
  const root = document.createElement('div')
  root.style.cssText = `width:${width}px;background:#f6f5f0;padding:20px;font-family:Arial,sans-serif;font-size:13px`
  root.innerHTML = html
  return { root, cleanup: () => root.remove() }
}

const SCENES = {
  card: {
    label: 'Complex card',
    note: 'Shadows, gradients, transforms, inline SVG, emoji and two-column text in one viewport-sized subtree — the shape behind every "share this card" button.',
    cold: 3, steady: 5,
    mount: wrap(complexCardHTML(), 520),
  },
  table: {
    label: 'Table, 500 rows',
    note: '640 × ~12,000 px. Prices per-node cost at scale, and the raster of a large output — where the PNG encode weighs as much as the capture pipeline itself.',
    cold: 2, steady: 3,
    heavy: true,
    mount: wrap(bigTableHTML(500), 640),
  },
  css: {
    label: 'CSS-heavy page (10k rules)',
    note: '~10,000 author rules and 240 cards styled ONLY by classes — the shape of a Tailwind app. No other scene exercises author-stylesheet scanning.',
    cold: 2, steady: 3,
    heavy: true,
    mount: cssHeavyScenario,
  },
  shadow: {
    label: 'Shadow DOM (150 roots)',
    note: '150 open shadow roots nested 3 levels deep, ~3,000 nodes, with slotted light-DOM content — the norm in any web-component design system.',
    cold: 3, steady: 5,
    mount: shadowTreeScenario,
  },
  deep: {
    label: 'Deep nested tree (~2,100 nodes)',
    note: '16 chains, 10 levels each, with nested flex and grid and a 2px ::before stripe on every leaf. The scene stays under the 16384px image limit in one column. It exercises deep layout, pseudo-element rendering and the cost of rasterizing a large output. Read the diff column alongside the timing to compare what each library rendered.',
    cold: 1, steady: 3,
    heavy: true,
    mount: deepTreeScenario,
  },
  gallery: {
    label: 'Photo gallery (9 photos, 16 Mpx of sources)',
    note: 'A 3000×1400 hero and eight 1500×1000 thumbnails shown at 960×360 and ~232×130, fetched as same-origin blob: URLs like any HTTP image. Prices image inlining and downsampling: SnapDOM embeds only the pixels the output can show (4 MB of payload instead of 26 MB) and pays that work once per image.',
    cold: 2, steady: 3,
    heavy: true,
    mount: galleryScenario,
  },
  polling: {
    label: 'Polling: 20 captures in a row',
    note: 'A dashboard re-captured 20 times, with one metric changing every 4th tick. Here SnapDOM runs with its DEFAULTS — auto-burst memo and differential recapture ON — and the row says so. This is the one scenario where memoization is allowed.',
    polling: true, ticks: 20, cold: 0, steady: 3,
    mount: dashboardScenario,
  },
}

// ── DOM ─────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id)
const stage = $('lab-stage')
const status = $('lab-status')
const tbody = $('lab-tbody')
const thead = $('lab-thead')
const gallery = $('lab-gallery')
const runBtn = $('lab-run')
const sceneSel = $('lab-scene')
const sceneNote = $('lab-scene-note')

// Double rAF lets the progress text paint; the setTimeout keeps a throttled tab moving.
const tick = () => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120) })
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const fmt = (n) => (n >= 100 ? Math.round(n) : n.toFixed(1))

const LOAD_TIMEOUT = 20_000

function withTimeout(p, ms, what) {
  let t
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} ran past ${ms / 1000}s`)), ms) }),
  ])
}

function selectedLibs() {
  return [...document.querySelectorAll('#lab-libs input:checked')].map((i) => i.value)
}

function say(text) { status.textContent = text }

// ── Measurement ─────────────────────────────────────────────────────────────

/** Hold the page still for the duration of a run.
 *
 *  A whole-document cloner crops the element's REGION out of a clone it re-laid out, at
 *  viewport-relative coordinates — so if the page scrolls between the clone and the crop, the
 *  capture is of somewhere else entirely. Keeping the page still prevents scroll input from
 *  changing the region captured by libraries that clone the document.
 *
 *  The input has to be blocked, not corrected afterwards: a `scroll` listener that snaps back
 *  fires AFTER the page has already moved and is outrun by continuous wheel input, which is why
 *  the first version of this still read 25-28% under a real trackpad. preventDefault on the
 *  input events keeps the page where it is; the scroll listener stays as a backstop for
 *  programmatic scrolls, which no amount of preventDefault reaches.
 *
 *  Blocking beats `overflow:hidden`, which removes the scrollbar and reflows the very element
 *  being measured. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'])

function freezeScroll() {
  const y = window.scrollY
  const x = window.scrollX
  const block = (e) => e.preventDefault()
  const blockKey = (e) => { if (SCROLL_KEYS.has(e.key)) e.preventDefault() }
  const snap = () => { if (window.scrollY !== y || window.scrollX !== x) window.scrollTo(x, y) }
  window.addEventListener('wheel', block, { passive: false })
  window.addEventListener('touchmove', block, { passive: false })
  window.addEventListener('keydown', blockKey)
  window.addEventListener('scroll', snap, { passive: true })
  return () => {
    window.removeEventListener('wheel', block)
    window.removeEventListener('touchmove', block)
    window.removeEventListener('keydown', blockKey)
    window.removeEventListener('scroll', snap)
  }
}

let mountSeq = 0

/** Mount a scene into the visible stage, so the visitor sees exactly what is captured.
 *  The stage is cleared first: a scene left behind by a library that threw would sit in the
 *  document while the next one is measured, and the whole-document cloners would capture it.
 *
 *  Each mount is stamped with a serial. The cold arm rebuilds the same scene over and over,
 *  and identical content serializes to an identical data: URL — which the browser then serves
 *  from cache, quietly removing the decode stage from the measurement. The attribute changes
 *  the payload without moving a single pixel. */
async function mountInto(scene) {
  stage.innerHTML = ''
  const built = await scene.mount()
  built.root.setAttribute('data-lab-run', String(++mountSeq))
  stage.appendChild(built.root)
  return built
}

/** One library over one scene: per-element cold, then steady state on a single element. */
async function measure(name, capture, scene) {
  const row = { name, cold: null, steady: null, out: null, dim: null, error: null, fewSamples: false }

  // Every library first captures a throwaway node, discarded. That pays its one-time module
  // init (UA-default probes, worker spin-up, font scans) OUTSIDE the numbers, so the cold
  // column is per-element cold — the cost of capturing an element you have not captured
  // before — rather than "whoever loaded last looks slowest".
  say(`${name} — warming up`)
  const warm = await mountInto({ mount: wrap('<p>warm-up</p>', 120) })
  const warmT0 = performance.now()
  try { await withTimeout(capture(warm.root), CAPTURE_TIMEOUT, name) } catch { /* reported below if it also fails for real */ }
  const warmMs = performance.now() - warmT0
  warm.cleanup()
  await tick()

  // A library that needs seconds per capture on a real page is a finding, not a reason to
  // hang the tab: it keeps its row, on fewer samples, and the row says so.
  const slow = warmMs > 1500
  const coldRuns = slow ? Math.min(1, scene.cold) : scene.cold
  const steadyRuns = slow ? 2 : scene.steady
  row.fewSamples = slow

  let built = null
  try {
    const colds = []
    for (let i = 0; i < coldRuns; i++) {
      say(`${name} — first capture ${i + 1}/${coldRuns}`)
      built = await mountInto(scene)
      await tick()
      const t0 = performance.now()
      await withTimeout(capture(built.root), CAPTURE_TIMEOUT, name)
      colds.push(performance.now() - t0)
      built.cleanup()
      built = null
      await tick()
    }
    if (colds.length) row.cold = median(colds)

    built = await mountInto(scene)
    await tick()
    const steadies = []
    for (let i = 0; i < steadyRuns; i++) {
      say(`${name} — repeat ${i + 1}/${steadyRuns}`)
      const t0 = performance.now()
      const out = await withTimeout(capture(built.root), CAPTURE_TIMEOUT, name)
      steadies.push(performance.now() - t0)
      row.out = out
      await tick()
    }
    row.steady = median(steadies)
  } catch (e) {
    row.error = String(e?.message || e).slice(0, 160)
  } finally {
    // cssHeavyScenario also injects a <style> into <head>; clearing the stage is not enough.
    built?.cleanup()
  }
  await tick()
  return row
}

/** Polling: one sample = `ticks` captures of the SAME element, with a metric mutating every
 *  4th tick so an incremental path has to do real work. A fully static loop flatters a memo. */
async function measurePolling(name, capture, scene) {
  const row = { name, cold: null, steady: null, out: null, dim: null, error: null, perCapture: null }
  const built = await mountInto(scene)
  await tick()
  try {
    const samples = []
    for (let s = 0; s < scene.steady; s++) {
      say(`${name} — loop ${s + 1}/${scene.steady} (${scene.ticks} captures)`)
      const t0 = performance.now()
      for (let t = 0; t < scene.ticks; t++) {
        if (t % 4 === 0) {
          const cells = built.root.querySelectorAll('.metric-v')
          cells[t % cells.length].textContent = String(1000 + t * 7)
        }
        row.out = await withTimeout(capture(built.root), CAPTURE_TIMEOUT, name)
      }
      samples.push(performance.now() - t0)
      await tick()
    }
    row.steady = median(samples)
    row.perCapture = row.steady / scene.ticks
  } catch (e) {
    row.error = String(e?.message || e).slice(0, 160)
  } finally {
    built.cleanup()
  }
  await tick()
  return row
}

// ── Rendering ───────────────────────────────────────────────────────────────

const THUMB = 128

async function decorate(rows) {
  for (const r of rows) {
    if (!r.out || r.thumb) continue
    try {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = r.out })
      r.dim = `${img.naturalWidth}×${img.naturalHeight}`
      r.blank = isBlank(img)
      r.thumb = thumbOf(img)
    } catch { r.dim = null }
  }
  // Milliseconds alone cannot tell a fast capture from a fast capture OF THE WRONG THING.
  // A whole-document cloner can capture the wrong region if the stage clips the scene.
  // This column checks how far each output is from SnapDOM's, in pixels.
  const ref = rows.find((r) => r.name === SNAP)?.thumb
  if (!ref) return
  for (const r of rows) r.diff = r.thumb && r.name !== SNAP ? thumbDiff(ref, r.thumb) : null
}

/** Downscaled RGB of a capture — enough to tell two renderings of the same thing apart from
 *  two renderings of different things, without reading a 10 Mpx buffer. */
function thumbOf(img) {
  const c = document.createElement('canvas')
  c.width = THUMB; c.height = THUMB
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, THUMB, THUMB)   // flatten alpha, both sides alike
  ctx.drawImage(img, 0, 0, THUMB, THUMB)
  return ctx.getImageData(0, 0, THUMB, THUMB).data
}

/** Share of pixels that differ beyond tolerance, as a percentage — NOT the mean difference.
 *  The mean is what this used to report, and it is useless on pages that are mostly white: a
 *  capture that had picked up the wrong region of the document entirely, containing none of
 *  the requested element, scored 9.2% and read as a rounding difference. Counting pixels puts
 *  the same case near 100% and leaves antialiasing near zero. Tolerance matches the fidelity
 *  suite's. */
function thumbDiff(a, b) {
  let differing = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 25 || Math.abs(a[i + 1] - b[i + 1]) > 25 || Math.abs(a[i + 2] - b[i + 2]) > 25) differing++
  }
  return (differing / (a.length / 4)) * 100
}

/** A capture with one flat colour in it did not capture anything, and timing it is timing the
 *  wrong thing — the size check cannot see this, because a blank image is the right size.
 *  Sampled through a 160px thumbnail: real content survives the downscale as many distinct
 *  colours, a flat fill stays one, and a 10 Mpx capture stays cheap to check. */
function isBlank(img) {
  const n = 160
  const c = document.createElement('canvas')
  c.width = n; c.height = n
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, n, n)
  const { data } = ctx.getImageData(0, 0, n, n)
  const seen = new Set()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    seen.add((data[i] >> 3) + ',' + (data[i + 1] >> 3) + ',' + (data[i + 2] >> 3))
    if (seen.size > 3) return false
  }
  return true
}

/** Largest per-axis gap between two "W×H" strings, or 0 when either is unknown. */
function offBy(a, b) {
  if (!a || !b) return 0
  const [aw, ah] = a.split('×').map(Number)
  const [bw, bh] = b.split('×').map(Number)
  return Math.max(Math.abs(aw - bw), Math.abs(ah - bh))
}

function render(rows, scene, withGallery = false) {
  const ok = rows.filter((r) => r.steady != null)
  const best = ok.length ? Math.min(...ok.map((r) => r.steady)) : null
  const sorted = [...rows].sort((a, b) => (a.steady ?? Infinity) - (b.steady ?? Infinity))
  const ref = rows.find((r) => r.name === SNAP)?.dim

  thead.innerHTML = scene.polling
    ? '<tr><th>Library</th><th>20 captures</th><th>Per capture</th><th>vs fastest</th><th>Output</th><th>Differs from SnapDOM</th></tr>'
    : '<tr><th>Library</th><th>First capture</th><th>Repeat</th><th>vs fastest</th><th>Output</th><th>Differs from SnapDOM</th></tr>'

  tbody.innerHTML = ''
  for (const r of sorted) {
    const tr = document.createElement('tr')
    if (r.steady != null && r.steady === best) tr.className = 'fastest'
    const tags = []
    if (r.name === SNAP) tags.push(scene.polling ? 'defaults, memo ON' : 'burst:false')
    if (r.fewSamples) tags.push('few samples')
    // A library whose output is a different SIZE is not on the same output stage, and its
    // milliseconds are not comparable, even if the captured content looks correct.
    // A pixel or two apart is rounding (845.4 floored vs ceiled), not a different stage.
    if (offBy(r.dim, ref) > 2) tags.push(`output ${r.dim} ≠ ${ref}, not comparable`)
    if (r.blank) tags.push('blank output — captured nothing')
    const cells = [`<td class="feature">${r.name}${tags.map((t) => ` <span class="tag">${t}</span>`).join('')}</td>`]
    if (r.error) {
      cells.push(`<td class="no" colspan="5">did not finish — ${r.error}</td>`)
    } else if (scene.polling) {
      cells.push(`<td class="num">${fmt(r.steady)} ms</td>`)
      cells.push(`<td class="num">${fmt(r.perCapture)} ms</td>`)
      cells.push(`<td class="num">${best && r.steady ? (r.steady / best).toFixed(2) + '×' : '—'}</td>`)
      cells.push(`<td>${r.dim || '—'}</td>`)
      cells.push(diffCell(r))
    } else {
      cells.push(`<td class="num">${r.cold != null ? fmt(r.cold) + ' ms' : '—'}</td>`)
      cells.push(`<td class="num">${fmt(r.steady)} ms</td>`)
      cells.push(`<td class="num">${best ? (r.steady / best).toFixed(2) + '×' : '—'}</td>`)
      cells.push(`<td>${r.dim || '—'}</td>`)
      cells.push(diffCell(r))
    }
    tr.innerHTML = cells.join('')
    tbody.appendChild(tr)
  }

  if (!withGallery) return
  gallery.innerHTML = ''
  for (const r of sorted) {
    if (!r.out) continue
    const fig = document.createElement('figure')
    fig.innerHTML = `<figcaption>${r.name} · ${r.dim || '?'}</figcaption>`
    const a = document.createElement('a')
    a.href = r.out; a.target = '_blank'; a.rel = 'noopener'
    const img = new Image(); img.src = r.out; img.loading = 'lazy'
    a.appendChild(img); fig.appendChild(a)
    gallery.appendChild(fig)
  }
  $('lab-gallery-note').hidden = gallery.children.length === 0
}

/** Not a correctness verdict — SnapDOM is only the reference because it is the one library
 *  this page ships. Small numbers are antialiasing and font rasterization; a large one means
 *  the two libraries did not render the same thing, and the gallery below shows which. */
function diffCell(r) {
  if (r.name === SNAP) return '<td class="feature">reference</td>'
  if (r.diff == null) return '<td>—</td>'
  const cls = r.diff >= 10 ? 'no' : r.diff >= 2 ? 'partial' : 'yes'
  return `<td class="${cls}">${r.diff.toFixed(1)}%</td>`
}

function stamp() {
  const ua = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ') || navigator.userAgent
  return `${ua} · DPR ${window.devicePixelRatio} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
}

// ── Run ─────────────────────────────────────────────────────────────────────

let lastRun = null

async function run() {
  const scene = SCENES[sceneSel.value]
  const names = selectedLibs()
  if (!names.length) { say('Pick at least one library.'); return }

  runBtn.disabled = true
  sceneSel.disabled = true
  const thaw = freezeScroll()
  tbody.innerHTML = ''
  gallery.innerHTML = ''
  $('lab-copy').hidden = true

  const rows = []
  for (const name of names) {
    say(`loading ${name}…`)
    let capture = null
    try {
      capture = await withTimeout(ADAPTERS[name](), LOAD_TIMEOUT, `loading ${name}`)
    } catch (e) {
      rows.push({ name, cold: null, steady: null, error: `could not load from the CDN — ${String(e?.message || e).slice(0, 100)}` })
      render(rows, scene)
      continue
    }
    await tick()
    rows.push(scene.polling ? await measurePolling(name, capture, scene) : await measure(name, capture, scene))
    await decorate(rows)
    render(rows, scene)
  }

  stage.innerHTML = ''
  // Only now. Libraries such as html2canvas clone the WHOLE document, so every result image left in
  // the page while the run is still going gets cloned and re-encoded by whoever captures next
  // — the page would be measuring itself.
  render(rows, scene, true)
  lastRun = { scene, rows, stamp: stamp() }
  $('lab-stamp').textContent = lastRun.stamp
  $('lab-copy').hidden = false
  thaw()
  say(`done — ${rows.length} libraries on "${scene.label}".`)
  runBtn.disabled = false
  sceneSel.disabled = false
}

function copyResults() {
  if (!lastRun) return
  const { scene, rows, stamp: st } = lastRun
  const head = scene.polling
    ? '| Library | 20 captures | per capture | vs fastest | output |'
    : '| Library | First capture | Repeat | vs fastest | output |'
  const ok = rows.filter((r) => r.steady != null)
  const best = ok.length ? Math.min(...ok.map((r) => r.steady)) : null
  const body = [...rows].sort((a, b) => (a.steady ?? Infinity) - (b.steady ?? Infinity)).map((r) => {
    if (r.error) return `| ${r.name} | did not finish: ${r.error} | | | |`
    const a = scene.polling ? `${fmt(r.steady)} ms` : (r.cold != null ? `${fmt(r.cold)} ms` : '—')
    const b = scene.polling ? `${fmt(r.perCapture)} ms` : `${fmt(r.steady)} ms`
    return `| ${r.name} | ${a} | ${b} | ${(r.steady / best).toFixed(2)}× | ${r.dim || '—'} |`
  }).join('\n')
  const text = `**${scene.label}** — PNG output for every library, defaults, scale 1\n\n${head}\n|---|---|---|---|---|\n${body}\n\n${st}\n`
  navigator.clipboard?.writeText(text).then(() => say('results copied as markdown.'), () => say('could not write to the clipboard.'))
}

// ── Capability matrix ───────────────────────────────────────────────────────

const CAP_LABELS = {
  open_shadow_dom: 'Shadow DOM',
  pseudo_elements: '::before / ::after',
  conic_gradient: 'conic-gradient',
  slotted_content: 'slotted content',
  adopted_stylesheets: 'adoptedStyleSheets',
  canvas_content: 'painted &lt;canvas&gt;',
}

async function runMatrix() {
  const btn = $('cap-run')
  const out = $('cap-tbody')
  const selfTest = $('cap-selftest')
  btn.disabled = true
  out.innerHTML = ''
  selfTest.textContent = 'checking the oracle…'
  selfTest.className = 'cap-selftest'

  const adopted = document.adoptedStyleSheets
  const names = selectedLibs().length ? selectedLibs() : DEFAULT_ON

  try {
    // Mutation test first. The oracle must report every capability ABSENT on a fixture built
    // without any of them. An oracle that cannot say "no" makes every PASS below meaningless.
    const snapCapture = await ADAPTERS[SNAP]()
    const mutant = buildCapabilityFixture({ mutant: true })
    stage.appendChild(mutant)
    await tick()
    const m = await analyzeCapabilities(await snapCapture(mutant))
    mutant.remove()
    const clean = m.sanity_render && CAPS.every((c) => !m[c])
    selfTest.textContent = clean
      ? '✓ oracle verified: on a fixture built WITHOUT any of these capabilities, it reports all six absent.'
      : '⚠ the oracle reported a capability present on the mutant fixture — do not trust the table below.'
    selfTest.className = 'cap-selftest ' + (clean ? 'ok' : 'bad')
    await tick()

    for (const name of names) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td class="feature">${name}</td>` + CAPS.map(() => '<td>…</td>').join('') + '<td class="num">…</td>'
      out.appendChild(tr)
      say(`matrix — ${name}`)
      let capture = null
      try { capture = await ADAPTERS[name]() } catch (e) {
        tr.innerHTML = `<td class="feature">${name}</td><td class="no" colspan="${CAPS.length + 1}">could not load — ${String(e?.message || e).slice(0, 90)}</td>`
        continue
      }
      const fixture = buildCapabilityFixture()
      stage.appendChild(fixture)
      await tick()
      const t0 = performance.now()
      try {
        const url = await withTimeout(capture(fixture), CAPTURE_TIMEOUT, name)
        const cold = Math.round(performance.now() - t0)
        const r = await analyzeCapabilities(url)
        tr.innerHTML = `<td class="feature">${name}</td>` +
          CAPS.map((c) => `<td class="${r[c] ? 'yes' : 'no'}">${r[c] ? 'yes' : 'no'}</td>`).join('') +
          `<td class="num">${cold} ms</td>`
        if (!r.sanity_render) {
          tr.innerHTML = `<td class="feature">${name}</td><td class="no" colspan="${CAPS.length + 1}">rendered nothing</td>`
        }
      } catch (e) {
        tr.innerHTML = `<td class="feature">${name}</td><td class="no" colspan="${CAPS.length + 1}">failed — ${String(e?.message || e).slice(0, 90)}</td>`
      }
      fixture.remove()
      await tick()
    }
    say('matrix done.')
  } finally {
    // buildCapabilityFixture adopts a constructable stylesheet on the document; put the
    // page's own list back so repeated runs do not pile them up.
    document.adoptedStyleSheets = adopted
    stage.innerHTML = ''
    btn.disabled = false
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function boot() {
  for (const [key, s] of Object.entries(SCENES)) {
    const o = document.createElement('option')
    o.value = key; o.textContent = s.label + (s.heavy ? ' — heavy' : '')
    sceneSel.appendChild(o)
  }
  const syncNote = () => { sceneNote.textContent = SCENES[sceneSel.value].note }
  sceneSel.addEventListener('change', syncNote)
  syncNote()

  const libs = $('lab-libs')
  for (const name of Object.keys(ADAPTERS)) {
    const id = 'lib-' + name.replace(/\W+/g, '')
    const label = document.createElement('label')
    label.className = 'lab-lib'
    label.innerHTML = `<input type="checkbox" id="${id}" value="${name}"${DEFAULT_ON.includes(name) ? ' checked' : ''}${name === SNAP ? ' disabled' : ''}> ${name}`
    libs.appendChild(label)
  }
  // SnapDOM's checkbox is disabled — it is always in the comparison. `:checked` still matches
  // a disabled-but-checked input, so selectedLibs() picks it up.
  $('lib-' + SNAP.replace(/\W+/g, '')).checked = true

  const capHead = $('cap-head')
  capHead.innerHTML = '<th>Library</th>' + CAPS.map((c) => `<th>${CAP_LABELS[c]}</th>`).join('') + '<th>first capture</th>'

  runBtn.addEventListener('click', run)
  $('lab-copy').addEventListener('click', copyResults)
  $('cap-run').addEventListener('click', runMatrix)
  say('Pick a scene and hit run.')
}

boot()
