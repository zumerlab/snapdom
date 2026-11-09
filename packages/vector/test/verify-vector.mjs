/**
 * Assertive regression suite for the VECTOR path.
 *
 * `test/verify.mjs` is the model: every check here is hard. A failure sets
 * `process.exitCode = 1` and is repeated in the final summary. Nothing in this file
 * is informational except the `--url=` mode, which is explicitly exploratory and
 * says so.
 *
 *   node test/verify-vector.mjs                     every fixture of both demos
 *   node test/verify-vector.mjs --only=fx-card      one (substring of `page/fixture`)
 *   node test/verify-vector.mjs --update            rewrite test/vector-baselines.json
 *   node test/verify-vector.mjs --url=https://…     one real page, no baseline, never fails
 *
 * ## Why it discovers fixtures instead of listing them
 *
 * The demos own the fixture list. `demo/vector.html` and `demo/figma.html` each drive
 * a `<select>` whose options ARE the cases, and both toggle `.fx`/`.fx.on` to show one
 * at a time. Reading the `<select>` means a fixture added to a demo joins this suite
 * on the next run with nobody editing this file — which is the only way a suite stays
 * honest about a surface that is still growing. Every harness that came before
 * (`_vharness.mjs`, `_figcheck.mjs`) hardcoded five names and silently stopped
 * covering the sixth.
 *
 * ## Why it captures itself instead of pressing the demo's button
 *
 * The two demos disagree about what a capture is: `vector.html` keeps a rich `result`
 * on `window.__vector`, `figma.html` puts the SVG on the CLIPBOARD and exposes only a
 * drift reader. Driving both through one in-page capture (`CAPTURE` below, which
 * imports the same modules through the same import map the demos declare) gives one
 * comparable set of numbers per fixture, and leaves the demo's own DOM untouched —
 * which is what makes the leak check (#9) mean anything.
 *
 * ## The assertions, and which one is load-bearing
 *
 *  1. clean capture — zero console errors, page errors, unhandled rejections
 *  2. `validate()` says ok, and the SVG contains zero `foreignObject`
 *  3. the SVG parses under a STRICT XML parser (`DOMParser`, `application/xml`)
 * 3b. no element carries the same attribute twice, scanned off the raw text
 *  4. clone drift median === 0 and max under a floor
 *  5. every non-`E` node names a diagnostic, and the SET of diagnostic codes is in
 *     the baseline — a new code is a new degradation and needs a human
 * 5b. **the emitted text reconstructs the live element's text** — the measured lines
 *     cover every character of their block, what the block paints is a string the
 *     page really says, and every visible live text node survives into some block
 *  6. **pixel diff of the emitted SVG against a screenshot of the LIVE element** —
 *     whole-box mean, whole-box fraction over 16/255, AND the worst 32×32px tile
 *  7. node count and nodeRatio against baseline
 * 7b. SVG byte count (±10%) and the node grade histogram (exact)
 *  8. the Figma payload survives the real plugin's `readPayload`
 *  9. 20 captures in a row leave the document exactly as they found it
 * 10. per-capture time against baseline, ×2.5
 *
 * (5b) is the newest and the one with the worst failure to prevent. Every other
 * assertion here is about a picture being wrong; this one is about the picture being
 * of the wrong TEXT — a word broken where the page does not break it, a character
 * dropped at a line end, a counter that says `2.3` where the page says `2.1`. Ugly is
 * survivable and wrong content is not, so it is checked structurally (offsets) and
 * against the DOM (strings), in both directions.
 *
 * (3b) is XML well-formedness the strict parse above already rejects — measured:
 * `DOMParser` with `application/xml` does report a duplicate attribute. It is scanned
 * separately anyway because the failure it guards against cost two rounds to find, and
 * a `parsererror` says a line and a column while the scan says which element and which
 * attribute. It also survives the parse check ever being loosened.
 *
 * (6) is the only one that contrasts against reality. Everything above it describes
 * the document the engine produced; only the pixel diff can say the document is a
 * picture of the page. It is also the reason the baselines carry provenance: a
 * threshold calibrated on one machine's font rasteriser is noise on another's.
 *
 * But (6) is weaker than it looks, and (7b) exists because of it. A pixel comparison
 * against the live element is an AVERAGE over a box, and the engine's ambient
 * disagreement with Chromium's rasteriser (worst tile ~15/255 on a clean fixture) is
 * larger than a lot of real damage. Cutting `CONIC_WEDGES` from 128 to 12 turns
 * fx-card's gradient disc into a visibly banded pie and every pixel assertion stays
 * green — the mean even IMPROVES, 1.616 → 1.570, because the coarse fan stops
 * overdrawing its own seams. `svgBytes` catches it (24436 → 13094). Keep both: the
 * pixel checks catch misregistration (a 0.5px rounding break fails 13 checks across 6
 * fixtures), the cheap structural ones catch an emitter that quietly got cheaper.
 *
 * ## What could not be reused
 *
 * `verify.mjs` is a script, not a module: `check`, `near`, `fmt`, `standard` and
 * `shot` are module-scope `const`s in a file whose top level launches Chromium,
 * starts a server and runs the raster suite. Importing any of them would run that
 * suite as a side effect. `check`/`near`/`fmt` are re-stated here (a dozen lines) with
 * the same semantics and the same output format; `standard`/`shot` are PDF-specific
 * and have no vector counterpart. `test/_figcheck.mjs`'s vm sandbox IS reused in
 * spirit — `loadPlugin` below is the same technique, cut down to what `readPayload`
 * needs, because that file is also a script with no exports.
 *
 * Artifacts land in `out/vector-verify/`: `<page>-<fixture>.svg`, `.live.png`,
 * `.emitted.png` and `.diff.png` (the amplified difference). `verify.mjs` clears only
 * the FILES in `out/`, never its subdirectories, so these survive a raster run.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { serve, snapdomBuildProblem } from './serve.mjs'
import { loadChromium } from './harness.mjs'
import { svdToFigma } from '../src/emit/figma-json.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out', 'vector-verify')

/** Where `--url` captures of pages nobody wrote for us go. Never baselined. */
const WILD_OUT = path.join(ROOT, 'out', 'vector', 'wild')
const BASELINE_FILE = path.join(ROOT, 'test', 'vector-baselines.json')

// The one thing genuinely shared with the raster suite: resolving Playwright
// (devDependency first, sibling checkout as the fallback). It was an inline copy of
// harness.mjs's `loadChromium` body; two copies of a module-resolution fallback is
// how one suite starts finding a different browser than the other.
//
// The REPORTER deliberately stays private (see `makeReporter`) — harness.mjs's is a
// flat `results[]` with a fixed 2-decimal `fmt`, and this suite needs per-case
// nesting plus a `fmt` that keeps 0.019 apart from 0.043. Sharing it would round the
// pixel-diff details into uselessness and drop `runVector`'s reentrancy.
const chromium = await loadChromium(ROOT)

/**
 * The pages this suite walks. `select` is where the fixture list lives and `target`
 * says which element a fixture id names: `vector.html` vectorises the `.fx` box
 * itself, the other two vectorise its first child (the card inside the stage).
 * Getting this wrong is invisible in the SVD and glaring in the pixel diff.
 *
 * `target` is named after the DOM property that resolves it — `self` or
 * `firstElementChild` — because the value it used to carry, `firstChild`, names a
 * DIFFERENT property (`Node.firstChild` is the whitespace text node before the card)
 * and reading the table was the only way to know it did not mean that one.
 *
 * `challenges` is the ten deliberately-hostile fixtures. It was outside the suite
 * until now, which is why a week of fixes to them — sup/sub, the wavy underline, the
 * hyphenation glyph, small-caps, `-webkit-text-stroke`, inline SVG, CSS counters —
 * had no test defending any of it.
 */
const PAGES = [
  { id: 'vector', url: '/demo/vector.html', select: '#fixture', target: 'self' },
  { id: 'figma', url: '/demo/figma.html', select: '#fx', target: 'firstElementChild' },
  { id: 'challenges', url: '/demo/challenges.html', select: '#fx', target: 'firstElementChild' },
]

/** Everything runs at 1×: a CSS px must be a device px or the diff compares grids. */
const VIEWPORT = { width: 1440, height: 1000 }

/**
 * Where the engine appears to live when it is injected into somebody else's page.
 *
 * `--url` mode has to run the engine inside a document served from an origin that is
 * not ours, and a cross-origin ES module import needs CORS headers `serve.mjs` does
 * not send. Rather than weaken the server (which every fixture also uses), the whole
 * tree is re-served under this path ON THE TARGET'S OWN ORIGIN through a Playwright
 * route, so the import is same-origin and no CORS question arises. The route proxies
 * `serve.mjs` instead of reading the disk itself — resolution and containment stay in
 * one place — and rewrites the two bare specifiers on the way past, because a bare
 * specifier needs an import map and an import map injected into a page that has
 * already run a module script is a hard error.
 */
const SHIM = '/__snapdom-vector-harness__/'

/** Bare specifier → same-origin URL under SHIM. Kept next to SHIM so they cannot drift. */
const SHIM_SPECIFIERS = [
  ['@zumer/snapdom', 'snapdom-v3/dist/snapdom.mjs'],
  ['@zumer/svd', 'svd/index.js'],
]

/** Captures per fixture in the leak loop. Also the sample the timing median comes from. */
const REPEATS = 20

/** Clone drift the mount is allowed at its worst. The median must be exactly 0. */
const DRIFT_MAX_PX = 1

/**
 * Edge of the square the worst-region pixel diff is measured over. 32px is chosen
 * against the defect it exists to catch: small enough that a ~85px gradient disc
 * contains several FULL tiles (so the defect owns a tile rather than being averaged
 * with its surroundings), large enough that one antialiased glyph edge cannot win the
 * maximum on its own. At 8px a single letter's stem is the worst tile on every
 * text-heavy fixture and the metric measures typography instead of damage.
 */
const TILE_PX = 32

// ——— assertions ————————————————————————————————————————————————
//
// Re-stated from verify.mjs rather than imported; see the header for why. Same
// signatures, same one-line output, but the state is per-run so `runVector` can be
// called twice in one process without the second run inheriting the first's tally.

/**
 * A fresh assertion recorder.
 * @param {{quiet?: boolean}} [options]
 * @returns {{check: Function, near: Function, cases: object[], open: Function,
 *            passed: number, failed: object[]}}
 */
function makeReporter ({ quiet = false } = {}) {
  const cases = []
  let current = null
  const log = (...a) => { if (!quiet) console.log(...a) }

  const api = {
    cases,
    /** Start a new case; every later check is filed under it. */
    open (name) {
      current = { name, checks: [], passed: 0, failed: 0 }
      cases.push(current)
      log(`\n── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}`)
      return current
    },
    /** @returns {boolean} the assertion's own truth, so callers can branch on it. */
    check (name, ok, detail = '') {
      const entry = { name, ok: !!ok, detail: String(detail) }
      if (!current) api.open('—')
      current.checks.push(entry)
      current[ok ? 'passed' : 'failed']++
      log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
      return !!ok
    },
    near (name, actual, expected, tol, unit = '') {
      const d = Math.abs(actual - expected)
      return api.check(name, d <= tol,
        `${fmt(actual)}${unit} vs ${fmt(expected)}±${fmt(tol)}${unit} (off ${fmt(d)})`)
    },
    /** At most `limit`; the message says what the limit came from. */
    atMost (name, actual, limit, unit = '', why = '') {
      const r = api.check(name, actual <= limit,
        `${fmt(actual)}${unit} vs ≤${fmt(limit)}${unit}${why ? ` (${why})` : ''}`)
      // El valor crudo, para que el trinquete del corpus no tenga que parsear la
      // cadena que se le muestra a una persona.
      const last = current && current.checks[current.checks.length - 1]
      if (last) last.value = actual
      return r
    },
  }
  return api
}

const fmt = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3).replace(/\.?0+$/, '')) : String(n))
const round = (n, p = 4) => Number.isFinite(n) ? Number(n.toFixed(p)) : n
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ——— in-page code —————————————————————————————————————————————

/**
 * One capture, inside the page, through the demo's own import map.
 *
 * `silent: true` suppresses the orchestrator's console printout on purpose: this
 * suite reads `doc.diagnostics` structurally, and letting the engine narrate every
 * approximation to `console.warn` would put the suite in the business of grepping
 * prose — exactly what the diagnostic `code` exists to avoid. It also keeps check #1
 * measuring real errors instead of the engine talking.
 *
 * The strict XML parse happens HERE because `DOMParser` is the strict parser we have
 * without adding a dependency: `application/xml` refuses what a lax consumer repairs
 * in silence, and reports the refusal as a `<parsererror>` element in the result.
 *
 * @param {{id: string, target: string, mode?: string}} a
 */
const CAPTURE = async (a) => {
  const [snapdomMod, vector, svgFlat, figmaJson, svd] = await Promise.all([
    import('@zumer/snapdom'),
    import('@zumer/snapdom-vector'),
    import('@zumer/snapdom-vector/emit/svg-flat.js'),
    import('@zumer/snapdom-vector/emit/figma-json.js'),
    import('@zumer/svd'),
  ])
  const snapdom = snapdomMod.snapdom
  const vectorPlugin = vector.vector || vector.default
  const svdToSvg = svgFlat.svdToSvg || svgFlat.default
  const toFigma = figmaJson.svdToFigma || figmaJson.default

  const host = document.getElementById(a.id)
  if (!host) return { error: `no element #${a.id} on this page` }
  for (const fx of document.querySelectorAll('.fx')) fx.classList.toggle('on', fx.id === a.id)
  const el = a.target === 'self' ? host : host.firstElementChild
  if (!el) return { error: `#${a.id} has no first element child to vectorise` }
  await document.fonts.ready

  const t0 = performance.now()
  let doc, emitted
  try {
    // The engine is a snapdom plugin: it is registered on a capture and the capture
    // publishes `toVector()`. `burst` is deliberately left unset — the plugin declares
    // render hooks and is not `pure`, which suspends auto-burst; forcing `burst: true`
    // would serve a memoized URL without re-entering captureDOM and the export would
    // find no clone.
    const captured = await snapdom(el, {
      plugins: [vectorPlugin({ mode: a.mode || 'design', silent: true })],
    })
    doc = await captured.toVector()
    emitted = svdToSvg(doc)
  } catch (err) {
    return { error: `${err && err.name}: ${err && err.message}`, stack: String(err && err.stack || '') }
  }
  const ms = performance.now() - t0
  const svg = typeof emitted === 'string' ? emitted : emitted.svg
  const svgDiagnostics = (emitted && emitted.diagnostics) || []

  // Strict, not tolerant. `text/html` would repair a mismatched tag and report
  // nothing; `application/xml` is the parser a real consumer's toolchain uses.
  const xml = new DOMParser().parseFromString(svg, 'application/xml')
  const perr = xml.querySelector('parsererror')

  // Every non-E node must be named by a diagnostic. `validate()` checks this too;
  // it is restated here so a schema that stops checking it is visible as a failure
  // rather than as a suite that quietly got weaker.
  const all = [...(doc.diagnostics || []), ...svgDiagnostics]
  const named = new Set(all.map((d) => d && d.node).filter(Boolean))
  const undeclared = []
  const grades = {}
  for (const [id, node] of Object.entries(doc.nodes || {})) {
    const g = (node && node.fidelity && node.fidelity.grade) || 'E'
    grades[g] = (grades[g] || 0) + 1
    if (g !== 'E' && !named.has(id)) undeclared.push(`${id} (${g}, ${(node.name || node.type || '?')})`)
  }

  let figmaNodes = 0
  let figmaTranslationErrors = []
  try {
    const payload = toFigma(doc)
    figmaNodes = Object.keys(payload.nodes || {}).length
    figmaTranslationErrors = (payload.diagnostics || [])
      .filter((d) => d && d.severity === 'error').map((d) => d.code || d.message)
  } catch (err) {
    figmaTranslationErrors = [`svdToFigma threw: ${err && err.message}`]
  }

  // The live side of the text audit (`auditText`, in Node). Collected HERE because
  // the audit needs the page's own text nodes and `node.el` is nulled the moment
  // `toVector` returns — by the time the document reaches Node there is no DOM left
  // to ask. Only what the page PAINTS counts: a node inside a `<select>` is the
  // widget's own content, which this engine declares (`collect.box.form-control`)
  // instead of drawing, and `checkVisibility` drops what the page does not show.
  const SKIP_TEXT = /^(SELECT|OPTION|OPTGROUP|TEXTAREA|SCRIPT|STYLE|TEMPLATE|NOSCRIPT|TITLE)$/
  const liveTextNodes = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue
    let skip = false
    for (let p = n.parentElement; p && p !== el.parentElement; p = p.parentElement) {
      if (SKIP_TEXT.test(p.tagName)) { skip = true; break }
      if (typeof p.checkVisibility === 'function' &&
          !p.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) { skip = true; break }
    }
    if (skip) continue
    liveTextNodes.push({
      text: n.nodeValue,
      tag: n.parentElement ? n.parentElement.tagName.toLowerCase() : '?',
    })
  }

  const r = el.getBoundingClientRect()
  const wh = /<svg[^>]*\swidth="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)
  return {
    ms,
    svg,
    liveTextNodes,
    svd: JSON.stringify(doc),
    nodes: Object.keys(doc.nodes || {}).length,
    report: doc.report || {},
    schema: svd.validate(doc),
    grades,
    undeclared,
    codes: [...new Set(all.map((d) => d && d.code).filter(Boolean))].sort(),
    severities: all.reduce((acc, d) => {
      const s = (d && d.severity) || 'info'
      acc[s] = (acc[s] || 0) + 1
      return acc
    }, {}),
    foreignObject: xml.getElementsByTagName('foreignObject').length +
      (xml.documentElement ? xml.documentElement.getElementsByTagNameNS('*', 'foreignObject').length : 0),
    xmlOk: !perr,
    xmlError: perr ? perr.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
    figmaNodes,
    figmaTranslationErrors,
    live: { w: r.width, h: r.height },
    svgBox: wh ? { w: Number(wh[1]), h: Number(wh[2]) } : null,
  }
}

/**
 * What the document looks like when nothing is mid-capture. The adapter mounts the
 * clone under a `position:fixed;left:-99999px` host and injects one `<style>` into
 * the head, and removes both in a `finally` — so an aborted or leaking capture shows
 * up as an element count that never comes back down. Counting `*` catches the host
 * AND everything under it, which is the whole subtree the clone duplicates.
 *
 * `formState` is here because counting nodes missed a whole class of damage. Mounting
 * the clone put copies of the page's radios into the page's own radio groups, and the
 * browser unchecked the LIVE radio to keep one checked per group: measured on
 * `challenges/fx-form`, `fo-scale` went from checked to unchecked after one capture and
 * every count above was identical. `checked`, `value` and `indeterminate` are IDL state
 * that no attribute mirrors, so nothing but reading them can see it.
 */
const SIGNATURE = () => ({
  elements: document.getElementsByTagName('*').length,
  styles: document.querySelectorAll('style').length,
  headStyles: document.head.querySelectorAll('style').length,
  links: document.head.querySelectorAll('link').length,
  offscreen: [...document.body.children]
    .filter((n) => /left:\s*-\d{4,}px/.test(n.getAttribute('style') || '')).length,
  canvases: document.querySelectorAll('canvas').length,
  images: document.querySelectorAll('img').length,
})

/**
 * Every form control's IDL state, in document order. Its own function, evaluated in
 * its own round trip, because it is read at two different moments: around the
 * 20-capture loop (accumulation) and around the FIRST capture (damage that is done
 * once and then stays done). It cannot be called from inside `SIGNATURE` — a function
 * handed to `page.evaluate` travels as source and closes over nothing.
 */
const FORM_STATE = () => [...document.querySelectorAll('input, select, textarea')]
  .map((el, i) => `${i}:${el.type}:${el.checked ? 1 : 0}:${el.indeterminate ? 1 : 0}:${el.value}`)
  .join('|')

/**
 * The leak signature plus the form state, as one object.
 * @param {import('playwright').Page} page
 */
async function signatureOf (page) {
  return { ...await page.evaluate(SIGNATURE), formState: await page.evaluate(FORM_STATE) }
}

/**
 * `n` captures back to back, timed. One loop serves two assertions: the document
 * signature either survives it (#9) or it does not, and the times it collects are a
 * 20-sample median instead of one noisy stopwatch reading (#10).
 * @param {{id: string, target: string, n: number}} a
 */
const LOOP = async (a) => {
  const snapdomMod = await import('@zumer/snapdom')
  const vector = await import('@zumer/snapdom-vector')
  const svgFlat = await import('@zumer/snapdom-vector/emit/svg-flat.js')
  const snapdom = snapdomMod.snapdom
  const vectorPlugin = vector.vector || vector.default
  const svdToSvg = svgFlat.svdToSvg || svgFlat.default
  const host = document.getElementById(a.id)
  const el = a.target === 'self' ? host : host.firstElementChild
  const times = []
  let bytes = 0
  // Back-to-back captures are also the burst assertion: a plugin with render hooks
  // and no `pure` flag must keep every one of these re-entering captureDOM. When
  // that guarantee was missing the third iteration onwards came back memoized and
  // the export threw for want of a clone, so a green loop here is load-bearing.
  for (let i = 0; i < a.n; i++) {
    const t0 = performance.now()
    const captured = await snapdom(el, {
      plugins: [vectorPlugin({ mode: 'design', silent: true })],
    })
    const doc = await captured.toVector()
    const emitted = svdToSvg(doc)
    times.push(performance.now() - t0)
    bytes = (typeof emitted === 'string' ? emitted : emitted.svg).length
  }
  return { times, bytes }
}

/**
 * The pixel diff, entirely inside a canvas so no image codec has to be added.
 *
 * Both images are composited onto WHITE at the union box's origin — the SVG's
 * viewBox starts at 0,0 of the capture root and the element screenshot starts at the
 * element's own top-left, so they share an origin and only the extents can differ.
 * Compositing over white rather than comparing alpha is deliberate: the live shot has
 * no alpha channel to compare against, and "what a viewer sees on a white page" is
 * the claim the SVG actually makes.
 *
 * Three numbers come back, and the third exists because the first two lied. `diffMean`
 * and `diffBad` are whole-box statistics, so a defect that ruins a SMALL region is
 * divided by the whole box before it is compared to anything: cutting `CONIC_WEDGES`
 * from 128 to 12 turns `fx-card`'s gradient disc into a visibly banded pie chart and
 * moves `diffMean` from 1.616 to 1.570 — the wrong way, because the coarser fan also
 * stops overdrawing its own antialiasing seams. The suite was green on a defect a
 * human sees instantly. `diffWorstTile` is the mean of the worst TILE_PX×TILE_PX tile,
 * which is the same measurement at a scale a local defect cannot hide inside.
 *
 * @param {{live: string, emitted: string, w: number, h: number, tile: number}} a base64 PNGs
 */
const DIFF = async (a) => {
  const load = async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    return img
  }
  const draw = (img, w, h) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0)
    return ctx
  }
  const w = Math.max(1, Math.round(a.w))
  const h = Math.max(1, Math.round(a.h))
  const A = draw(await load(a.live), w, h).getImageData(0, 0, w, h).data
  const B = draw(await load(a.emitted), w, h).getImageData(0, 0, w, h).data

  const out = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const octx = out.getContext('2d')
  const img = octx.createImageData(w, h)
  let sum = 0
  let bad = 0
  // Per-tile accumulators, row-major over ceil(w/tile) × ceil(h/tile).
  const tile = Math.max(1, a.tile | 0)
  const tx = Math.ceil(w / tile)
  const ty = Math.ceil(h / tile)
  const tSum = new Float64Array(tx * ty)
  const tCount = new Float64Array(tx * ty)
  for (let i = 0; i < A.length; i += 4) {
    const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3
    sum += d
    if (d > 16) bad++
    const p = i >> 2
    const t = ((p / w | 0) / tile | 0) * tx + ((p % w) / tile | 0)
    tSum[t] += d
    tCount[t]++
    // Amplified so a 3-unit antialiasing halo is visible next to a 200-unit hole:
    // the artifact exists to be LOOKED at, and an unamplified diff is a black square.
    const v = Math.min(255, d * 4)
    img.data[i] = 255
    img.data[i + 1] = 255 - v
    img.data[i + 2] = 255 - v
    img.data[i + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  const n = A.length / 4

  // Only tiles that are FULL are eligible. A partial edge tile is a smaller sample
  // whose mean is noisier, and the right edge of a box is where a half-pixel of
  // rounding disagreement lives — letting those win the max would make the metric
  // report the box's edge instead of the worst region of the picture.
  let worst = 0
  let worstAt = null
  const full = tile * tile
  for (let t = 0; t < tSum.length; t++) {
    if (tCount[t] !== full) continue
    const m = tSum[t] / tCount[t]
    if (m > worst) { worst = m; worstAt = { x: (t % tx) * tile, y: (t / tx | 0) * tile } }
  }
  return {
    diffMean: sum / n,
    diffBad: bad / n,
    diffWorstTile: worst,
    worstTileAt: worstAt,
    tile,
    pixels: n,
    png: out.toDataURL('image/png').split(',')[1],
  }
}

/**
 * Pick the most interesting element on a page nobody wrote for us: the largest
 * visible block that is not the page itself. Bounded above so it cannot select
 * `<body>` or a full-bleed wrapper (which would make the run a screenshot test of the
 * whole site) and below so it cannot select a button. Deterministic: ties break on
 * document order, so two runs of the same page choose the same element.
 */
const PICK = (a) => {
  if (a.selector) {
    const el = document.querySelector(a.selector)
    return el ? { selector: a.selector, found: true } : { selector: a.selector, found: false }
  }
  const vw = innerWidth * innerHeight
  let best = null
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    const area = r.width * r.height
    if (r.width < 200 || r.height < 150) continue
    if (area < vw * 0.04 || area > vw * 0.75) continue
    if (r.top > innerHeight * 2) continue
    if (el.querySelectorAll('*').length < 3) continue
    if (!best || area > best.area) best = { el, area }
  }
  const el = best ? best.el : document.body
  // A stable, re-findable address for the element we chose, so the report names
  // something the reader can paste back in as `--selector=`.
  const path = []
  for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
    let seg = n.tagName.toLowerCase()
    if (n.id) { path.unshift(`#${CSS.escape(n.id)}`); break }
    const sibs = [...(n.parentElement ? n.parentElement.children : [])].filter((c) => c.tagName === n.tagName)
    if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(n) + 1})`
    path.unshift(seg)
  }
  el.setAttribute('data-verify-vector-target', '1')
  return { selector: path.join(' > '), found: true, marked: true }
}

// ——— markup and text audits ——————————————————————————————————
//
// Both are pure functions over what the capture returned, so they run in Node where
// they can be read and exercised, and `checkDetectors` below plants a defect in each
// on every run — a detector nobody ever sees fire is indistinguishable from one that
// returns [] no matter what it is given.

/**
 * Every attribute name an element carries more than once, scanned off the RAW SVG.
 *
 * Duplicate attributes are not a cosmetic problem: they make the file invalid XML and
 * Figma then pastes NOTHING — not a degraded version of the card, nothing at all. It
 * happened, and it took two rounds to find because the symptom is silence.
 *
 * The scan consumes whole `name="value"` pairs rather than looking for `=` signs,
 * because half the attributes in a real capture are base64 data URLs full of `=`
 * padding and `<`/`>` inside quotes; a regex over `=` reports a fill's payload as a
 * duplicated attribute and cries wolf on every fixture with an image. Comments,
 * CDATA sections and processing instructions are skipped whole for the same reason.
 *
 * @param {string} svg the emitted document, as text
 * @returns {{tag: string, attr: string, count: number, at: number}[]} one entry per
 *   repeated name per element, in document order
 */
export function duplicateAttributes (svg) {
  const found = []
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
  let i = 0
  while (i < svg.length) {
    const lt = svg.indexOf('<', i)
    if (lt < 0) break
    if (svg.startsWith('<!--', lt)) { const e = svg.indexOf('-->', lt); i = e < 0 ? svg.length : e + 3; continue }
    if (svg.startsWith('<![CDATA[', lt)) { const e = svg.indexOf(']]>', lt); i = e < 0 ? svg.length : e + 3; continue }
    const c = svg[lt + 1]
    if (c === '!' || c === '?' || c === '/') { const e = svg.indexOf('>', lt); i = e < 0 ? svg.length : e + 1; continue }
    if (!/[A-Za-z_]/.test(c || '')) { i = lt + 1; continue }

    let j = lt + 1
    while (j < svg.length && !isSpace(svg[j]) && svg[j] !== '>' && svg[j] !== '/') j++
    const tag = svg.slice(lt + 1, j)
    const seen = new Map()
    while (j < svg.length) {
      while (j < svg.length && isSpace(svg[j])) j++
      const ch = svg[j]
      if (ch === undefined || ch === '>') { j++; break }
      if (ch === '/') { j++; continue }
      const nameAt = j
      while (j < svg.length && !isSpace(svg[j]) && svg[j] !== '=' && svg[j] !== '>' && svg[j] !== '/') j++
      const name = svg.slice(nameAt, j)
      while (j < svg.length && isSpace(svg[j])) j++
      if (svg[j] === '=') {
        j++
        while (j < svg.length && isSpace(svg[j])) j++
        const q = svg[j]
        if (q === '"' || q === "'") {
          const close = svg.indexOf(q, j + 1)
          // An unterminated value means the document is broken in a way this scan
          // cannot reason about; the strict XML parse owns that verdict.
          if (close < 0) { j = svg.length; break }
          j = close + 1
        } else {
          while (j < svg.length && !isSpace(svg[j]) && svg[j] !== '>') j++
        }
      }
      if (!name) continue
      seen.set(name, (seen.get(name) || 0) + 1)
    }
    for (const [attr, count] of seen) {
      if (count > 1) found.push({ tag, attr, count, at: lt })
    }
    i = j
  }
  return found
}

/**
 * Every character that carries meaning, with the whitespace collapse both sides share.
 * A visual line break is not a character of the document — the emitter starts a new
 * line where the browser did, and on the DOM's side the same break is a space, or
 * nothing at all, or a U+2028 the collector baked in — so the only comparison that
 * says anything about CONTENT is one with every space removed from both strings.
 */
const normText = (s) => String(s || '').replace(/[\s\u00a0\u2028\u2029\u200b\ufeff]+/g, '')

/**
 * Case-folded too, because `text-transform` legitimately makes the painted string
 * differ from the DOM's (`Nuevo` → `NUEVO`). Folding is the price: a capture that
 * changed only the CASE of a word would pass this audit. `sourceText` records the
 * pre-transform string and a future revision could compare that instead, per block.
 */
const foldText = (s) => normText(s).toUpperCase()

/**
 * Does the text the document paints reconstruct the text the page shows?
 *
 * Three questions, because content can be corrupted in three different places:
 *
 *  A. **the lines cover their block.** Every `line` is a pair of offsets into
 *     `text.characters`, and the emitter paints exactly `characters.slice(start,end)`
 *     per line. If a line's range drops or repeats a character, the picture reads as
 *     a typo and nothing else in this suite notices. Whitespace between lines is the
 *     break itself and is allowed; anything else is a character that was measured and
 *     will never be painted. `line.hyphen` is deliberately NOT added back: it is the
 *     glyph the browser draws at a hyphenation break, the document does not contain
 *     it, and the whole point of the field is that it lives outside `characters`.
 *
 *  B. **what a block paints, the page says.** The concatenation of a block's lines
 *     must appear, contiguously, in the live element's text. Generated content is the
 *     one exception and it is admitted structurally, not by name: `::before`,
 *     `::after` and `::marker` each arrive as ONE run at the start or the end of the
 *     block (measured: `«`/`»` around a blockquote, `v3.2 · ` from an `attr()`,
 *     `1.1 ` from a counter), so at most one run may be trimmed from each end, and
 *     what remains must still be non-empty unless the whole node is a pseudo. The
 *     cost of that allowance, stated plainly: a corruption confined to a block's
 *     first or last run is invisible here, because that is exactly the shape
 *     generated content has and `textContent` cannot tell them apart.
 *
 *  C. **nothing the page shows was dropped.** Every visible live text node must
 *     survive into some block. The allowance is `report.coverage.iconFont`, which the
 *     engine counts itself: snapdom turns an icon-font ligature into an `<img>` with
 *     a baked data URL, so `content_copy` stops being text on purpose. It is an
 *     upper bound taken from the document, not a number invented here.
 *
 * @param {object} doc an SVD document
 * @param {{text: string, tag: string}[]} liveNodes visible live text nodes, in order
 * @param {number} iconFont `report.coverage.iconFont`
 * @returns {{blocks: number, uncovered: string[], notOnPage: string[],
 *            unpainted: string[], generated: number}}
 */
export function auditText (doc, liveNodes, iconFont = 0) {
  const uncovered = []
  const notOnPage = []
  const unpainted = []
  let generated = 0

  const live = foldText((liveNodes || []).map((n) => n.text).join(''))
  const blocks = []
  for (const [id, node] of Object.entries(doc.nodes || {})) {
    const t = node && node.text
    if (!t || !Array.isArray(t.lines) || typeof t.characters !== 'string') continue
    const name = node.name || id

    // A — coverage. The gaps are the line breaks, and a break is whitespace.
    const chars = t.characters
    let cursor = 0
    const painted = []
    for (const line of t.lines) {
      const gap = chars.slice(cursor, line.start)
      if (normText(gap)) {
        uncovered.push(`${id} ${JSON.stringify(name)}: ${JSON.stringify(gap.slice(0, 24))} sits between the ` +
          `measured lines and no line paints it`)
      }
      painted.push([line.start, line.end])
      cursor = Math.max(cursor, line.end)
    }
    const tail = chars.slice(cursor)
    if (normText(tail)) {
      uncovered.push(`${id} ${JSON.stringify(name)}: ${JSON.stringify(tail.slice(0, 24))} is past the last ` +
        'measured line and will never be painted')
    }

    // B — the page says it. `slice` over the painted ranges, so a line's offsets are
    // what is compared and not `characters`, which no consumer reads directly.
    const paint = (from, to) => painted
      .map(([s, e]) => chars.slice(Math.max(s, from), Math.min(e, to)))
      .join('')
    const runs = Array.isArray(t.runs) ? t.runs : []
    const full = foldText(paint(0, chars.length))
    blocks.push({ id, name, full })
    if (full && !live.includes(full)) {
      const head = runs.length > 1 ? runs[0].end : 0
      const tailAt = runs.length > 1 ? runs[runs.length - 1].start : chars.length
      const trimmed = [
        foldText(paint(head, chars.length)),
        foldText(paint(0, tailAt)),
        foldText(paint(head, tailAt)),
      ].filter((s) => s && live.includes(s))
      if (trimmed.length) generated++
      else if (node.source && node.source.pseudo) generated++
      else {
        notOnPage.push(`${id} ${JSON.stringify(name)} paints ${JSON.stringify(full.slice(0, 60))}, ` +
          'which the live element does not say')
      }
    }
  }

  // C — nothing dropped.
  for (const n of liveNodes || []) {
    const want = foldText(n.text)
    if (!want) continue
    if (!blocks.some((b) => b.full.includes(want))) {
      unpainted.push(`<${n.tag}> ${JSON.stringify(normText(n.text).slice(0, 48))} reached no text block`)
    }
  }
  return { blocks: blocks.length, uncovered, notOnPage, unpainted, generated, iconFont: iconFont || 0 }
}

/**
 * Take one painted character out of a real document, so the audit above can be shown
 * to notice. The character removed is the last of some line and is not whitespace, so
 * after the edit it sits in the gap between two lines — measured, and painted by
 * nobody, which is question A's exact failure.
 *
 * @param {object} doc an SVD document (not mutated)
 * @returns {{doc: object, what: string}|null} null when no line offers such a character
 */
export function plantTextDefect (doc) {
  for (const [id, node] of Object.entries(doc.nodes || {})) {
    const t = node && node.text
    if (!t || !Array.isArray(t.lines) || typeof t.characters !== 'string') continue
    for (let i = 0; i < t.lines.length; i++) {
      const line = t.lines[i]
      if (!(line.end - line.start >= 2)) continue
      const ch = t.characters[line.end - 1]
      if (!normText(ch)) continue
      const copy = structuredClone(doc)
      copy.nodes[id].text.lines[i].end -= 1
      return { doc: copy, what: `${id} line ${i} loses ${JSON.stringify(ch)}` }
    }
  }
  return null
}

/**
 * The detectors, against defects planted on purpose. It runs before any fixture does,
 * costs microseconds, and answers the question every green check invites: would this
 * have gone red if the thing it names were actually wrong?
 *
 * @param {ReturnType<makeReporter>} reporter
 */
function checkDetectors (reporter) {
  const { check } = reporter
  reporter.open('detectors (planted defects)')

  const clean = '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0=" ' +
    'width="4" height="4"/><path d="M0 0h4v4z" data-note="a &gt; b = c"/></svg>'
  check('the duplicate-attribute scan passes a clean document',
    duplicateAttributes(clean).length === 0,
    duplicateAttributes(clean).map((d) => `${d.tag}/${d.attr}`).join(', '))

  // The negative control that matters: `=` padding in base64 and a `>` inside a
  // quoted value are what a naive scan reports as duplicates on every real capture.
  const planted = clean.replace('<path d="M0 0h4v4z"', '<path d="M0 0h4v4z" d="M1 1h2v2z"')
  const hit = duplicateAttributes(planted)
  check('the duplicate-attribute scan finds a planted duplicate',
    hit.length === 1 && hit[0].tag === 'path' && hit[0].attr === 'd' && hit[0].count === 2,
    hit.map((d) => `<${d.tag}> ${d.count}× ${d.attr}`).join(', ') || 'nothing found')

  const doc = {
    nodes: {
      n_1: {
        name: 'p',
        text: { characters: 'hola mundo', lines: [{ start: 0, end: 10 }], runs: [{ start: 0, end: 10 }] },
      },
    },
  }
  const live = [{ text: 'hola mundo', tag: 'p' }]
  const ok = auditText(doc, live)
  check('the text audit passes a document that says what the page says',
    ok.uncovered.length === 0 && ok.notOnPage.length === 0 && ok.unpainted.length === 0,
    `${ok.uncovered.length} uncovered, ${ok.notOnPage.length} not on page, ${ok.unpainted.length} unpainted`)

  const invented = structuredClone(doc)
  invented.nodes.n_1.text.characters = 'hola mundos'
  invented.nodes.n_1.text.lines = [{ start: 0, end: 11 }]
  invented.nodes.n_1.text.runs = [{ start: 0, end: 11 }]
  check('the text audit catches a character the page never said',
    auditText(invented, live).notOnPage.length === 1, '')

  check('the text audit catches a live text node that reached no block',
    auditText(doc, [...live, { text: 'perdido', tag: 'span' }]).unpainted.length === 1, '')

  const short = plantTextDefect(doc)
  check('the text audit catches a planted one-character loss',
    !!short && auditText(short.doc, live).uncovered.length === 1, short ? short.what : 'could not plant')
}

// ——— the figma plugin, in a vm ————————————————————————————————
//
// Same technique as test/_figcheck.mjs (which is a script and exports nothing), cut
// down to what `readPayload` needs. The point is unchanged: the REAL
// figma-plugin/code.js, not a copy of its validation logic — the bug that
// mattered was the plugin rejecting the engine's own payload, and only the real file
// can reproduce it.

let pluginSource = null

/**
 * Load `figma-plugin/code.js` as the sandbox does — a classic script, no modules —
 * against a Figma stub that provides only what the module's top level touches.
 * @returns {vm.Context} the plugin's globals, `readPayload` among them
 */
function loadPlugin () {
  if (pluginSource === null) {
    pluginSource = fs.readFileSync(path.join(ROOT, 'figma-plugin/code.js'), 'utf8')
  }
  const figma = {
    skipInvisibleInstanceChildren: false,
    currentPage: { children: [] },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView () {} },
    ui: { postMessage () {}, onmessage: null },
    showUI () {},
    notify () {},
    closePlugin () {},
    base64Decode: (b64) => new Uint8Array(Buffer.from(b64, 'base64')),
  }
  const sandbox = {
    figma,
    __html__: '<html></html>',
    console: { log () {}, warn () {}, error () {} },
    setTimeout, clearTimeout, Promise, Uint8Array, Array, Object, JSON, Math, String,
    Number, Boolean, Error, Set, Map, Intl, TextDecoder, TextEncoder, isNaN, parseFloat, parseInt,
  }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(pluginSource, ctx, { filename: 'figma-plugin/code.js' })
  return ctx
}

/**
 * `svdToFigma` in Node (it is pure by contract) and then the plugin's own reader.
 * @param {object} doc an SVD document
 * @returns {{ok: boolean, errors: string[], nodes: number, translationErrors: string[]}}
 */
function figmaAccepts (doc) {
  let payload
  try {
    payload = svdToFigma(doc)
  } catch (err) {
    return { ok: false, errors: [`svdToFigma threw: ${err.message}`], nodes: 0, translationErrors: [] }
  }
  const translationErrors = (payload.diagnostics || [])
    .filter((d) => d && d.severity === 'error')
    .map((d) => `${d.code || 'error'}: ${d.message || ''}`)
  const ctx = loadPlugin()
  // A structured clone, because the plugin mutates what it reads and a shared object
  // would let one fixture's repairs make the next one pass.
  const read = ctx.readPayload(JSON.parse(JSON.stringify(payload)))
  return {
    ok: !!read.ok,
    errors: read.errors || [],
    nodes: Object.keys(payload.nodes || {}).length,
    translationErrors,
  }
}

// ——— baselines ————————————————————————————————————————————————

const BASELINE_HEADER =
  'Measured values for test/verify-vector.mjs. Regenerate with `node test/verify-vector.mjs --update`. ' +
  'The diff thresholds are NOT invented: `diffLimit` is the measured `diffMean` with 40% + 0.6 of ' +
  'headroom, `diffBadLimit` the measured `diffBad` with 100% + 0.004, `diffTileLimit` the measured ' +
  '`diffTile` with 35% + 2, and `msLimit` is 2.5× the measured median (floor +5ms). ' +
  'Measured on the provenance machine over repeated quiet runs: diffMean, diffBad, diffTile, nodes, ' +
  'nodeRatio, grades and svgBytes are BIT-IDENTICAL run to run (sd = 0.000000 over 5 runs), so their ' +
  'headroom is not absorbing local noise — it is cross-machine font rasterisation, and nothing else. ' +
  '`ms` is the only metric that moves: sd ≤0.3ms quiet, and ×1.0–1.14 with the raster suite‘s own ' +
  'Chromium running alongside, which is why 2.5× is generous and the previous +30ms floor was not a ' +
  'threshold at all (it let a 7× regression on a 4ms fixture pass in silence). ' +
  '`diffTile` is the worst 32×32px tile and exists because `diffMean` is a whole-box average that ' +
  'divides local damage by the whole picture; neither one caught CONIC_WEDGES 128→12, `svgBytes` did. ' +
  '`codes` is the exact set of diagnostic codes the capture emitted: a code appearing or ' +
  'disappearing fails the suite until a human accepts it with --update, because a new code is a new ' +
  'degradation and a vanished one is a claim that something got better. `why` is the only field here ' +
  'a human writes; --update carries it over instead of overwriting it. See `_provenance` for where ' +
  'these numbers were taken — a threshold without provenance is noise a year from now.'

/**
 * `_acceptedRegressions` is the other thing in this file a human wrote and no run
 * measures: the record of a number that is WORSE on purpose, and why a person decided
 * that. It has to survive `--update` for the same reason `why` does — a rebaseline
 * that deletes the reason a render got worse turns a documented product decision back
 * into an unexplained number, and the next reader has no way to tell the two apart.
 * It was being dropped: `--update` rebuilt the file from `_comment`/`_provenance`/
 * `cases` and wrote nothing else.
 *
 * @returns {{_comment: string, _provenance: object, _acceptedRegressions: object|undefined, cases: object}}
 */
function readBaselines () {
  const empty = { _comment: BASELINE_HEADER, _provenance: {}, _acceptedRegressions: undefined, cases: {} }
  if (!fs.existsSync(BASELINE_FILE)) return empty
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    return {
      _comment: raw._comment || BASELINE_HEADER,
      _provenance: raw._provenance || {},
      _acceptedRegressions: raw._acceptedRegressions,
      cases: raw.cases || {},
    }
  } catch (err) {
    console.error(`[verify-vector] ${BASELINE_FILE} is not readable JSON (${err.message}); treating it as empty`)
    return empty
  }
}

/**
 * The machine a number came from. Without this the thresholds below are a year from
 * being unfalsifiable folklore.
 * @param {string} browserVersion
 */
function provenance (browserVersion) {
  const cpus = os.cpus()
  return {
    generatedAt: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus.length ? `${cpus[0].model} × ${cpus.length}` : 'unknown',
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    chromium: browserVersion,
    viewport: `${VIEWPORT.width}×${VIEWPORT.height} @1x`,
    note: 'Font rasterisation is platform-specific: the pixel-diff thresholds below travel ' +
      'across machines only as far as the font stack does. A CI box that fails only on ' +
      'diffMean has probably substituted a family, not regressed the engine.',
  }
}

/**
 * The tolerated ceiling for a measured value, with the margin stated in one place.
 *
 * `msLimit`'s floor was measured, not guessed. An earlier revision used `+30ms` on the
 * reasoning that the fixtures land near 5ms and a scheduling hiccup would break ×2 —
 * but the statistic is the MEDIAN of 20 warm captures, which is precisely the
 * statistic a single hiccup cannot move. Measured on the provenance machine: with all
 * 10 cores saturated the medians rose by under 10% (4.4→4.75, 12.2→12.7); with the
 * raster suite's own Chromium running concurrently — the realistic worst case in this
 * repo — they rose by ×1.24 to ×1.39, never more. So ×2.5 sits ~1.8× above the worst
 * contention actually observed, while `+30` did not sit above anything: it let a 3×
 * and even a 7× regression on a 4ms fixture pass in silence. The floor of `+5` only
 * matters for cases whose median rounds to 2ms or less.
 */
const limits = (m) => ({
  diffLimit: round(m.diffMean * 1.4 + 0.6, 3),
  diffBadLimit: round(m.diffBad * 2 + 0.004, 5),
  // The worst tile is a max, not a mean, so it is the noisier of the two — but on the
  // provenance machine it is bit-identical across runs like the others, and the
  // headroom here is for the same cross-machine font rasterisation the mean allows.
  diffTileLimit: round(m.diffTile * 1.35 + 2, 2),
  msLimit: Math.max(Math.ceil(m.ms * 2.5), Math.ceil(m.ms) + 5),
})

// ——— one fixture ——————————————————————————————————————————————

/**
 * @param {object} deps everything the case needs from the run's scope
 * @returns {Promise<object>} the measured values, for `--update`
 */
async function runCase (deps) {
  const { page, renderPage, reporter, pageDef, fixture, baseline, key, headLinks } = deps
  const { check, near, atMost } = reporter

  // Read BEFORE the first capture, unlike the leak signature below, because the damage
  // this catches is done once and then stays done: the clone's radios joined the page's
  // radio groups and unchecked the live one, after which every further capture was
  // idempotent and a before/after taken around the loop saw nothing. See SIGNATURE.
  const pristineForm = await page.evaluate(FORM_STATE)
  const cap = await page.evaluate(CAPTURE, { id: fixture, target: pageDef.target })
  if (!check('the capture produced a document', !cap.error, cap.error || '')) return null
  const afterOneForm = await page.evaluate(FORM_STATE)
  check('the first capture left every form control as it found it',
    afterOneForm === pristineForm,
    afterOneForm === pristineForm ? '' : `${pristineForm} → ${afterOneForm}`)

  // 1 — clean capture. Console and page-error buffers are filled by listeners
  // installed in `runVector` and cleared just before this call. Rejections are
  // collected by an init script in the page and drained HERE, before the assertion
  // reads them — a buffer read before it is filled asserts nothing.
  deps.rejections.push(...await page.evaluate(() => {
    const box = window.__vectorRejections || []
    window.__vectorRejections = []
    return box
  }))
  const errs = deps.consoleErrors
  check('no console errors during the capture', errs.length === 0,
    errs.slice(0, 3).join(' | ').slice(0, 300))
  check('no uncaught page errors', deps.pageErrors.length === 0,
    deps.pageErrors.slice(0, 3).join(' | ').slice(0, 300))
  check('no unhandled promise rejections', deps.rejections.length === 0,
    deps.rejections.slice(0, 3).join(' | ').slice(0, 300))

  // 2 — the document validates and the SVG carries no escape hatch.
  check('validate() accepts the SVD document', cap.schema.ok,
    (cap.schema.errors || []).slice(0, 3).join(' | '))
  check('the SVG contains zero foreignObject elements', cap.foreignObject === 0,
    cap.foreignObject ? `${cap.foreignObject} found — that is the raster path wearing a vector costume` : '')

  // 3 — strict XML. A lax consumer repairs in silence; test against the one that does not.
  check('the SVG parses under a strict XML parser', cap.xmlOk, cap.xmlError)

  // 3b — the same verdict, named. See `duplicateAttributes`: Figma pastes NOTHING
  // from a document that carries one, and "nothing happened" is the hardest symptom
  // there is to trace back to a repeated attribute name.
  const dups = duplicateAttributes(cap.svg)
  check('no element carries the same attribute twice', dups.length === 0,
    dups.slice(0, 3).map((d) => `<${d.tag}> has ${d.count}× ${d.attr} at offset ${d.at}`).join('; '))

  // 4 — the mount. If this drifts, every number above describes a different page.
  const drift = (cap.report && cap.report.drift) || null
  if (check('the capture reports clone drift at all', !!drift,
    drift ? '' : 'no report.drift — an unverified mount makes every coordinate below unverified')) {
    check('clone drift median is exactly 0px', drift.median === 0, `${fmt(drift.median)}px over ${drift.pairs} pairs`)
    atMost('clone drift max', drift.max, DRIFT_MAX_PX, 'px', 'the worst mapped node')
    check('the drift was measured against a non-empty node mapping', drift.pairs > 0, `${drift.pairs} pairs`)
  }

  // 5 — nothing degrades silently, and no NEW way of degrading slips in unseen.
  check('every non-E node is named by a diagnostic', cap.undeclared.length === 0,
    cap.undeclared.slice(0, 4).join('; '))
  const known = baseline ? (baseline.codes || []) : null
  if (known) {
    const appeared = cap.codes.filter((c) => !known.includes(c))
    const gone = known.filter((c) => !cap.codes.includes(c))
    check('no diagnostic code appeared that the baseline does not accept', appeared.length === 0,
      appeared.length ? `${appeared.join(', ')} — a new code is a new degradation; look at it, then --update` : '')
    check('every diagnostic code the baseline expects is still emitted', gone.length === 0,
      gone.length ? `${gone.join(', ')} — probably good news, still needs --update to become the new truth` : '')
  }

  // 5b — the text. Everything above says the document is well formed; this says it
  // is a document of the SAME WORDS. See `auditText` for the three questions and for
  // the one allowance each of them makes.
  const doc = JSON.parse(cap.svd)
  const coverage = (cap.report && cap.report.coverage) || {}
  const audit = auditText(doc, cap.liveTextNodes, coverage.iconFont)
  check('the text audit had text to audit', audit.blocks > 0 && cap.liveTextNodes.length > 0,
    `${audit.blocks} text block(s) against ${cap.liveTextNodes.length} live text node(s)` +
    (audit.generated ? `, ${audit.generated} carrying generated content` : ''))
  check('the measured lines cover every character of their block', audit.uncovered.length === 0,
    audit.uncovered.slice(0, 3).join('; '))
  check('every block paints a string the live element says', audit.notOnPage.length === 0,
    audit.notOnPage.slice(0, 3).join('; '))
  check('every visible live text node reached a text block',
    audit.unpainted.length <= audit.iconFont,
    audit.unpainted.length
      ? `${audit.unpainted.slice(0, 3).join('; ')} — allowance is ${audit.iconFont} (icon-font ligature(s) ` +
        'snapdom baked into an image)'
      : '')

  // …and the control, because a text audit that cannot fail is a line of output.
  // One character is taken out of a real line of THIS capture; the audit has to
  // notice on this fixture's own shape, not on a synthetic document.
  const planted = plantTextDefect(doc)
  if (check('a one-character loss could be planted in this document', !!planted,
    planted ? planted.what : 'no line with a non-space character to remove — the audit above proved nothing')) {
    const again = auditText(planted.doc, cap.liveTextNodes, coverage.iconFont)
    check('the text audit catches the planted loss', again.uncovered.length > audit.uncovered.length,
      `${again.uncovered.length} uncovered vs ${audit.uncovered.length} in the real capture`)
  }

  // 7 — the shape of the tree. A jump is an artifact getting in.
  if (baseline) {
    near('node count', cap.nodes, baseline.nodes, Math.max(2, baseline.nodes * 0.05))
    near('nodeRatio', cap.report.nodeRatio, baseline.nodeRatio, Math.max(0.05, baseline.nodeRatio * 0.05))

    // 7b — the SIZE of what was emitted, and the grade histogram. Both were recorded
    // in the baseline from the first revision and neither was ever compared to
    // anything, which made them look like coverage while asserting nothing.
    //
    // This is the check that catches an emitter that quietly got cheaper. Cutting
    // `CONIC_WEDGES` from 128 to 12 turns fx-card's gradient disc into a banded pie a
    // human spots instantly, yet every pixel assertion above stays green: the damage
    // is ~3% of the box, and the engine's ambient disagreement with the live render
    // (worst tile 14.67) is already larger than the damage (worst tile 13.51 measured
    // pristine-against-broken). No threshold over a live comparison can separate
    // them. The byte count can: 24436 → 13122. ±10% is wide enough for text metrics
    // to move a little between machines and narrow enough that a fan losing 90% of
    // its wedges cannot hide.
    if (Number.isFinite(baseline.svgBytes)) {
      near('SVG byte count', cap.svg.length, baseline.svgBytes, Math.ceil(baseline.svgBytes * 0.1))
    }
    if (baseline.grades) {
      const gradeOf = (g) => Object.keys(g).filter((k) => g[k]).sort().map((k) => `${k}:${g[k]}`).join(' ')
      const want = gradeOf(baseline.grades)
      const got = gradeOf(cap.grades)
      check('the node grade histogram is the baseline’s', got === want,
        got === want ? got : `${got} vs baseline ${want}`)
    }
  }

  // 8 — the payload the plugin actually eats. `doc` is the one parsed for 5b; the
  // plugin gets its own structured clone inside `figmaAccepts`, which is what keeps
  // one fixture's repairs out of the next one.
  const fig = figmaAccepts(doc)
  check('svdToFigma translated without an error-severity diagnostic',
    fig.translationErrors.length === 0, fig.translationErrors.slice(0, 3).join(' | '))
  check("the real plugin's readPayload accepts the payload", fig.ok,
    (fig.errors || []).slice(0, 3).join(' | '))
  check('the payload carries a node for every SVD node', fig.nodes >= cap.nodes,
    `${fig.nodes} figma nodes for ${cap.nodes} svd nodes`)

  // 6 — the load-bearing one. The SVG rendered against the element it claims to be.
  const shotSelector = pageDef.target === 'self' ? `#${fixture}` : `#${fixture} > *`
  const liveShot = (await page.locator(shotSelector).first().screenshot()).toString('base64')
  const box = {
    w: Math.max(cap.live.w, cap.svgBox ? cap.svgBox.w : 0),
    h: Math.max(cap.live.h, cap.svgBox ? cap.svgBox.h : 0),
  }
  const emittedShot = await renderSvg(renderPage, cap.svg, box, headLinks)
  const diff = await renderPage.evaluate(DIFF, { live: liveShot, emitted: emittedShot, w: box.w, h: box.h, tile: TILE_PX })

  // The case key is `page/fixture`; flattened for the filesystem so the artifacts of
  // both demos sit in one directory and sort next to each other.
  const stem = path.join(OUT, key.replace(/\//g, '-'))
  fs.writeFileSync(`${stem}.svg`, cap.svg)
  fs.writeFileSync(`${stem}.live.png`, Buffer.from(liveShot, 'base64'))
  fs.writeFileSync(`${stem}.emitted.png`, Buffer.from(emittedShot, 'base64'))
  fs.writeFileSync(`${stem}.diff.png`, Buffer.from(diff.png, 'base64'))

  if (cap.svgBox) {
    near('the SVG box is the element box', cap.svgBox.w, cap.live.w, 1, 'px')
    near('the SVG box height is the element height', cap.svgBox.h, cap.live.h, 1, 'px')
  }
  if (baseline) {
    atMost('mean pixel difference against the live element', diff.diffMean, baseline.diffLimit, '',
      `baseline ${fmt(baseline.diffMean)}, ${diff.pixels}px union box`)
    atMost('fraction of pixels off by more than 16/255', diff.diffBad, baseline.diffBadLimit, '',
      `baseline ${fmt(baseline.diffBad)}`)
    // The one that catches damage the two above average away. See DIFF's header.
    if (Number.isFinite(baseline.diffTileLimit)) {
      const at = diff.worstTileAt ? ` at ${diff.worstTileAt.x},${diff.worstTileAt.y}` : ''
      atMost(`worst ${diff.tile}×${diff.tile}px tile's mean difference`, diff.diffWorstTile,
        baseline.diffTileLimit, '', `baseline ${fmt(baseline.diffTile)}${at}`)
    }
  }

  // 9 + 10 — the same loop. The signature is taken after the first capture, so the
  // baseline already includes whatever a single capture legitimately leaves behind
  // (nothing, if the adapter's `finally` works) and the loop measures accumulation.
  const before = await signatureOf(page)
  const loop = await page.evaluate(LOOP, { id: fixture, target: pageDef.target, n: REPEATS })
  const after = await signatureOf(page)
  const drifted = Object.keys(before).filter((k) => before[k] !== after[k])
  check(`${REPEATS} captures leave the document exactly as they found it`, drifted.length === 0,
    drifted.map((k) => `${k}: ${String(before[k]).slice(0, 120)} → ${String(after[k]).slice(0, 120)}`).join(', '))

  const ms = median(loop.times)
  if (baseline) {
    atMost('median capture time', ms, baseline.msLimit, 'ms',
      `baseline ${fmt(baseline.ms)}ms ×2, ${REPEATS} samples`)
  }

  const measured = {
    nodes: cap.nodes,
    domElements: cap.report.domElements,
    nodeRatio: round(cap.report.nodeRatio, 4),
    grades: cap.grades,
    diffMean: round(diff.diffMean, 3),
    diffBad: round(diff.diffBad, 5),
    diffTile: round(diff.diffWorstTile, 2),
    ms: Math.round(ms),
    svgBytes: cap.svg.length,
    codes: cap.codes,
  }
  return { ...measured, ...limits(measured) }
}

/**
 * Render one SVG at its natural size on the scratch page and screenshot it.
 * The page inherits the demo's stylesheet `<link>`s: v0 embeds no font binaries (the
 * emitter says so under `emit.svg.font-not-embedded`), so a family that arrives by
 * NAME resolves only if the same stylesheets are present. Without this the diff would
 * measure font substitution and call it a regression.
 *
 * @param {import('playwright').Page} renderPage
 * @param {string} svg
 * @param {{w: number, h: number}} box the union box
 * @param {string[]} headLinks absolute stylesheet URLs from the demo page
 * @returns {Promise<string>} base64 PNG
 */
async function renderSvg (renderPage, svg, box, headLinks) {
  const w = Math.max(1, Math.ceil(box.w))
  const h = Math.max(1, Math.ceil(box.h))
  await renderPage.setViewportSize({ width: Math.min(4000, w + 40), height: Math.min(4000, h + 40) })
  await renderPage.setContent(
    headLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join('') +
    '<style>html,body{margin:0;padding:0;background:#fff}' +
    `#stage{position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#fff;overflow:hidden}` +
    '#stage svg{display:block}</style>' +
    `<div id="stage">${svg}</div>`,
    { waitUntil: 'load' })
  await renderPage.evaluate(() => document.fonts.ready.then(() => true))
  return (await renderPage.locator('#stage').screenshot()).toString('base64')
}

// ——— exploratory mode ————————————————————————————————————————

/**
 * Re-serve the repo under `SHIM` on whatever origin the context happens to be on.
 *
 * The handler proxies `serve.mjs` rather than touching the filesystem: that file
 * already owns path resolution, the two mounts and the containment check, and a
 * second copy of that logic here is a second place for `/../` to be wrong. The only
 * thing added on the way past is the bare-specifier rewrite — see `SHIM`.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} base the local server's origin
 */
async function installShim (context, base) {
  await context.route(`**${SHIM}**`, async (route) => {
    const at = route.request().url().indexOf(SHIM)
    const rest = route.request().url().slice(at + SHIM.length)
    let res
    try {
      res = await fetch(`${base}/${rest}`)
    } catch (err) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: `shim proxy failed: ${err.message}` })
      return
    }
    let body = await res.text()
    for (const [bare, file] of SHIM_SPECIFIERS) {
      body = body.split(`'${bare}'`).join(`'${SHIM}${file}'`).split(`"${bare}"`).join(`"${SHIM}${file}"`)
    }
    await route.fulfill({
      status: res.status,
      contentType: 'text/javascript',
      // The page is not ours and its own CSP does not apply to a fulfilled route,
      // but the header is set anyway so the module is never treated as a document.
      headers: { 'x-content-type-options': 'nosniff' },
      body,
    })
  })
}

/**
 * A page nobody wrote for us. No baseline, no failures: the value is that the page is
 * hostile by accident. Everything is reported, nothing is asserted — a suite that
 * failed on the open web would just get muted.
 *
 * @param {object} deps
 */
async function runExternal (deps) {
  const { page, renderPage, url, selector } = deps
  console.log(`\n══ exploratory: ${url}`)
  const consoleErrors = deps.consoleErrors

  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  // Real pages settle late: lazy images, webfont swaps, a hydration pass. A fixed
  // wait is crude and it is the only thing available without knowing the page.
  await page.waitForTimeout(2000)
  await page.evaluate(() => document.fonts.ready.then(() => true))

  const picked = await page.evaluate(PICK, { selector: selector || null })
  if (!picked.found) {
    console.log(`  the selector ${selector} matches nothing on this page — nothing to vectorise`)
    return { url, error: 'selector matched nothing' }
  }
  const sel = picked.marked ? '[data-verify-vector-target]' : picked.selector
  console.log(`  element: ${picked.selector}${selector ? '' : '  (heuristic: largest visible block)'}`)

  const externalLinks = await page.$$eval('link[rel="stylesheet"]', (ls) => ls.map((l) => l.href))
  deps.externalLinks = externalLinks
  consoleErrors.length = 0
  const cap = await page.evaluate(async (a) => {
    const [snapdomMod, vector, svgFlat] = await Promise.all([
      import(a.snapdomUrl),
      import(a.vectorUrl),
      import(a.svgUrl),
    ])
    const snapdom = snapdomMod.snapdom
    const vectorPlugin = vector.vector || vector.default
    const svdToSvg = svgFlat.svdToSvg || svgFlat.default
    const el = document.querySelector(a.sel)
    const t0 = performance.now()
    try {
      const captured = await snapdom(el, {
        plugins: [vectorPlugin({ mode: 'design', silent: true })],
      })
      const doc = await captured.toVector()
      const emitted = svdToSvg(doc)
      const svg = typeof emitted === 'string' ? emitted : emitted.svg
      const all = [...(doc.diagnostics || []), ...((emitted && emitted.diagnostics) || [])]
      const byCode = {}
      for (const d of all) {
        const c = (d && d.code) || 'uncoded'
        if (!byCode[c]) byCode[c] = { n: 0, grade: d && d.grade, severity: d && d.severity, message: (d && d.message) || '' }
        byCode[c].n++
      }
      const grades = {}
      for (const node of Object.values(doc.nodes || {})) {
        const g = (node && node.fidelity && node.fidelity.grade) || 'E'
        grades[g] = (grades[g] || 0) + 1
      }
      const r = el.getBoundingClientRect()
      const xml = new DOMParser().parseFromString(svg, 'application/xml')
      const wh = /<svg[^>]*\swidth="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)
      return {
        ms: performance.now() - t0, svg,
        nodes: Object.keys(doc.nodes).length,
        report: doc.report || {}, grades, byCode,
        xmlOk: !xml.querySelector('parsererror'),
        foreignObject: xml.getElementsByTagName('foreignObject').length,
        live: { w: r.width, h: r.height },
        svgBox: wh ? { w: Number(wh[1]), h: Number(wh[2]) } : null,
      }
    } catch (err) {
      return { error: `${err && err.name}: ${err && err.message}`, stack: String((err && err.stack) || '').slice(0, 800) }
    }
  }, { sel, snapdomUrl: deps.snapdomUrl, vectorUrl: deps.vectorUrl, svgUrl: deps.svgUrl })

  if (cap.error) {
    console.log(`  toVector FAILED: ${cap.error}`)
    if (cap.stack) console.log(cap.stack.split('\n').slice(0, 6).map((l) => `    ${l}`).join('\n'))
    return { url, selector: picked.selector, error: cap.error }
  }

  const box = { w: Math.max(cap.live.w, cap.svgBox ? cap.svgBox.w : 0), h: Math.max(cap.live.h, cap.svgBox ? cap.svgBox.h : 0) }
  let diff = null
  try {
    const liveShot = (await page.locator(sel).first().screenshot()).toString('base64')
    const emittedShot = await renderSvg(renderPage, cap.svg, box, deps.externalLinks || [])
    diff = await renderPage.evaluate(DIFF, { live: liveShot, emitted: emittedShot, w: box.w, h: box.h, tile: TILE_PX })
    // Wild captures land in their own directory: they are evidence about the open
    // web, not artifacts of the fixture suite, and mixing them into out/vector-verify
    // makes `external-…` files look like cases that have baselines. They do not.
    fs.mkdirSync(WILD_OUT, { recursive: true })
    // The selector belongs in the filename. Two captures of the SAME url with
    // different --selector are two different pictures, and keying the stem on the url
    // alone makes the second silently overwrite the first — which is exactly how a
    // capture that rendered BLANK replaced the evidence of the one that worked.
    const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    const sig = selector ? `-${slug(picked.selector).slice(-28)}` : ''
    const stem = path.join(WILD_OUT, slug(url.replace(/^https?:\/\//, '')).slice(0, 48) + sig)
    fs.writeFileSync(`${stem}.svg`, cap.svg)
    fs.writeFileSync(`${stem}.live.png`, Buffer.from(liveShot, 'base64'))
    fs.writeFileSync(`${stem}.emitted.png`, Buffer.from(emittedShot, 'base64'))
    fs.writeFileSync(`${stem}.diff.png`, Buffer.from(diff.png, 'base64'))
    console.log(`  artifacts: ${stem}.{svg,live.png,emitted.png,diff.png}`)
  } catch (err) {
    console.log(`  pixel diff unavailable: ${err.message}`)
  }

  const r = cap.report
  const d = r.drift
  console.log(`  box          ${fmt(cap.live.w)}×${fmt(cap.live.h)}px`)
  console.log(`  nodes        ${cap.nodes} from ${r.domElements} DOM elements — nodeRatio ${fmt(r.nodeRatio)}`)
  console.log(`  clone drift  ${d ? `median ${fmt(d.median)}px, p95 ${fmt(d.p95)}px, max ${fmt(d.max)}px over ${d.pairs} pairs` : 'not reported'}`)
  console.log(`  grades       ${Object.entries(cap.grades).filter(([, n]) => n).map(([g, n]) => `${g}:${n}`).join('  ')}`)
  console.log(`  text/raster  ${r.textBlocks} text blocks, ${r.raster} raster layer(s), ${r.assets} asset(s)`)
  const wildDups = duplicateAttributes(cap.svg)
  console.log(`  svg          ${(cap.svg.length / 1024).toFixed(1)} kB · strict XML ${cap.xmlOk ? 'ok' : 'REJECTED'} · foreignObject ${cap.foreignObject}` +
    ` · duplicate attrs ${wildDups.length}${wildDups.length ? ` (${wildDups.slice(0, 2).map((d) => `<${d.tag}> ${d.attr}`).join(', ')}) — Figma pastes nothing from this` : ''}`)
  console.log(`  pixel diff   ${diff ? `mean ${fmt(diff.diffMean)}/255, ${(diff.diffBad * 100).toFixed(2)}% of pixels off by >16` +
    `, worst ${diff.tile}px tile ${fmt(diff.diffWorstTile)}${diff.worstTileAt ? ` at ${diff.worstTileAt.x},${diff.worstTileAt.y}` : ''}` : 'not measured'}`)
  console.log(`  time         ${fmt(cap.ms)}ms${r.timings ? ` (snapdom ${fmt(r.timings.snapdomMs)}ms + engine ${fmt(r.timings.engineMs)}ms)` : ''}`)
  console.log(`  console      ${consoleErrors.length} error(s)${consoleErrors.length ? `: ${consoleErrors[0].slice(0, 120)}` : ''}`)

  const codes = Object.entries(cap.byCode).sort((a, b) => b[1].n - a[1].n)
  console.log(`  degradations ${codes.length ? '' : 'none'}`)
  for (const [code, info] of codes) {
    console.log(`    ${String(info.n).padStart(4)}×  ${code.padEnd(34)} ${(info.grade || '-')}/${info.severity || '-'}  ${info.message.replace(/\s+/g, ' ').slice(0, 70)}`)
  }
  console.log('\n  Nothing above is an assertion: this page was not written for us, and a suite\n' +
    '  that failed on the open web would be muted within a week. It is here so the\n' +
    '  numbers exist. Two caveats worth carrying: the harness loads the engine with\n' +
    "  the page's CSP bypassed, so a green run here says nothing about CSP\n" +
    '  compatibility; and the pixel diff renders the SVG on a scratch page carrying\n' +
    "  only this page's stylesheet <link>s, so a font delivered any other way (inline\n" +
    '  @font-face, JS loader) is substituted and inflates the number.')
  return { url, selector: picked.selector, nodes: cap.nodes, diff: diff && diff.diffMean, codes: codes.length }
}

// ——— the run ——————————————————————————————————————————————————

/**
 * Run the vector regression suite.
 *
 * @param {object} [opts]
 * @param {string} [opts.only] substring filter over `page/fixture` keys
 * @param {boolean} [opts.update] rewrite test/vector-baselines.json from this run
 * @param {string} [opts.url] exploratory mode: vectorise one element of a real page
 * @param {string} [opts.selector] which element, in `--url` mode; heuristic if absent
 * @param {boolean} [opts.quiet] suppress the per-check log
 * @param {number} [opts.repeats] captures in the leak/timing loop (default 20)
 * @returns {Promise<{passed: number, failed: number, cases: object[]}>}
 */
export async function runVector (opts = {}) {
  fs.mkdirSync(OUT, { recursive: true })
  const reporter = makeReporter({ quiet: opts.quiet })
  const baselines = readBaselines()
  const measured = {}

  // Said once, before every case fails identically on an import that 404'd. This is
  // now the ONLY thing the preflight can honestly claim — a build of `main` is not
  // caught here, because it runs the plugin and hands over a clone; what it costs
  // shows up as ten named fidelity failures further down. See `snapdomBuildProblem`.
  const buildProblem = snapdomBuildProblem('v3')
  if (buildProblem) console.error(`\n[verify-vector] ${buildProblem}\n`)

  const server = await serve(0)
  const base = `http://localhost:${server.port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const renderPage = await context.newPage()

  const consoleErrors = []
  const pageErrors = []
  const rejections = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // A stylesheet or webfont from a third-party CDN failing is the network's
    // problem, not the engine's, and muting the whole check for it would be worse
    // than naming the exception here.
    const where = (m.location() && m.location().url) || ''
    if (where && !where.startsWith(base)) return
    consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)))
  page.on('crash', () => pageErrors.push('the page CRASHED'))
  // `pageerror` does not fire for an unhandled rejection, so it gets its own channel.
  await page.addInitScript(() => {
    addEventListener('unhandledrejection', (e) => {
      const box = (window.__vectorRejections = window.__vectorRejections || [])
      box.push(String((e.reason && e.reason.message) || e.reason))
    })
  })

  try {
    if (opts.url) {
      // A context of its own, because `bypassCSP` is a lie the fixture pages must
      // never be told: the contract forbids `eval`/`new Function` precisely so the
      // engine survives a page's CSP, and a suite that bypassed CSP everywhere would
      // be unable to notice if that ever stopped being true. Here it is unavoidable
      // — the target's CSP would refuse the harness's own module import long before
      // the engine got a chance to misbehave — and the report says so out loud.
      const wild = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, bypassCSP: true })
      const target = await wild.newPage()
      const wildErrors = []
      target.on('console', (m) => { if (m.type() === 'error') wildErrors.push(m.text()) })
      target.on('pageerror', (e) => wildErrors.push(String((e && e.message) || e)))
      await installShim(wild, base)
      let out
      try {
        out = await runExternal({
          page: target, renderPage, url: opts.url, selector: opts.selector,
          consoleErrors: wildErrors,
          // snapdom is imported explicitly rather than left to the specifier rewrite:
          // the rewrite fixes the bare specifiers INSIDE the engine's own sources, and
          // this evaluate() is not one of them — the plugin has to be registered on a
          // capture the harness makes itself.
          snapdomUrl: `${SHIM}snapdom-v3/dist/snapdom.mjs`,
          vectorUrl: `${SHIM}src/index.js`,
          svgUrl: `${SHIM}src/emit/svg-flat.js`,
        })
      } finally {
        await wild.close()
      }
      return { passed: 0, failed: 0, cases: [{ name: `external:${opts.url}`, checks: [], external: out }] }
    }

    checkDetectors(reporter)

    /** Every key the demos offered, so `--only` matching nothing can say what does. */
    const offered = []

    for (const pageDef of PAGES) {
      await page.goto(base + pageDef.url, { waitUntil: 'load' })
      await page.waitForFunction('window.__ready === true', null, { timeout: 30000 })
      const fixtures = await page.$$eval(`${pageDef.select} option`, (os) => os.map((o) => o.value))
      reporter.open(`${pageDef.id} (discovery)`)
      reporter.check(`${pageDef.select} on ${pageDef.url} lists at least one fixture`,
        fixtures.length > 0, fixtures.join(', '))

      // Every stylesheet the demo loads, absolute — the scratch renderer needs the
      // same font environment or the diff measures substitution. See renderSvg().
      const headLinks = await page.$$eval('link[rel="stylesheet"]', (ls) => ls.map((l) => l.href))

      for (const fixture of fixtures) {
        const key = `${pageDef.id}/${fixture}`
        offered.push(key)
        if (opts.only && !key.includes(opts.only)) continue
        reporter.open(key)

        // A fresh document per fixture: console-error attribution, and a leak
        // signature that cannot inherit the previous fixture's residue.
        await page.goto(base + pageDef.url, { waitUntil: 'load' })
        await page.waitForFunction('window.__ready === true', null, { timeout: 30000 })
        consoleErrors.length = 0
        pageErrors.length = 0
        rejections.length = 0

        const baseline = baselines.cases[key] || null
        if (!baseline && !opts.update) {
          reporter.check('the fixture has a baseline', false,
            `no entry for "${key}" in ${path.relative(ROOT, BASELINE_FILE)} — a new fixture is a new ` +
            'claim about the engine; look at its numbers and accept them with --update')
        }

        try {
          const got = await runCase({
            page, renderPage, reporter, pageDef, fixture, baseline, key, headLinks,
            consoleErrors, pageErrors, rejections,
          })
          if (got) measured[key] = got
        } catch (err) {
          reporter.check('the case completed', false, `${err.message}`)
        }
      }
    }

    // A filter that selects nothing is a typo, not a green run. Saying which keys
    // exist is the difference between "0 checks passed" and a fixed command line.
    if (opts.only) {
      const hit = reporter.cases.some((c) => c.name.includes(opts.only))
      if (!hit) {
        reporter.open('--only')
        reporter.check(`--only=${opts.only} matches at least one case`, false,
          `known cases: ${offered.join(', ')}`)
      }
    }

    if (opts.update) {
      const kept = { ...baselines.cases }
      // `why` is prose a human wrote to explain why a number is high on purpose; it is
      // the only field here that is not measured, so it is the only one --update must
      // not clobber. Without this carry-over the first re-baseline silently deletes
      // the reason a threshold is where it is, which is how a documented tolerance
      // decays back into an unexplained magic number.
      for (const [k, v] of Object.entries(measured)) {
        const why = kept[k] && kept[k].why
        kept[k] = why ? { ...v, why } : v
      }
      const next = {
        _comment: BASELINE_HEADER,
        _provenance: provenance(browser.version()),
        cases: Object.fromEntries(Object.keys(kept).sort().map((k) => [k, kept[k]])),
      }
      // Same carry-over, same reason, one level up: see readBaselines().
      if (baselines._acceptedRegressions !== undefined) {
        next._acceptedRegressions = baselines._acceptedRegressions
      }
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
      console.log(`\nbaselines rewritten: ${path.relative(ROOT, BASELINE_FILE)} ` +
        `(${Object.keys(measured).length} case(s) measured, ${Object.keys(kept).length} stored)`)
    }
  } finally {
    await context.close()
    await browser.close()
    server.close()
  }

  const cases = reporter.cases
  const passed = cases.reduce((n, c) => n + c.passed, 0)
  const failed = cases.reduce((n, c) => n + c.failed, 0)
  return { passed, failed, cases }
}

/**
 * El trinquete del corpus: la media de las medias no puede subir.
 *
 * `diffLimit` es `diffMean * 1.4 + 0.6` por caso, y esa banda existe por una razón
 * buena — el antialiasing y la sustitución de fuentes se mueven entre máquinas, y un
 * caso solo no aguanta un umbral apretado sin volverse intermitente. El precio es que
 * una MEJORA queda sin proteger: medido el 2026-08-07, revertir el arreglo de
 * `filterSigma` —que había bajado dos casos— dejaba la suite en 693/693 igual.
 *
 * El agregado sí aguanta un umbral apretado, porque el ruido de 19 casos se promedia
 * mientras que una regresión real empuja la media en una sola dirección. 2% de banda
 * sobre la media de las medias: suficiente para el ruido, insuficiente para perder en
 * silencio lo que costó medir.
 *
 * @returns {{ok: boolean, line: string}|null}
 */
function corpusRatchet (cases, update) {
  const NAME = 'mean pixel difference against the live element'
  const values = []
  for (const c of cases) {
    for (const chk of c.checks) {
      if (chk.name === NAME && Number.isFinite(chk.value)) values.push(chk.value)
    }
  }
  if (values.length < 5) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  let stored = NaN
  try { stored = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))._corpusDiffMean } catch { stored = NaN }

  if (update || !Number.isFinite(stored)) {
    try {
      const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
      raw._corpusDiffMean = round(mean, 4)
      raw._corpusDiffCases = values.length
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(raw, null, 2)}\n`)
    } catch { /* sin baselines todavía; el trinquete arranca en la próxima corrida */ }
    return { ok: true, line: `corpus mean pixel difference: ${fmt(mean)} over ${values.length} case(s) — stored` }
  }

  const limit = stored * 1.02
  const okNow = mean <= limit
  const delta = ((mean - stored) / stored) * 100
  return {
    okNow,
    ok: okNow,
    line: `corpus mean pixel difference: ${fmt(mean)} vs <=${fmt(limit)} ` +
      `(baseline ${fmt(stored)}, ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%, ${values.length} case(s))` +
      (okNow ? '' : '  <- REGRESION: algo que habia mejorado se perdio'),
  }
}

export default runVector

// ——— cli ———————————————————————————————————————————————————————

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
    if (hit === undefined) return undefined
    return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
  }
  const opts = {
    update: flag('update') === true,
    only: typeof flag('only') === 'string' ? flag('only') : undefined,
    url: typeof flag('url') === 'string' ? flag('url') : undefined,
    selector: typeof flag('selector') === 'string' ? flag('selector') : undefined,
  }

  const { passed, cases } = await runVector(opts)
  // `let`, porque el trinquete del corpus puede sumar una falla después del recuento
  // por caso: es la única comprobación que no pertenece a ningún caso.
  let failed = cases.reduce((n, c) => n + c.failed, 0)

  if (opts.url) {
    process.exitCode = 0
  } else {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`${passed}/${passed + failed} checks passed across ${cases.length} case(s)`)
    const ratchet = corpusRatchet(cases, opts.update)
    if (ratchet) {
      console.log(ratchet.line)
      if (!ratchet.ok) { failed++; process.exitCode = 1 }
    }
    if (failed) {
      process.exitCode = 1
      console.log(`\n${failed} FAILED:`)
      for (const c of cases) {
        for (const chk of c.checks) {
          if (!chk.ok) console.log(`  ${c.name} › ${chk.name}${chk.detail ? ` — ${chk.detail}` : ''}`)
        }
      }
    }
    console.log(`\nartifacts in ${OUT}`)
  }
}
