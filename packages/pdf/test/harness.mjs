/**
 * Shared test harness for snapdom-pro.
 *
 * Everything here was lifted verbatim out of test/verify.mjs, which was the only
 * suite in the repo and therefore owned helpers that are not about PDFs at all: the
 * assertion log, the Chromium bootstrap, the fixture-ready wait, the live-pixel
 * screenshot. The vector suite needs the same four things, and a second private copy
 * of `check` is how two suites start reporting the same failure two different ways.
 *
 * This is an EXTRACTION, not a redesign. Where a helper had a quirk, the quirk moved
 * with it and is commented at the quirk. Anything a helper closed over — the
 * Playwright page, the output directory — became an argument or a factory parameter,
 * and nothing else changed. `node test/verify.mjs` must produce the same check count
 * and the same lines before and after this file existed.
 *
 * Three layers, and a suite may use one without the next:
 *   1. reporting — check/near/fmt/results/report. No browser, no PDF.
 *   2. browser   — loadChromium/instrument/openFixture/livePixels. No PDF.
 *   3. pdf       — pdfTools(), pdfProblems, the text-layer string helpers.
 *
 * @module test/harness
 */
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

/** CSS px → PDF points, the same constant src/index.js applies. */
export const PT = 0.75

// ——— assertions ———————————————————————————————————————————————

/**
 * Every check every suite has recorded, in order. Exported as a live array rather
 * than behind a getter because the run loop clears nothing and the summary reads it
 * directly; a suite that wants a private log calls `resetResults()` first.
 * @type {{fixture: string, name: string, ok: boolean, detail: string}[]}
 */
export const results = []

let current = '—'

/**
 * Name the fixture that subsequent checks belong to. The run loop calls this once
 * per fixture; the summary groups failures by it.
 * @param {string} name
 */
export function setFixture(name) {
  current = name
}

/** @returns {string} the fixture name checks are currently being filed under. */
export function currentFixture() {
  return current
}

/** Drop every recorded check. For a suite that wants its own tally. */
export function resetResults() {
  results.length = 0
}

/**
 * Record one assertion and print it. Nothing here is informational: a false `ok` is
 * a failure the summary repeats and the process exits non-zero for.
 * @param {string} name what is being claimed, in the present tense
 * @param {*} ok truthy passes — coerced, so a `.find()` result is a legal argument
 * @param {string} [detail] the numbers behind the claim, printed pass or fail
 * @returns {boolean} the coerced `ok`, so a caller can skip dependent checks
 */
export function check(name, ok, detail = '') {
  results.push({ fixture: current, name, ok: !!ok, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  return !!ok
}

/**
 * Two decimals, and the raw value for anything that is not a finite number — an
 * `undefined` reads as "undefined" instead of "NaN", which names a different bug.
 * @param {number} n
 * @returns {string}
 */
export const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n))

/**
 * An assertion with a tolerance. The detail always carries actual, expected, the
 * tolerance and the miss, so a near-miss is legible without re-running.
 * @param {string} name
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol absolute, in `unit`
 * @param {string} [unit] printed suffix only — 'px', 'pt', '°'
 * @returns {boolean}
 */
export function near(name, actual, expected, tol, unit = '') {
  const d = Math.abs(actual - expected)
  return check(name, d <= tol, `${fmt(actual)}${unit} vs ${fmt(expected)}±${tol}${unit} (off ${fmt(d)})`)
}

/**
 * Smallest signed distance between two angles, as a magnitude in degrees. Pure math,
 * shared because a suite that compares a CSS rotation against a matrix's atan2 needs
 * it and re-deriving the wrap is how 359° gets reported as a 358° miss.
 * @param {number} actual degrees
 * @param {number} expected degrees
 * @returns {number} 0…180
 */
export function angleDelta(actual, expected) {
  let d = (actual - expected) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return Math.abs(d)
}

/**
 * The tally, in the shape a suite entry point returns to a caller.
 * @param {typeof results} [rs]
 * @returns {{passed: number, failed: number, cases: typeof results}}
 */
export function summarize(rs = results) {
  const cases = rs.slice()
  const failed = cases.filter(c => !c.ok)
  return { passed: cases.length - failed.length, failed: failed.length, cases }
}

/**
 * Print the summary and, by default, set the exit code. Every failure is repeated
 * here with its fixture, because a failing line 900 lines up the scrollback is a
 * failure nobody sees.
 * @param {typeof results} [rs]
 * @param {object} [opts]
 * @param {string} [opts.scope] what the checks ran across — '16 fixture(s)'
 * @param {boolean} [opts.setExitCode] false when a caller aggregates several suites
 *   itself and owns the process's exit code
 * @returns {{passed: number, failed: number, cases: typeof results}}
 */
export function report(rs = results, { scope = '', setExitCode = true } = {}) {
  const sum = summarize(rs)
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${sum.passed}/${sum.cases.length} checks passed${scope ? ` across ${scope}` : ''}`)
  if (sum.failed) {
    if (setExitCode) process.exitCode = 1
    console.log(`\n${sum.failed} FAILED:`)
    for (const f of sum.cases.filter(c => !c.ok)) {
      console.log(`  ${f.fixture} › ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
    }
  }
  return sum
}

// ——— text-layer strings ————————————————————————————————————————

/** Whitespace is a layout artefact of the run split, never content. */
export const strip = (s) => s.replace(/\s+/g, '')

/** @param {{items: {str: string}[]}} p a page from `pdfTools().analyze` */
export const pageText = (p) => p.items.map(i => i.str).join(' ')

/** @param {{pages: {items: {str: string}[]}[]}} r a whole analyzed document */
export const allText = (r) => r.pages.map(pageText).join(' ')

/**
 * Non-overlapping occurrences. `indexOf` in a loop rather than a regex: the needles
 * here are real copy and would need escaping.
 * @param {string} hay
 * @param {string} needle
 * @returns {number}
 */
export function occurrences(hay, needle) {
  let n = 0
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

/**
 * @param {{pages: {items: {str: string}[]}[]}} r
 * @param {string} needle
 * @param {string} [label] what to call it in the check name, when the needle is long
 * @returns {boolean}
 */
export function present(r, needle, label = needle) {
  return check(`"${label}" is in the text layer`, strip(allText(r)).includes(strip(needle)))
}

/**
 * @param {{pages: {items: {str: string}[]}[]}} r
 * @param {string} needle
 * @param {string} why the reason it must be absent, printed in the check name
 * @param {string} [label]
 * @returns {boolean}
 */
export function absent(r, needle, why, label = needle) {
  const hits = occurrences(strip(allText(r)), strip(needle))
  return check(`"${label}" is NOT in the text layer (${why})`, hits === 0, hits ? `found ${hits}×` : '')
}

/**
 * Once, not "at least once": a run drawn twice is invisible in a render and is the
 * signature of a slice boundary that copied instead of cutting.
 * @param {{pages: {items: {str: string}[]}[]}} r
 * @param {string} needle
 * @param {string} [label]
 * @returns {boolean}
 */
export function exactlyOnce(r, needle, label = needle) {
  const hits = occurrences(strip(allText(r)), strip(needle))
  return check(`"${label}" appears exactly once`, hits === 1, `found ${hits}×`)
}

// ——— PDF byte structure ————————————————————————————————————————

/**
 * pdf.js recovers silently from a broken xref (it catches XRefParseException and
 * rescans the file for objects) and from a wrong /Length (it hunts for endstream),
 * so "it parsed" says nothing about the bytes. Acrobat's preflight does neither.
 * This is the only thing between a green suite and a file a strict viewer rejects.
 *
 * @param {string} raw - the file as latin1, where string index === byte offset.
 * @returns {string[]} problems, empty when the bytes describe themselves correctly
 */
export function pdfProblems(raw) {
  const bad = []
  if (!raw.startsWith('%PDF-')) bad.push('no %PDF- header')
  if (!raw.endsWith('%%EOF\n')) bad.push('does not end with %%EOF')

  const sx = raw.lastIndexOf('startxref')
  const xrefAt = sx === -1 ? -1 : parseInt(raw.slice(sx + 9, sx + 40).trim(), 10)
  if (!(xrefAt >= 0) || raw.slice(xrefAt, xrefAt + 4) !== 'xref') {
    bad.push(`startxref ${xrefAt} does not point at an xref table`)
    return bad
  }

  const head = /^xref\n(\d+) (\d+)\n/.exec(raw.slice(xrefAt, xrefAt + 40))
  if (!head || head[1] !== '0') {
    bad.push(`malformed xref subsection header ${JSON.stringify(raw.slice(xrefAt, xrefAt + 20))}`)
    return bad
  }
  const count = Number(head[2])
  const table = raw.slice(xrefAt + head[0].length)
  const size = Number((/\/Size (\d+)/.exec(raw.slice(xrefAt)) || [])[1])
  if (size !== count) bad.push(`trailer /Size ${size} but ${count} xref entries`)
  if (table.slice(0, 20) !== '0000000000 65535 f \n') bad.push('object 0 is not the free-list head')

  const offsets = []
  for (let id = 1; id < count; id++) {
    const entry = table.slice(id * 20, id * 20 + 20)
    if (!/^\d{10} \d{5} n \n$/.test(entry)) {
      bad.push(`xref entry ${id} is malformed: ${JSON.stringify(entry)}`)
      return bad
    }
    offsets.push(Number(entry.slice(0, 10)))
  }

  for (let i = 0; i < offsets.length; i++) {
    const id = i + 1
    const body = raw.slice(offsets[i], i + 1 < offsets.length ? offsets[i + 1] : xrefAt)
    if (!body.startsWith(`${id} 0 obj\n`)) {
      bad.push(`object ${id}: offset ${offsets[i]} points at ${JSON.stringify(body.slice(0, 24))}`)
      continue
    }
    if (!body.endsWith('\nendobj\n')) bad.push(`object ${id}: does not end with endobj`)

    // Dictionaries carrying a stream are flat here, so the first `>>` before
    // `stream` is the one that closes the stream's own dictionary.
    const at = body.indexOf('>>\nstream\n')
    if (at === -1) continue
    const declared = /\/Length (\d+) >>\nstream\n$/.exec(body.slice(0, at + 10))
    if (!declared) { bad.push(`object ${id}: stream with no /Length`); continue }
    const from = at + 10
    const len = Number(declared[1])
    if (body.slice(from + len, from + len + 10) !== '\nendstream') {
      const actual = body.indexOf('\nendstream', from) - from
      bad.push(`object ${id}: /Length ${len} but ${actual} bytes precede endstream`)
    }
  }
  return bad
}

// ——— browser ——————————————————————————————————————————————————

/**
 * Playwright, devDependency first. The sibling snapdom checkout is a fallback for a
 * workspace whose install has not happened yet, never the thing a suite depends on.
 * @param {string} root the repo root, whose sibling `../snapdom` is the fallback
 * @returns {Promise<import('playwright').BrowserType>} chromium
 */
export async function loadChromium(root) {
  // Own node_modules first. The fallback is the snapdom checkout, which lives
  // beside the org folder rather than beside this repository — two levels up.
  const { chromium } = await import('playwright').catch(() =>
    createRequire(path.join(root, '..', '..', 'snapdom', 'package.json'))('playwright'))
  return chromium
}

/**
 * Attach console and pageerror listeners to a page. Both arrays are live and are
 * cleared in place by the run loop between fixtures, so a fixture only ever sees its
 * own noise.
 * @param {import('playwright').Page} page
 * @returns {{log: string[], errors: string[]}} `log` entries are `"<type>: <text>"`
 */
export function instrument(page) {
  const log = []
  const errors = []
  page.on('console', m => log.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', e => errors.push(e.message))
  return { log, errors }
}

/**
 * Navigate and wait for the fixture to declare itself ready. Two waits, not one:
 * `window.__ready` is the fixture's own signal that its DOM is final, and
 * `document.fonts.ready` is the browser's that text has stopped re-measuring — a
 * capture taken between them is laid out with fallback metrics.
 * @param {import('playwright').Page} page
 * @param {string} url absolute, including the harness server's origin
 * @param {{timeout?: number, ready?: () => boolean}} [opts] `ready` runs IN the page
 *   and must close over nothing. Override it for a page that is not one of ours and
 *   therefore never sets `window.__ready` — an external page's own settled signal,
 *   e.g. `() => document.readyState === 'complete'`.
 */
export async function openFixture(page, url, { timeout = 15000, ready = () => window.__ready === true } = {}) {
  await page.goto(url)
  await page.waitForFunction(ready, null, { timeout })
  await page.evaluate(() => document.fonts.ready.then(() => true))
}

/**
 * Chromium's own pixels for one element, base64 PNG. It gets a page of ITS OWN
 * because a shared harness page is deviceScaleFactor 1, and a 1px live grid measured
 * against a 0.5px capture grid puts three quarters of a pixel of pure quantisation
 * into a tolerance half a pixel wide. Pass the same viewport the comparison page
 * uses — a different one is a different layout, and then the two images are of two
 * different documents.
 * @param {import('playwright').Browser} browser
 * @param {string} url the fixture, absolute
 * @param {string} selector what to screenshot
 * @param {{viewport?: {width: number, height: number}, deviceScaleFactor?: number, timeout?: number, ready?: () => boolean}} [opts]
 * @returns {Promise<string>} base64 PNG, no data: prefix
 */
export async function livePixels(browser, url, selector, opts = {}) {
  const { viewport = { width: 1200, height: 900 }, deviceScaleFactor = 2, timeout = 15000, ready } = opts
  const shotPage = await browser.newPage({ viewport, deviceScaleFactor })
  try {
    await openFixture(shotPage, url, ready ? { timeout, ready } : { timeout })
    return (await shotPage.locator(selector).screenshot()).toString('base64')
  } finally {
    await shotPage.close()
  }
}

/**
 * Every `[data-probe]` box, in CSS px relative to `#target`'s border box. Serialized
 * into the page by `page.evaluate(PROBES)`, so it must close over nothing.
 * @returns {{target: {width: number, height: number}, items: Record<string, {left: number, top: number, width: number, height: number, rotate: number|null, skew: number|null, text: string}>}}
 */
export const PROBES = () => {
  const t = document.getElementById('target').getBoundingClientRect()
  const out = { target: { width: t.width, height: t.height }, items: {} }
  for (const el of document.querySelectorAll('[data-probe]')) {
    const r = el.getBoundingClientRect()
    out.items[el.dataset.probe] = {
      left: r.left - t.left, top: r.top - t.top, width: r.width, height: r.height,
      rotate: el.dataset.rotate === undefined ? null : Number(el.dataset.rotate),
      skew: el.dataset.skew === undefined ? null : Number(el.dataset.skew),
      text: el.textContent.trim(),
    }
  }
  return out
}

// ——— pdf.js side ——————————————————————————————————————————————

/**
 * Runs in the page: parses the PDF, renders every page onto a canvas kept in a
 * hidden host (so Playwright can screenshot it), and returns text items in PDF
 * user space — points, origin bottom-left.
 */
const ANALYZE = async (a) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)) }).promise

  let host = document.getElementById(a.hostId)
  if (!host) {
    host = document.createElement('div')
    host.id = a.hostId
    host.style.cssText = 'position:absolute;left:0;top:0;z-index:99;display:none'
    document.body.appendChild(host)
  }

  /**
   * A destination — an explicit array or a name in the /Dests tree — resolved to
   * plain numbers. It has to be resolved HERE: an unresolved dest carries a pdf.js
   * Ref, which does not survive the trip out of the page, and the page index it
   * names is the whole point of the assertion.
   */
  const destOf = async (dest) => {
    if (dest === null || dest === undefined) return null
    let arr = dest
    if (typeof arr === 'string') arr = await doc.getDestination(arr)
    if (!Array.isArray(arr) || !arr.length) return null
    let index = null
    try { index = await doc.getPageIndex(arr[0]) } catch { index = null }
    return {
      page: index,
      kind: (arr[1] && arr[1].name) || null,
      x: typeof arr[2] === 'number' ? arr[2] : null,
      y: typeof arr[3] === 'number' ? arr[3] : null,
    }
  }

  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const pdfPage = await doc.getPage(p)
    const viewport = pdfPage.getViewport({ scale: a.renderScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    host.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    // The backdrop is painted by us and pdf.js is told to add none, so whatever the
    // page does NOT cover stays this colour — that is how transparency is measured.
    ctx.fillStyle = a.backdrop
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pdfPage.render({ canvasContext: ctx, viewport, background: 'rgba(0,0,0,0)' }).promise

    const content = await pdfPage.getTextContent()
    const items = content.items
      .filter(i => typeof i.str === 'string' && /\S/.test(i.str))
      .map(i => ({
        str: i.str, dir: i.dir, w: i.width, h: i.height,
        x: i.transform[4], y: i.transform[5],
        a: i.transform[0], b: i.transform[1], c: i.transform[2], d: i.transform[3],
      }))

    const annots = []
    for (const an of await pdfPage.getAnnotations()) {
      if (an.subtype !== 'Link') continue
      annots.push({
        url: an.url || an.unsafeUrl || null,
        rect: an.rect,
        dest: await destOf(an.dest),
      })
    }

    const samples = (a.samples || []).map(([fx, fy]) => {
      const px = Math.min(canvas.width - 1, Math.max(0, Math.round(fx * canvas.width)))
      const py = Math.min(canvas.height - 1, Math.max(0, Math.round(fy * canvas.height)))
      return [...ctx.getImageData(px, py, 1, 1).data]
    })

    // The structure tree AS A READER SEES IT. Read back through pdf.js rather than
    // off the bytes on purpose: a tree that only a regex can find is a tree no
    // screen reader will ever walk, and the parent tree has to resolve for this to
    // return anything at all.
    let structTree = null
    try { structTree = await pdfPage.getStructTree() } catch { structTree = null }

    const unscaled = pdfPage.getViewport({ scale: 1 })
    pages.push({ width: unscaled.width, height: unscaled.height, items, annots, samples, structTree })
  }

  // The outline comes out FLAT, each entry carrying its depth. A nested shape would
  // have to be walked by every assertion that wants to say "this title is under that
  // one"; a depth is the same fact in the form the assertions are written in.
  const outline = []
  const descend = async (items, depth) => {
    for (const item of items || []) {
      outline.push({ title: item.title, depth, dest: await destOf(item.dest) })
      await descend(item.items, depth + 1)
    }
  }
  await descend(await doc.getOutline(), 0)

  const named = {}
  const table = await doc.getDestinations()
  for (const name of Object.keys(table || {})) named[name] = await destOf(table[name])

  return { numPages: doc.numPages, pages, outline, named, pageMode: (await doc.getPageMode()) || null }
}

/**
 * The four functions a PDF fixture is written in terms of, bound to one Playwright
 * page and one output directory. They were plain functions closing over the module's
 * `page` and `OUT`; the only change is that the closure is now explicit.
 *
 * The page must have `window.toPdf` (the demo/fixture pages install it) and must be
 * served from an origin where `/node_modules/pdfjs-dist/` resolves — test/serve.mjs
 * mounts the repo root at `/`, which is what makes both true.
 *
 * @param {{page: import('playwright').Page, outDir: string}} env
 * @returns {{makePdf: Function, analyze: Function, shot: Function, standard: Function}}
 */
export function pdfTools({ page, outDir }) {
  fs.mkdirSync(outDir, { recursive: true })

  /**
   * Export `#target` to PDF in the page, write it to `outDir`, and assert its bytes.
   * @param {string} name file stem, also the check's prefix
   * @param {object} [options] passed straight to `window.toPdf`
   * @returns {Promise<{name: string, b64: string, bytes: Buffer, raw: string}>} `raw`
   *   is latin1, so a string index is a byte offset
   */
  async function makePdf(name, options) {
    const b64 = await page.evaluate(async ({ opts, artifactName }) => {
      const blob = await window.toPdf(document.getElementById('target'), opts)
      // Keep the exact capture paired with this PDF in the browser realm. Some
      // callers immediately make a debug twin; a single "last artifact" slot
      // would then make geometry checks inspect the twin rather than these bytes.
      const artifacts = window.__pdfArtifacts || (window.__pdfArtifacts = Object.create(null))
      artifacts[artifactName] = window.__lastPdfArtifact
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return btoa(bin)
    }, { opts: options, artifactName: name })
    const bytes = Buffer.from(b64, 'base64')
    fs.writeFileSync(path.join(outDir, `${name}.pdf`), bytes)
    const raw = bytes.toString('latin1')
    const problems = pdfProblems(raw)
    check(`${name}: xref, /Size and /Length describe the actual bytes`, problems.length === 0,
      problems.slice(0, 3).join('; '))
    return { name, b64, bytes, raw }
  }

  /**
   * Parse and render a PDF with pdf.js inside the page.
   * @param {{name: string, b64: string}} pdf as returned by `makePdf`
   * @param {{hostId?: string, renderScale?: number, backdrop?: string, samples?: [number, number][]}} [opts]
   *   `samples` are fractional page coordinates, returned as RGBA quadruples.
   * @returns {Promise<{numPages: number, pages: object[]}>}
   */
  function analyze(pdf, { hostId, renderScale = 1.5, backdrop = '#ffffff', samples = [] } = {}) {
    return page.evaluate(ANALYZE, { b64: pdf.b64, hostId: hostId || `h-${pdf.name}`, renderScale, backdrop, samples })
  }

  /**
   * Screenshot one of an analyze host's canvases into `outDir`. The host is unhidden
   * for the shot and hidden again after, because a visible canvas at z-index 99 would
   * be in every OTHER fixture's live screenshot.
   * @param {string} hostId the id passed to `analyze`
   * @param {string} file basename inside `outDir`
   * @param {number} index 0-based page
   */
  async function shot(hostId, file, index) {
    await page.evaluate(id => { document.getElementById(id).style.display = 'block' }, hostId)
    await page.locator(`#${hostId} canvas`).nth(index).screenshot({ path: path.join(outDir, file) })
    await page.evaluate(id => { document.getElementById(id).style.display = 'none' }, hostId)
  }

  /**
   * The PDF every fixture gets: the real one plus its red debug twin, both rendered
   * to PNG. Only the real one is analyzed for the caller — the twin exists so a text
   * layer sliding off its raster can be SEEN in out/.
   * @param {string} name
   * @param {object} [pdfOptions]
   * @param {object} [analyzeOptions] `hostId` is forced to `h-<name>`
   * @returns {Promise<{real: object, r: object}>}
   */
  async function standard(name, pdfOptions = {}, analyzeOptions = {}) {
    const real = await makePdf(name, pdfOptions)
    const debug = await makePdf(`${name}-debug`, { ...pdfOptions, debugText: true })
    const r = await analyze(real, { hostId: `h-${name}`, ...analyzeOptions })
    const d = await analyze(debug, { hostId: `h-${name}-debug` })
    for (let p = 0; p < r.numPages; p++) await shot(`h-${name}`, p ? `${name}-p${p + 1}.png` : `${name}.png`, p)
    for (let p = 0; p < d.numPages; p++) await shot(`h-${name}-debug`, p ? `${name}-debug-p${p + 1}.png` : `${name}-debug.png`, p)
    return { real, r }
  }

  return { makePdf, analyze, shot, standard }
}

/**
 * Clear the FILES in a directory, leaving subdirectories alone: a full run owns its
 * artifacts so stale ones from an earlier naming scheme cannot be read as this run's
 * output, but out/vector/ belongs to another suite and must survive this one.
 * @param {string} dir
 */
export function clearArtifacts(dir) {
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) fs.rmSync(path.join(dir, entry.name), { force: true })
    }
  }
  fs.mkdirSync(dir, { recursive: true })
}
