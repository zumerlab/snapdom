/**
 * Assertive verification suite for @zumer/snapdom-pdf.
 *
 * Each fixture in test/fixtures/ is exported to PDF inside a real Chromium, parsed
 * back with pdf.js, and asserted against geometry independently read from either the
 * page or the canonical final SVG that supplies the raster. Nothing here is
 * informational: a failed check sets process.exitCode = 1 and is repeated in the
 * final summary.
 *
 *   npm run verify                       every fixture
 *   node test/verify.mjs unicode         one fixture (prefix match, several allowed)
 *
 * One fixture never loads a page: `paginate` is a pure-Node unit block over the
 * pagination invariants. The browser is still launched for it — the harness does
 * that unconditionally. One fixture never uses pdf.js's text items: `align` reads
 * the uncompressed content stream instead, because pdf.js merges adjacent runs on a
 * baseline and a per-word sweep needs them apart. `raster` is the pixel-independent
 * cross-check: layout geometry (source DOM or canonical artifact DOM) cannot reveal
 * a codec/resampling/placement error in the actual bitmap, so it scans the PIXELS.
 * Every PDF produced anywhere also goes through pdfProblems(),
 * which reads the BYTES — pdf.js repairs a broken xref and a wrong /Length silently,
 * and Acrobat does not.
 *
 * Artifacts land in out/: `<fixture>.png` is the PDF as pdf.js renders it, and
 * `<fixture>-debug.png` is the same PDF with the text layer painted red instead of
 * invisible. The debug render is still the fastest way to SEE a text layer sliding
 * off its raster; `raster` is the fixture that makes it a number.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, snapdomBuildProblem } from './serve.mjs'
import { paginate, repeatsAt, headerReserve } from '../src/paginate.js'
// Everything generic — the assertion log, the Chromium bootstrap, the pdf.js
// analyzer, the string helpers — lives in harness.mjs so the vector suite reports
// the same way this one does. What stays here is what is about THIS path.
import {
  PT, results, setFixture, check, near, fmt, angleDelta, report,
  strip, pageText, allText, occurrences, present, absent, exactlyOnce,
  pdfProblems, loadChromium, instrument, openFixture, livePixels as livePixelsOf,
  PROBES, pdfTools, clearArtifacts,
} from './harness.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out')

const args = process.argv.slice(2).filter(a => !a.startsWith('-'))
// A full run owns the FILES in out/, so stale artifacts from an earlier naming
// scheme cannot be read as this run's output. A filtered run keeps the rest of the
// gallery. Subdirectories are left alone: out/vector/ belongs to the vector harness,
// which this suite knows nothing about and must not delete on its way past.
if (!args.length) clearArtifacts(OUT)
fs.mkdirSync(OUT, { recursive: true })

const chromium = await loadChromium(ROOT)

/**
 * The run shape index.js consumes, exactly. A field renamed in text-layer.js
 * surfaces everywhere else as a garbled geometry failure three layers away.
 */
const RUN_KEYS = ['ascent', 'color', 'fk', 'font', 'height', 'matrix', 'naturalWidth',
  'originX', 'originY', 'rtl', 'size', 'text', 'tracking', 'width']

// ——— assertions ———————————————————————————————————————————————
//
// check/near/fmt/results and the text-layer string helpers are harness.mjs's; so is
// pdfProblems, which reads the BYTES because pdf.js repairs a broken xref and a wrong
// /Length silently and Acrobat does not.

// ——— content stream ————————————————————————————————————————————
//
// pdf.js merges adjacent runs that share a baseline, so two words come back as one
// item with one origin and one width — which is fine for a probe that owns its
// baseline, and useless for a sweep that wants to say something about every word on
// a page. The operators say what was actually written. Reading them is the only way
// to keep the one-run-per-word correspondence, and it needs `compress: false`.

/**
 * WinAnsi's 0x80–0x9F block, the one region where it is not Latin-1 — which is
 * where the curly quotes, the dashes and the ellipsis of real copy live. Restated
 * from the PDF spec rather than imported from pdf-writer.js, so a wrong entry there
 * shows up as a text divergence instead of cancelling out against itself.
 */
const WINANSI_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

/** `BT 3 Tr /F0 12.000 Tf 100.00 Tz a b c d x y Tm (word) Tj ET` — one per run. */
const RUN_OP = /BT [03] Tr \/(\S+) ([\d.]+) Tf ([\d.]+) Tz (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm (\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f]*>) Tj ET/g

/** null for a hex string: those are glyph ids in the Type0 font, not text bytes. */
function pdfLiteral(s) {
  if (s.startsWith('<')) return null
  let out = ''
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i] === '\\' ? s[++i] : s[i]
    out += WINANSI_HIGH[c.charCodeAt(0)] || c
  }
  return out
}

function streamRuns(raw) {
  const runs = []
  for (const m of raw.matchAll(RUN_OP)) {
    runs.push({
      font: m[1], size: +m[2], tz: +m[3],
      a: +m[4], b: +m[5], c: +m[6], d: +m[7], x: +m[8], y: +m[9],
      text: pdfLiteral(m[10]),
    })
  }
  return runs
}

/** /F0 → 'Helvetica-Bold': the substitute the FILE names, not one this suite predicts. */
function fontResources(raw) {
  const byId = new Map()
  for (const m of raw.matchAll(/(?:^|\n)(\d+) 0 obj\n<< \/Type \/Font \/Subtype \/Type1 \/BaseFont \/([\w-]+)/g)) {
    byId.set(m[1], m[2])
  }
  const res = new Map()
  for (const dict of raw.matchAll(/\/Font << ([^>]*)>>/g)) {
    for (const m of dict[1].matchAll(/\/(\S+) (\d+) 0 R/g)) res.set(m[1], byId.get(m[2]))
  }
  return res
}

/** A base-14 name as a CSS font shorthand, so a canvas can measure the same face. */
const canvasFont = (base14, size) =>
  `${/Italic|Oblique/.test(base14) ? 'italic ' : ''}${/Bold/.test(base14) ? 'bold ' : ''}` +
  `${size}px ${base14.startsWith('Courier') ? 'Courier' : base14.startsWith('Times') ? 'Times' : 'Helvetica'}`

const uprightRun = (r) => r.a === 1 && r.b === 0 && r.c === 0 && r.d === 1

// ——— harness ——————————————————————————————————————————————————
//
// PROBES (every [data-probe] box in CSS px from #target) and the pdf.js analyzer are
// harness.mjs's. makePdf/analyze/shot/standard closed over `page` and `OUT`; that
// closure is now explicit, and nothing else about them changed.

// Every fixture and its pixel oracle import the same explicitly selected core.
const buildProblem = snapdomBuildProblem()
if (buildProblem) console.error(`\n[verify] ${buildProblem}\n`)

const server = await serve(0)
const base = `http://localhost:${server.port}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const { log: pageLog, errors: pageErrors } = instrument(page)
const { makePdf, analyze, shot, standard } = pdfTools({ page, outDir: OUT })

/**
 * Independently measure word geometry from the exact final SVG that produced the
 * most recent PDF. `_pdf.js` records the capture result, not any private product
 * measurement. This mounts that immutable artifact with the same sandbox/CSP as
 * index.js, then delegates to each fixture's deliberately independent Range +
 * zero-height-baseline oracle. PDF positions still come from parsed `Tm` bytes;
 * no text-layer function or run data is reused on the expected side.
 */
async function canonicalArtifactWords(name) {
  return page.evaluate(async (artifactName) => {
    const artifact = window.__pdfArtifacts?.[artifactName]
    if (!artifact?.url || !artifact?.meta || typeof window.__words !== 'function') {
      throw new Error('the fixture did not retain a canonical PDF artifact/word oracle')
    }
    const comma = artifact.url.indexOf(',')
    if (comma < 0) throw new Error('the retained SVG data URL is malformed')
    const payload = artifact.url.slice(comma + 1)
    const svgText = /;base64/i.test(artifact.url.slice(0, comma))
      ? new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0)))
      : decodeURIComponent(payload)
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) throw new Error('the retained SVG does not parse')

    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.style.cssText =
      `position:fixed!important;left:0!important;top:0!important;opacity:0!important;` +
      `width:${artifact.meta.vbW}px!important;height:${artifact.meta.vbH}px!important;` +
      'display:block!important;border:0!important;pointer-events:none!important;' +
      'z-index:-2147483648!important;'
    const loaded = new Promise((resolve, reject) => {
      frame.onload = resolve
      frame.onerror = () => reject(new Error('canonical artifact frame did not load'))
    })
    frame.srcdoc = '<!doctype html><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
      'style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:; ' +
      'connect-src \'none\'; object-src \'none\'; frame-src \'none\'">' +
      '<style>html,body{margin:0;padding:0;overflow:visible}</style><body></body>'
    document.body.appendChild(frame)
    try {
      await loaded
      const doc = frame.contentDocument
      const svg = doc.importNode(parsed.documentElement, true)
      svg.style.cssText = `display:block;width:${artifact.meta.vbW}px;` +
        `height:${artifact.meta.vbH}px;max-width:none;max-height:none;overflow:visible`
      doc.body.appendChild(svg)
      if (doc.fonts?.ready) await doc.fonts.ready
      const fo = svg.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'foreignObject')[0] ||
        svg.querySelector('foreignObject')
      const container = fo && [...fo.children].find(el => el.localName === 'div')
      const root = container?.firstElementChild
      if (!root) throw new Error('the retained SVG has no measurable capture root')

      const measured = window.__words(root)
      const rootRect = root.getBoundingClientRect()
      const svgRect = svg.getBoundingClientRect()
      const dx = rootRect.left - (svgRect.left + artifact.meta.contentX)
      const dy = rootRect.top - (svgRect.top + artifact.meta.contentY)
      for (const word of measured.words) {
        if (Number.isFinite(word.left)) { word.left += dx; word.top += dy }
        if (word.rects) for (const rect of word.rects) {
          rect.left += dx
          rect.top += dy
        }
      }
      measured.target = { width: artifact.meta.w0, height: artifact.meta.h0 }
      return measured
    } finally {
      frame.remove()
    }
  }, name)
}

/**
 * Where Chromium actually paints something, as an x offset into an element's own
 * screenshot: the leftmost inked column of its middle band. A <select> insets its
 * value past the content box by a few px that no layout metric reports, so this is
 * the only honest expectation for that run's origin.
 */
async function inkLeft(selector) {
  const png = (await page.locator(selector).screenshot()).toString('base64')
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    for (let x = 0; x < c.width; x++) {
      for (let y = Math.floor(c.height * 0.25); y < Math.ceil(c.height * 0.75); y++) {
        const p = (y * c.width + x) * 4
        if (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114 < 110) return x
      }
    }
    return -1
  }, png)
}

// ——— ink ———————————————————————————————————————————————————————
//
// The `raster` fixture's instrument. Three images of the same page — Chromium's own
// paint, snapdom's capture, and the finished PDF as pdf.js renders it back — are
// scanned by ONE pair of functions, columns then rows, in one coordinate space (CSS
// px from #target's border box). A bias in the scan then cancels out of every
// comparison instead of being read as a defect, and the only numbers left are the
// differences between the three.

/** Luma below this is ink. The fixture asserts the result over 64…192, so it is a
 *  midpoint and not a tuned constant. */
const INK_DARK = 128
/** Blank columns that end a word. Pinned against the page's own two gap populations. */
const INK_GAP = 12
/**
 * How far above and below a line's own box BOTH scans look. A displaced capture has
 * to be able to report ink outside the box the DOM drew, or the band edge clips it
 * and the displacement reads as smaller than it is — and that is as true of the
 * column scan as of the row scan, because a column is inked by whatever rows the
 * window happens to contain. Measured, with the column band clipped at the box: move
 * the capture AND the layer down together by 2px, which is no relative error at all
 * and must show up as nothing but the layer leaving the DOM, and the check that names
 * the layer's ORIGIN goes red at 2.000px on "jumpy" — the tail of the j and the y is
 * inside the band in one image and below it in the other, so the word's first inked
 * COLUMN moves and a purely vertical shift is reported on the horizontal axis. Padded,
 * that check drops to its own floor (0.001) and the reds are the vertical ones it
 * should be. The fixture
 * asserts its lines are more than 2×this apart, so neither padded window can reach the
 * next line's ink.
 */
const INK_PAD = 6

const INK = async (a) => {
  const target = document.getElementById('target')
  const rect = target.getBoundingClientRect()

  /**
   * Contiguous runs of inked columns inside one horizontal band, left/right in CSS
   * px. `gapPx` is the only thing the scan is told about layout: a shorter blank
   * run is inside a word, a longer one is between two. The band is padded exactly as
   * the row window is, and for the same reason: a column that is inked only by the
   * bottom of a descender has to stay inked when the image it came from sits a row or
   * two lower, or that vertical displacement is read off as a horizontal one.
   * Clamped to the canvas on both edges — getImageData past it returns transparent
   * black, whose luma is 0, and every pixel outside the image would read as ink.
   */
  const groups = (ctx, s, band, threshold, gapPx, canvasW, canvasH) => {
    const y0 = Math.max(0, Math.floor((band.top - a.pad) * s))
    const h = Math.max(1, Math.min(canvasH, Math.ceil((band.bottom + a.pad) * s)) - y0)
    const w = Math.min(canvasW, Math.floor(rect.width * s))
    const d = ctx.getImageData(0, y0, w, h).data
    const gap = Math.max(1, Math.round(gapPx * s))
    const out = []
    let first = -1, last = -1, blank = 0
    for (let px = 0; px < w; px++) {
      let ink = false
      for (let py = 0; py < h && !ink; py++) {
        const i = (py * w + px) * 4
        // Rec.601 luma. Everything the fixture paints is neutral, so the weighting
        // cannot matter; it is written down so `threshold` means one fixed thing.
        if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < threshold) ink = true
      }
      if (ink) { if (first < 0) first = px; last = px; blank = 0 }
      else if (first >= 0 && ++blank >= gap) { out.push({ left: first / s, right: (last + 1) / s }); first = -1 }
    }
    // The right edge is the column AFTER the last inked one, so a one-column mark
    // has width 1/s rather than 0.
    if (first >= 0) out.push({ left: first / s, right: (last + 1) / s })
    return out
  }

  /**
   * The same scan turned 90°: the first and last inked ROW inside ONE group's own
   * columns, top/bottom in CSS px. Restricted to the group's columns because a whole
   * line's rows are the tallest glyph on it and say nothing about any single word;
   * padded past the band, like the column scan above and for the same reason, because
   * a capture displaced downwards must be able to report ink below the box the DOM
   * drew, which is the entire point of asking.
   */
  const rowsOf = (ctx, s, band, g, threshold, canvasW, canvasH) => {
    const y0 = Math.max(0, Math.floor((band.top - a.pad) * s))
    const h = Math.max(1, Math.min(canvasH, Math.ceil((band.bottom + a.pad) * s)) - y0)
    const x0 = Math.max(0, Math.floor(g.left * s))
    const w = Math.max(1, Math.min(canvasW, Math.ceil(g.right * s)) - x0)
    const d = ctx.getImageData(x0, y0, w, h).data
    let first = -1, last = -1
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4
        if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < threshold) { if (first < 0) first = py; last = py; break }
      }
    }
    // A group exists only because `groups` found ink in this band at this threshold,
    // inside these columns, and this window contains that band — so `first` is never
    // -1 and the caller never has to deal with an empty extent.
    return { top: (y0 + first) / s, bottom: (y0 + last + 1) / s, clearT: first / s, clearB: (h - 1 - last) / s }
  }

  /** Both scans of one image, so a group carries its own four edges. */
  const boxes = (ctx, s, band, threshold, canvasW, canvasH) =>
    groups(ctx, s, band, threshold, a.gap, canvasW, canvasH)
      .map(g => Object.assign(g, rowsOf(ctx, s, band, g, threshold, canvasW, canvasH)))

  const canvasOf = (img) => {
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    c.getContext('2d').drawImage(img, 0, 0)
    return c
  }

  // (1) What Chromium paints. Ground truth for where a glyph's ink sits inside its
  // advance box — the side bearing, which is the font's business and not ours.
  const shot = new Image()
  shot.src = `data:image/png;base64,${a.live}`
  await shot.decode()
  const lc = canvasOf(shot)

  // (2) snapdom, called exactly as index.js calls it: the outerShadows default it
  // sets before spreading the caller's options, then the three it forces after.
  // The SAME engine the fixture captured with — the selected core mount.
  // A second renderer here would compare this suite's ground truth against pixels
  // no fixture ever produced.
  const { snapdom } = await import('/snapdom/dist/snapdom.mjs')
  const res = await snapdom(target, { outerShadows: false, scale: a.scale, dpr: 1, outerTransforms: true })
  const rc = await res.toCanvas()
  // Scale from the canvas against the viewBox, never from the option: those agree
  // only while nothing bleeds past the element box, and whether anything bleeds is
  // exactly what the fixture is checking rather than assuming.
  const comma = res.url.indexOf(',')
  const head = res.url.slice(comma + 1, comma + 1024)
  const decoded = res.url.slice(0, comma).includes(';base64')
    ? atob(head.replace(/[^A-Za-z0-9+/]/g, '').slice(0, head.length - (head.length % 4)))
    : head.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(decoded)

  // (3) The pixels that ship: the page of the finished PDF, on the very canvas that
  // becomes out/raster.png.
  const pc = document.querySelector(`#${a.hostId} canvas`)

  const liveS = lc.width / rect.width
  const rasterS = vb ? rc.width / parseFloat(vb[1]) : 0
  const pdfS = pc ? pc.width / a.pageCssW : 0
  const out = {
    liveS, rasterS, pdfS,
    vb: vb ? [parseFloat(vb[1]), parseFloat(vb[2])] : null,
    rect: { width: rect.width, height: rect.height },
    bands: [],
  }
  for (const band of a.bands) {
    // Letter-level groups, off Chromium's paint: they describe the page's own
    // layout, which is what the word gap has to be pinned against. Taking them off
    // the raster instead would make a raster defect look like a bad constant. One
    // set per threshold, because the word gap is certified at every threshold the
    // comparisons run at and a fringe that counts as ink at 192 does not at 64.
    const per = { letters: {} }
    for (const th of a.thresholds) {
      per.letters[th] = groups(lc.getContext('2d'), liveS, band, th, 1 / liveS, lc.width, lc.height)
      per[th] = {
        live: boxes(lc.getContext('2d'), liveS, band, th, lc.width, lc.height),
        raster: boxes(rc.getContext('2d'), rasterS, band, th, rc.width, rc.height),
        pdf: pc ? boxes(pc.getContext('2d'), pdfS, band, th, pc.width, pc.height) : [],
      }
    }
    out.bands.push(per)
  }
  return out
}

/**
 * Chromium's own pixels at the same 2× the raster is captured at, from harness.mjs's
 * livePixels — bound here to this suite's server and to the SAME viewport the shared
 * page uses, since a different viewport is a different layout and then the two images
 * are of two different documents.
 * @param {string} fixture fixture stem under test/fixtures/
 * @param {string} selector what to screenshot
 * @returns {Promise<string>} base64 PNG
 */
const livePixels = (fixture, selector) =>
  livePixelsOf(browser, `${base}/test/fixtures/${fixture}.html`, selector,
    { viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })

// ——— geometry helpers —————————————————————————————————————————
// Every geometric fixture runs at page:'fit', where the PDF page IS the element box
// scaled by PT — so a point in PDF user space maps back to CSS px with no guessing.

const toCssX = (item) => item.x / PT
const toCssY = (item, pageH) => (pageH - item.y) / PT

const itemFor = (r, text, pageIndex = 0) =>
  r.pages[pageIndex].items.find(i => strip(i.str) === strip(text)) || null

/** The item a probe's text STARTS, merged neighbours and all. Its transform is the
 *  first glyph's, which is the probe's own origin. */
const itemStartingWith = (r, text, pageIndex = 0) =>
  r.pages[pageIndex].items.find(i => strip(i.str).startsWith(strip(text))) || null

/**
 * pdf.js flushes a text item on the VERTICAL advance between lines (appendEOL), not
 * on Tf — a Tf whose font and size are unchanged returns without flushing. So the
 * invariant every probe below rests on is: a probe must be the only run on its
 * baseline, or it merges with its neighbours into one item. Say so when it happens,
 * because "is not its own run" names the wrong cause.
 */
function needItem(r, label, text, pageIndex = 0) {
  const items = r.pages[pageIndex].items
  const item = itemFor(r, text, pageIndex)
  const merged = item ? null : items.find(i => strip(i.str).includes(strip(text)))
  check(`${label}: "${text}" is its own run`, !!item,
    merged ? `merged with its baseline neighbours into "${merged.str}"` : '')
  return item
}

function angleOf(item) {
  return Math.atan2(item.b, item.a) * 180 / Math.PI
}

/** Untransformed run: origin, baseline and advance all pinned to the DOM box. */
function checkPlacement(label, item, box, pageH, tolX = 2) {
  const x = toCssX(item)
  const y = toCssY(item, pageH)
  near(`${label}: origin x`, x, box.left, tolX, 'px')
  check(`${label}: baseline sits in the line box`,
    y >= box.top + box.height * 0.45 && y <= box.top + box.height * 1.15,
    `baseline ${fmt(y)}px, box ${fmt(box.top)}…${fmt(box.top + box.height)}px`)
  near(`${label}: advance width`, item.w / PT, box.width, Math.max(2, box.width * 0.08), 'px')
}

/**
 * Transformed run: an affine map sends the box's interior inside the AABB the DOM
 * reports, so the origin must land in it. 2px of slack absorbs baseline rounding.
 */
function checkInside(label, item, box, pageH, slack = 2) {
  const x = toCssX(item)
  const y = toCssY(item, pageH)
  check(`${label}: origin inside the painted box`,
    x >= box.left - slack && x <= box.left + box.width + slack &&
    y >= box.top - slack && y <= box.top + box.height + slack,
    `origin ${fmt(x)},${fmt(y)} vs box ${fmt(box.left)},${fmt(box.top)} ${fmt(box.width)}×${fmt(box.height)}`)
}

/**
 * pdf.js returns RTL items in visual order, so either orientation counts as found —
 * but the item must be tagged rtl, which only happens if the layer emitted logical
 * order rather than pre-shaped presentation forms.
 */
function presentBidi(r, word, label) {
  const reversed = [...word].reverse().join('')
  const item = r.pages.flatMap(p => p.items).find(i => strip(i.str) === word || strip(i.str) === reversed)
  if (check(`${label} is in the text layer`, !!item)) {
    check(`${label} run is tagged rtl`, item.dir === 'rtl', String(item.dir))
  }
  return item
}

function noDropWarning() {
  const dropped = pageLog.filter(l => /left out of the text layer/i.test(l))
  check('no run was dropped from the text layer', dropped.length === 0, dropped.join(' | '))
}

// ——— fixtures —————————————————————————————————————————————————

const FIXTURES = [
  {
    // The exporter is a snapdom PLUGIN, and every other fixture reaches it through
    // test/fixtures/_pdf.js, which folds capture + export back into one call. That
    // shim is convenient and it is also a blindfold: it can keep passing while the
    // registration path, the helper names, the option split and the per-capture
    // bridge are all wrong. This fixture uses the shipped API and nothing else.
    name: 'plugin',
    async run() {
      const out = await page.evaluate(async () => {
        const snapdom = window.__snapdom
        const pdf = window.__pdf
        const target = document.getElementById('target')
        const other = document.getElementById('other')
        const shot = (el, o = {}) => snapdom(el, { scale: 1, dpr: 1, ...o })
        const raw = async (blob) => new TextDecoder('latin1').decode(await blob.arrayBuffer())
        const media = async (blob) => {
          const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(await raw(blob))
          return m ? [parseFloat(m[1]), parseFloat(m[2])] : null
        }
        const r = {}

        // —— an unregistered capture must not grow the helper ——
        r.bareHasToPdf = typeof (await shot(target)).toPdf === 'function'

        // —— per-capture registration (local-first) ——
        const local = await shot(target, { plugins: [pdf()] })
        r.localToPdf = typeof local.toPdf
        const b1 = await local.toPdf({ page: 'fit' })
        r.blobType = b1.type
        r.head = (await raw(b1)).slice(0, 4)
        // Same capture, same options, the other spelling: `to(name)` is the generic
        // door and `toPdf` is the sugar the engine hangs off it.
        r.viaToSameSize = (await local.to('pdf', { page: 'fit' })).size === b1.size

        // —— global registration, and the core exports it must not disturb ——
        snapdom.plugins(pdf())
        const g = await shot(target)
        r.globalToPdf = typeof g.toPdf === 'function'
        r.coreCanvas = (await g.toCanvas()).width
        // The engine's own default for toBlob is the svg, not a raster — a plugin
        // that registered an export must not have changed that.
        r.coreBlob = (await g.toBlob()).type
        r.corePngTag = (await g.toPng()).tagName

        // —— two captures in flight at once ——
        // page:'fit' makes the MediaBox the element's own box, so a bridge that let
        // one capture read the other's measurement shows up as a swapped page size.
        const [ca, cb] = await Promise.all([shot(target), shot(other)])
        const [pa, pb] = await Promise.all([ca.toPdf({ page: 'fit' }), cb.toPdf({ page: 'fit' })])
        r.mediaA = await media(pa)
        r.mediaB = await media(pb)
        r.rectA = target.getBoundingClientRect()
        r.rectB = other.getBoundingClientRect()

        // —— a download happens only when asked for ——
        window.__clicks.length = 0
        await (await shot(target)).toPdf({ page: 'fit' })
        r.clicksWithoutOption = window.__clicks.slice()
        await (await shot(target)).toPdf({ page: 'fit', download: 'plug' })
        r.clicksWithOption = window.__clicks.slice()

        // —— an option that is decided at capture time is reported, not obeyed ——
        window.__warnings.length = 0
        await (await shot(target)).toPdf({ page: 'fit', shadow: false })
        r.captureTimeWarn = window.__warnings.join(' | ')

        // —— the names that would have collided with the engine's own ——
        window.__warnings.length = 0
        await (await shot(target)).toPdf({ page: 'fit', filename: 'x.pdf', compress: false, scale: 3 })
        r.collisionWarn = window.__warnings.join(' | ')

        // —— capture scale is the engine's, and must not move the page ——
        window.__warnings.length = 0
        const s1 = await (await shot(target, { scale: 1 })).toPdf({ page: 'fit' })
        const s3 = await (await shot(target, { scale: 3 })).toPdf({ page: 'fit' })
        r.s1 = { media: await media(s1), size: s1.size }
        r.s3 = { media: await media(s3), size: s3.size }

        // —— options baked into the factory reach the export ——
        const preset = await snapdom(target, { scale: 1, dpr: 1, plugins: [pdf({ page: 'a5', margin: 20 })] })
        r.presetMedia = await media(await preset.toPdf())

        // beforeExport receives the effective options after normalization. It can
        // override a caller or remove an explicit key to restore factory defaults.
        let exportNumber = 0
        const steered = await shot(target, { plugins: [pdf({ page: 'a5' }), {
          name: 'steer-pdf-export',
          beforeExport(_ctx, { format, options }) {
            if (format !== 'pdf') return
            if (exportNumber++ === 0) options.page = 'letter'
            else delete options.page
            options.image = false
            options.lang = 'es'
            options.watermark = { text: 'HOOKWATERMARK' }
          },
        }] })
        const steeredBlob = await steered.toPdf({ page: 'a4', deflate: false })
        const steeredRaw = await raw(steeredBlob)
        r.steered = {
          media: await media(steeredBlob),
          removedMedia: await media(await steered.toPdf({ page: 'a4' })),
          language: steeredRaw.includes('/Lang (es)'),
          watermark: steeredRaw.includes('HOOKWATERMARK'),
          image: /\/Subtype \/Image/.test(steeredRaw),
        }

        // v3's stage resolver must keep the render when another plugin needs only
        // the clone. Its experimental bitmap engine must keep an SVG for PDF text.
        const staged = await shot(target, {
          engine: 'html-in-canvas',
          plugins: [pdf(), { name: 'clone-only-peer', needs: 'clone' }],
        })
        r.renderStage = staged.needs
        r.renderArtifact = staged.url.startsWith('data:image/svg+xml')
        r.renderPdf = (await staged.toPdf({ image: false })).type

        // Reuse exactly one plugin/options identity so v3 may memoize or diff.
        // Each result must still export the instant it captured after live edits.
        const repeatedTarget = document.createElement('div')
        repeatedTarget.style.cssText = 'width:240px;padding:8px;font:16px Arial'
        repeatedTarget.textContent = 'BEFOREBURSTCHANGE'
        document.body.appendChild(repeatedTarget)
        const repeatOptions = { scale: 1, dpr: 1, plugins: [pdf()] }
        const first = await snapdom(repeatedTarget, repeatOptions)
        const second = await snapdom(repeatedTarget, repeatOptions)
        repeatedTarget.textContent = 'AFTERBURSTCHANGE'
        const third = await snapdom(repeatedTarget, repeatOptions)
        const exportText = { image: false, debugText: true, tagged: false, deflate: false }
        const repeatedRaws = await Promise.all([first, second, third].map(async result =>
          raw(await result.toPdf(exportText))))
        r.repeated = repeatedRaws.map((value, index) =>
          value.includes(index < 2 ? 'BEFOREBURSTCHANGE' : 'AFTERBURSTCHANGE') &&
          !value.includes(index < 2 ? 'AFTERBURSTCHANGE' : 'BEFOREBURSTCHANGE'))
        repeatedTarget.remove()

        {
          const sizingTarget = document.createElement('div')
          sizingTarget.style.cssText = 'width:200px;height:80px;background:#2563eb'
          document.body.appendChild(sizingTarget)
          r.absoluteSizes = []
          for (const size of [{ width: 400 }, { height: 160 }, { width: 400, height: 160 }]) {
            const sizedShot = await shot(sizingTarget, { ...size, scale: 3, plugins: [pdf()] })
            const sizedRaw = await raw(await sizedShot.toPdf({ text: false, codec: 'flate' }))
            const dimensions = /\/Subtype \/Image[\s\S]*?\/Width (\d+) \/Height (\d+)/.exec(sizedRaw)
            r.absoluteSizes.push(dimensions ? [+dimensions[1], +dimensions[2]] : null)
          }
          sizingTarget.remove()

          const band = document.createElement('div')
          band.style.cssText = 'width:200px;height:50px'
          band.innerHTML = '<span class="private-band">SECRET</span><span>PUBLIC</span>'
          document.body.appendChild(band)
          let sawBand = false
          let bandHasSecret = false
          const bandShot = await shot(target, {
            exclude: [node => node.classList?.contains('private-band')], excludeMode: 'remove',
            plugins: [pdf(), {
              name: 'observe-band-exclusions',
              afterClone(ctx) {
                if (ctx.element !== band) return
                sawBand = true
                bandHasSecret = ctx.clone.textContent.includes('SECRET')
              },
            }],
          })
          await bandShot.toPdf({ page: 'a4', header: band, codec: 'flate' })
          r.bandExclusions = { sawBand, bandHasSecret }
          band.remove()
        }

        // —— final-artifact privacy + image:false's zero-raster promise ——
        if (!customElements.get('pdf-connect-probe')) {
          customElements.define('pdf-connect-probe', class extends HTMLElement {
            connectedCallback() { window.__pdfProbeConnects = (window.__pdfProbeConnects || 0) + 1 }
          })
        }
        window.__pdfProbeConnects = 0
        const privacy = document.createElement('div')
        privacy.style.cssText = 'width:320px;padding:8px'
        privacy.innerHTML = `
          <p>PUBLICVISIBLE</p>
          <p class="selector-secret">SELECTORSECRET</p>
          <p data-capture="exclude">DATAATTRIBUTESECRET</p>
          <p class="predicate-secret">PREDICATESECRET</p>
          <p class="resolve-secret">RESOLVESECRET</p>
          <p class="clone-secret">CLONESECRET</p>
          <p>FINALBEFORE</p>
          <a class="selector-secret" href="https://snapdom.dev/SELECTORLINKSECRET">SECRET LINK</a>
          <pdf-connect-probe>CONNECTEDSAFE</pdf-connect-probe>`
        document.body.appendChild(privacy)
        const redactor = {
          name: 'privacy-redactor',
          resolveNode(node) {
            if (!node.classList?.contains('resolve-secret')) return undefined
            const replacement = document.createElement('p')
            replacement.textContent = 'RESOLVEDPUBLIC'
            return replacement
          },
          afterClone(ctx) {
            const node = ctx.clone?.querySelector('.clone-secret')
            if (node) node.textContent = 'CLONEREDACTED'
          },
          // Registered after pdf(): only the canonical post-hook URL can see this.
          afterRender(ctx) { ctx.dataURL = ctx.dataURL.replace('FINALBEFORE', 'FINALAFTER') },
        }
        const privateShot = await snapdom(privacy, {
          scale: 1, dpr: 1,
          exclude: ['.selector-secret', node => node.classList?.contains('predicate-secret')],
          excludeMode: 'remove',
          plugins: [pdf({ outline: false }), redactor],
        })
        const connectedBeforePdf = window.__pdfProbeConnects
        let decodeCalls = 0
        let blobCalls = 0
        const realDecode = Image.prototype.decode
        const realToBlob = HTMLCanvasElement.prototype.toBlob
        Image.prototype.decode = function (...args) { decodeCalls++; return realDecode.apply(this, args) }
        HTMLCanvasElement.prototype.toBlob = function (...args) { blobCalls++; return realToBlob.apply(this, args) }
        let privateRaw
        try {
          privateRaw = await raw(await privateShot.toPdf({
            page: 'fit', image: false, debugText: true, deflate: false, tagged: false,
          }))
        } finally {
          Image.prototype.decode = realDecode
          HTMLCanvasElement.prototype.toBlob = realToBlob
        }
        r.privacy = {
          public: ['PUBLICVISIBLE', 'RESOLVEDPUBLIC', 'CLONEREDACTED', 'FINALAFTER']
            .every(s => privateRaw.includes(s)),
          secret: ['SELECTORSECRET', 'DATAATTRIBUTESECRET', 'PREDICATESECRET', 'RESOLVESECRET',
            'CLONESECRET', 'FINALBEFORE', 'SELECTORLINKSECRET'].some(s => privateRaw.includes(s)),
          xobject: /\/Subtype \/Image|\/XObject/.test(privateRaw),
          decodeCalls, blobCalls,
          reconnects: window.__pdfProbeConnects - connectedBeforePdf,
        }
        privacy.remove()

        // —— factory defaults are a value snapshot, including nested containers ——
        const stableDefaults = {
          page: [310, 420], margin: 12,
          watermark: { text: 'ORIGINALDEFAULTSTAMP', opacity: 0.2 },
        }
        const stablePlugin = pdf(stableDefaults)
        stableDefaults.page[0] = 700
        stableDefaults.watermark.text = 'MUTATEDDEFAULTSTAMP'
        const stable = await snapdom(target, { scale: 1, dpr: 1, plugins: [stablePlugin] })
        const stableBlob = await stable.toPdf({ image: false, deflate: false, tagged: false })
        const stableRaw = await raw(stableBlob)
        r.defaultsSnapshot = {
          media: await media(stableBlob),
          original: stableRaw.includes('ORIGINALDEFAULTSTAMP'),
          mutated: stableRaw.includes('MUTATEDDEFAULTSTAMP'),
        }

        // —— a post-render viewBox rewrite fails before any raster decode ——
        const windowing = {
          name: 'window-final-svg',
          afterRender(ctx) {
            const comma = ctx.dataURL.indexOf(',')
            const svg = decodeURIComponent(ctx.dataURL.slice(comma + 1))
              .replace(/viewBox="[^"]+"/, 'viewBox="0 0 10 10"')
            ctx.dataURL = ctx.dataURL.slice(0, comma + 1) + encodeURIComponent(svg)
          },
        }
        const windowed = await snapdom(target, {
          scale: 1, dpr: 1, plugins: [pdf({ outline: false }), windowing],
        })
        let windowDecodeCalls = 0
        Image.prototype.decode = function (...args) { windowDecodeCalls++; return realDecode.apply(this, args) }
        try {
          await windowed.toPdf({ page: 'fit' })
          r.windowError = ''
        } catch (error) {
          r.windowError = String(error?.message || error)
        } finally {
          Image.prototype.decode = realDecode
        }
        r.windowDecodeCalls = windowDecodeCalls

        const mutateFinal = (name, transform) => ({
          name,
          afterRender(ctx) {
            const comma = ctx.dataURL.indexOf(',')
            const svg = transform(decodeURIComponent(ctx.dataURL.slice(comma + 1)))
            ctx.dataURL = ctx.dataURL.slice(0, comma + 1) + encodeURIComponent(svg)
          },
        })
        const opacityShot = await snapdom(target, {
          scale: 1, dpr: 1,
          plugins: [pdf({ outline: false }), mutateFinal('hide-final-svg',
            svg => svg.replace('<svg ', '<svg style="opacity:0" '))],
        })
        const aspectShot = await snapdom(target, {
          scale: 1, dpr: 1,
          plugins: [pdf({ outline: false }), mutateFinal('reshape-final-svg',
            svg => svg.replace(/(<svg[^>]*\bwidth=")([\d.]+)/,
              (_m, start, width) => start + (Number(width) + 17)))],
        })
        const mutationErrors = []
        let mutationDecodeCalls = 0
        Image.prototype.decode = function (...args) { mutationDecodeCalls++; return realDecode.apply(this, args) }
        try {
          for (const candidate of [opacityShot, aspectShot]) {
            try { await candidate.toPdf({ page: 'fit' }); mutationErrors.push('') }
            catch (error) { mutationErrors.push(String(error?.message || error)) }
          }
        } finally {
          Image.prototype.decode = realDecode
        }
        r.rootMutation = { errors: mutationErrors, decodeCalls: mutationDecodeCalls }

        // Geometry validation precedes snapshot mounting and raster decode.
        const invalid = await snapdom(target, {
          scale: 1, dpr: 1, plugins: [pdf({ outline: false })],
        })
        let invalidDecodeCalls = 0
        Image.prototype.decode = function (...args) { invalidDecodeCalls++; return realDecode.apply(this, args) }
        try {
          await invalid.toPdf({ page: 'a4', margin: 400 })
          r.invalidGeometryError = ''
        } catch (error) {
          r.invalidGeometryError = String(error?.message || error)
        } finally {
          Image.prototype.decode = realDecode
        }
        r.invalidDecodeCalls = invalidDecodeCalls

        // `lang` is export-time: it should satisfy tagging even without a capture
        // default or document language, and must not leave a false warning behind.
        const savedLang = document.documentElement.lang
        document.documentElement.lang = ''
        window.__warnings.length = 0
        const languageShot = await snapdom(target, {
          scale: 1, dpr: 1, plugins: [pdf({ outline: false })],
        })
        const languageRaw = await raw(await languageShot.toPdf({
          page: 'fit', image: false, lang: 'es', deflate: false,
        }))
        r.exportLang = {
          catalog: languageRaw.includes('/Lang (es)'),
          warning: window.__warnings.some(message => /no `lang`/i.test(message)),
        }
        document.documentElement.lang = savedLang

        // An element may belong to a same-origin iframe. Its base URL, document
        // URL and language must come from that ownerDocument, never the host page.
        const sourceFrame = document.createElement('iframe')
        const sourceLoaded = new Promise((resolve, reject) => {
          sourceFrame.onload = resolve
          sourceFrame.onerror = reject
        })
        sourceFrame.src = '/test/fixtures/plugin-frame.html'
        document.body.appendChild(sourceFrame)
        await sourceLoaded
        const framed = await snapdom(sourceFrame.contentDocument.getElementById('frame-target'), {
          scale: 1, dpr: 1, plugins: [pdf({ outline: false })],
        })
        const framedRaw = await raw(await framed.toPdf({
          page: 'fit', image: false, deflate: false,
        }))
        r.frameSource = {
          lang: framedRaw.includes('/Lang (pt)'),
          internal: /\/Subtype \/Link[\s\S]{0,300}\/Dest \[/.test(framedRaw),
          relative: /\/URI \(http:\/\/localhost:\d+\/test\/fixtures\/relative-help\)/.test(framedRaw),
        }
        sourceFrame.remove()

        // A long fit page is still regional: multiple XObjects share one
        // MediaBox, and a second identical export reuses every crop/encode.
        const tall = document.createElement('div')
        tall.style.cssText = 'width:40px;height:16500px;background:#2563eb'
        document.body.appendChild(tall)
        let tallRasters = 0
        const tallShot = await snapdom(tall, {
          scale: 1, dpr: 1, plugins: [pdf({ outline: false, breakAvoid: false }), {
            name: 'count-regional-rasters',
            defineExports(ctx) {
              const canvas = ctx.exports.canvas
              ctx.exports.canvas = (...args) => { tallRasters++; return canvas(...args) }
            },
          }],
        })
        // v3 decodes in an isolated realm. Instrument its public raster facade,
        // because this window's Image.prototype never sees those decodes.
        const tallOptions = {
          page: 'fit', text: false, links: false, tagged: false,
          codec: 'flate', deflate: false,
        }
        const tallRaw = await raw(await tallShot.toPdf(tallOptions))
        const firstTallRasters = tallRasters
        await tallShot.toPdf(tallOptions)
        r.fitRegions = {
          names: [...tallRaw.matchAll(/\/(Im\d+) Do/g)].map(match => match[1]),
          firstRasters: firstTallRasters,
          secondRasters: tallRasters - firstTallRasters,
        }
        tall.remove()
        return r
      })

      check('an unregistered capture has no toPdf', out.bareHasToPdf === false)
      check('snapdom(el, { plugins: [pdf()] }) adds toPdf', out.localToPdf === 'function', out.localToPdf)
      check('it returns a PDF blob', out.blobType === 'application/pdf' && out.head === '%PDF',
        `${out.blobType} / ${out.head}`)
      check("to('pdf') is the same export as toPdf", out.viaToSameSize)
      check('snapdom.plugins(pdf()) adds toPdf globally', out.globalToPdf)
      check('registering does not break the core exports',
        out.coreCanvas > 0 && out.coreBlob === 'image/svg+xml' && out.corePngTag === 'IMG',
        `${out.coreCanvas}px / ${out.coreBlob} / ${out.corePngTag}`)

      // The bridge. Both must be their OWN element's box, not each other's.
      near('concurrent capture A keeps its own page width', out.mediaA[0], out.rectA.width * PT, 1, 'pt')
      near('concurrent capture B keeps its own page width', out.mediaB[0], out.rectB.width * PT, 1, 'pt')
      check('the two concurrent pages are not the same size',
        Math.abs(out.mediaA[0] - out.mediaB[0]) > 50, `${fmt(out.mediaA[0])} vs ${fmt(out.mediaB[0])}`)

      check('no download without the option', out.clicksWithoutOption.length === 0,
        out.clicksWithoutOption.join(', '))
      check('download: name downloads once, with .pdf appended',
        out.clicksWithOption.length === 1 && out.clicksWithOption[0] === 'plug.pdf',
        out.clicksWithOption.join(', '))

      check('a capture-time option passed at export time is reported',
        /shadow/.test(out.captureTimeWarn) && /capture/.test(out.captureTimeWarn), out.captureTimeWarn)
      for (const name of ['filename', 'compress', 'scale']) {
        check(`\`${name}\` is reported rather than silently taken as the engine's`,
          out.collisionWarn.includes(`\`${name}\``), out.collisionWarn)
      }

      near('capture scale does not move the page box', out.s3.media[0], out.s1.media[0], 0.01, 'pt')
      check('capture scale does change the raster', out.s3.size > out.s1.size * 1.5,
        `${out.s1.size} B at scale 1 vs ${out.s3.size} B at scale 3`)

      near('pdf({ page: "a5" }) is honoured with no export options at all',
        out.presetMedia[0], 419.53, 0.5, 'pt')
      near('beforeExport overrides an explicit PDF page option', out.steered.media[0], 612, 0.01, 'pt')
      near('beforeExport deleting a requested page restores the PDF default',
        out.steered.removedMedia[0], 419.53, 0.5, 'pt')
      check('beforeExport adds PDF options without inherited defaults overriding them',
        out.steered.language && out.steered.watermark && !out.steered.image, JSON.stringify(out.steered))
      check('PDF keeps the SVG render artifact alongside a clone-only peer and bitmap engine request',
        out.renderStage === 'render' && out.renderArtifact && out.renderPdf === 'application/pdf')
      check('repeated and changed captures keep their own frozen PDF text', out.repeated.every(Boolean),
        JSON.stringify(out.repeated))
      {
        check('v3 absolute width/height suppress scale in PDF page rasters',
          out.absoluteSizes.every(size => size?.[0] === 400 && size?.[1] === 160),
          JSON.stringify(out.absoluteSizes))
        check('v3 predicate exclusions reach recaptured element furniture',
          out.bandExclusions.sawBand && !out.bandExclusions.bandHasSecret,
          JSON.stringify(out.bandExclusions))
      }

      check('capture exclusions and resolveNode/afterClone/afterRender govern PDF semantics',
        out.privacy.public && !out.privacy.secret, JSON.stringify(out.privacy))
      check('image:false performs no image decode/encode and writes no image XObject',
        out.privacy.decodeCalls === 0 && out.privacy.blobCalls === 0 && !out.privacy.xobject,
        JSON.stringify(out.privacy))
      check('isolated measurement does not reconnect application custom elements',
        out.privacy.reconnects === 0, `${out.privacy.reconnects} extra connectedCallback call(s)`)
      check('pdf(defaults) snapshots nested declarative options at factory time',
        out.defaultsSnapshot.media?.[0] === 310 && out.defaultsSnapshot.original && !out.defaultsSnapshot.mutated,
        JSON.stringify(out.defaultsSnapshot))
      check('a final SVG viewBox/metadata mismatch fails closed before raster work',
        /viewBox.*metadata/i.test(out.windowError) && out.windowDecodeCalls === 0,
        `${out.windowError || 'no error'}; ${out.windowDecodeCalls} decode(s)`)
      check('root opacity and intrinsic-aspect rewrites also fail closed before raster work',
        /paint\/layout attributes/i.test(out.rootMutation.errors[0]) &&
          /aspect.*viewBox/i.test(out.rootMutation.errors[1]) && out.rootMutation.decodeCalls === 0,
        JSON.stringify(out.rootMutation))
      check('impossible page geometry rejects before final-artifact mount or raster decode',
        /margin.*positive page area/i.test(out.invalidGeometryError) && out.invalidDecodeCalls === 0,
        `${out.invalidGeometryError || 'no error'}; ${out.invalidDecodeCalls} decode(s)`)
      check('per-export lang writes the catalog language without a false missing-lang warning',
        out.exportLang.catalog && !out.exportLang.warning, JSON.stringify(out.exportLang))
      check('iframe captures keep their own document URL, base URL and language',
        out.frameSource.lang && out.frameSource.internal && out.frameSource.relative,
        JSON.stringify(out.frameSource))
      check("a long page:'fit' uses multiple pre-decode regions on one page",
        out.fitRegions.names.length >= 2 && out.fitRegions.names[0] === 'Im0' &&
          out.fitRegions.names[1] === 'Im1', JSON.stringify(out.fitRegions))
      check('re-exporting the same regions reuses cached canvas/codec work',
        out.fitRegions.firstRasters >= 2 && out.fitRegions.secondRasters === 0,
        JSON.stringify(out.fitRegions))
    },
  },

  {
    name: 'geometry',
    async run() {
      const probe = await page.evaluate(PROBES)
      const box = probe.items
      const { real, r } = await standard('geometry')
      const pageH = r.pages[0].height

      check('single page', r.numPages === 1, `got ${r.numPages}`)
      near('page width matches the element box', r.pages[0].width, probe.target.width * PT, 0.5, 'pt')
      near('page height matches the element box', pageH, probe.target.height * PT, 0.5, 'pt')

      for (const key of ['head', 'mid', 'mono', 'serif', 'bold', 'link']) {
        const b = box[key]
        const item = needItem(r, key, b.text)
        if (!item) continue
        checkPlacement(key, item, b, pageH)
        near(`${key}: run is upright`, angleOf(item), 0, 0.5, '°')
      }

      // Links
      const annots = r.pages[0].annots
      check('one link annotation', annots.length === 1, `got ${annots.length}`)
      if (annots.length) {
        check('link url', annots[0].url === 'https://snapdom.dev/docs', String(annots[0].url))
        const [x1, y1, x2, y2] = annots[0].rect
        const b = box.link
        near('link rect left', x1 / PT, b.left, 2, 'px')
        near('link rect top', (pageH - y2) / PT, b.top, 2, 'px')
        near('link rect width', (x2 - x1) / PT, b.width, 2, 'px')
        near('link rect height', (y2 - y1) / PT, b.height, 2, 'px')
      }

      // Which codec carries the page image is CONTENT, not preference: DCT is
      // right for artwork and wrong for prose, where it both inflates the file and
      // rings around every glyph. `auto` encodes both and keeps the smaller, so it
      // can never lose to either fixed choice — that, not "Flate is better", is
      // what is asserted here.
      const asJpeg = await makePdf('geometry-jpeg', { codec: 'jpeg' })
      const asFlate = await makePdf('geometry-flate', { codec: 'flate' })
      check('codec:"jpeg" writes a DCT image', /\/Filter \/DCTDecode/.test(asJpeg.raw))
      check('codec:"flate" writes a lossless image',
        /\/ColorSpace \/DeviceRGB \/Filter \/FlateDecode/.test(asFlate.raw))
      check('auto never loses to either fixed codec',
        real.bytes.length <= asJpeg.bytes.length && real.bytes.length <= asFlate.bytes.length,
        `auto ${real.bytes.length} vs jpeg ${asJpeg.bytes.length} vs flate ${asFlate.bytes.length}`)
      // Equality, not just "no worse", because this fixture carries exactly ONE
      // image. A document with a cover and a footer band can beat both fixed
      // choices outright — auto decides per image, and only the single-image case
      // pins the choice itself rather than the sum of several.
      check('with one image, auto is exactly the smaller of the two',
        real.bytes.length === Math.min(asJpeg.bytes.length, asFlate.bytes.length),
        `auto ${real.bytes.length}, best ${Math.min(asJpeg.bytes.length, asFlate.bytes.length)}`)
      for (const f of ['geometry-jpeg', 'geometry-flate']) {
        fs.rmSync(path.join(OUT, `${f}.pdf`), { force: true })
      }

      // Determinism. Not a nicety: a legal or archival pipeline diffs its output,
      // and a file that changes when nothing changed makes every diff meaningless.
      // Nothing in the writer stamps a date or a random /ID, and this is what says
      // so — a full second capture and export of the same DOM, compared as BYTES.
      const twin = await makePdf('geometry-twin', {})
      check('the same DOM exports byte-identical PDFs',
        Buffer.compare(real.bytes, twin.bytes) === 0,
        `${real.bytes.length} B vs ${twin.bytes.length} B`)
      fs.rmSync(path.join(OUT, 'geometry-twin.pdf'), { force: true })

      // Compression: the content stream must not be readable when compression is on,
      // and the document must still be a document when it is off.
      check('content stream is deflated', real.raw.includes('/FlateDecode'))
      check('no plaintext operators survive compression', !real.raw.includes(' Tj ET'))
      const plain = await makePdf('geometry-uncompressed', { compress: false })
      // Diagnostic before the consequence: if the option ever stops being honoured,
      // say THAT rather than "operators not readable".
      check('option `compress` changes the file at all', plain.bytes.length !== real.bytes.length,
        `${plain.bytes.length} vs ${real.bytes.length} bytes — option \`compress\` had no effect`)
      check('compress:false leaves operators readable', plain.raw.includes(' Tj ET'))
      const pr = await analyze(plain, { hostId: 'h-geometry-plain' })
      check('compress:false parses to the same text',
        strip(allText(pr)) === strip(allText(r)),
        `${strip(allText(pr)).slice(0, 60)} vs ${strip(allText(r)).slice(0, 60)}`)
    },
  },

  {
    name: 'contract',
    async run() {
      const c = await page.evaluate(async () => {
        const { collectTextLayer } = await import('/src/text-layer.js')
        const layer = collectTextLayer(document.getElementById('target'), {})
        const run = (t) => layer.runs.find(r => r.text === t) || null
        const plain = run('PLAINRUN')
        return {
          found: { plain: !!plain, rot: !!run('ROTATEDRUN'), control: !!run('CONTROLRUN') },
          keys: plain && Object.keys(plain).sort(),
          controlKeys: run('CONTROLRUN') && Object.keys(run('CONTROLRUN')).sort(),
          linkKeys: layer.links[0] && Object.keys(layer.links[0]).sort(),
          linkHref: layer.links[0] && layer.links[0].href,
          plainMatrix: plain && plain.matrix,
          rotMatrix: run('ROTATEDRUN') && run('ROTATEDRUN').matrix,
          ascent: plain && plain.ascent,
          size: plain && plain.size,
          warningsIsArray: Array.isArray(layer.warnings),
          warningTypes: [...new Set((layer.warnings || []).map(w => typeof w))],
        }
      })

      if (!check('collectTextLayer emitted the three probe runs', c.found.plain && c.found.rot && c.found.control,
        JSON.stringify(c.found))) return

      check('a text run carries exactly the contract key set',
        JSON.stringify(c.keys) === JSON.stringify(RUN_KEYS), c.keys.join(','))
      check('a control run carries the same key set as a text run',
        JSON.stringify(c.controlKeys) === JSON.stringify(RUN_KEYS), (c.controlKeys || []).join(','))

      check('an untransformed run reports matrix === null', c.plainMatrix === null, String(c.plainMatrix))
      const m = c.rotMatrix
      check('a rotated run reports a 2×2 linear part',
        !!m && [m.a, m.b, m.c, m.d].every(Number.isFinite) && Math.abs(m.b) > 0.1,
        JSON.stringify(m))

      check('ascent is a usable vertical extent',
        Number.isFinite(c.ascent) && c.ascent > 0 && c.ascent <= c.size * 1.5,
        `ascent ${fmt(c.ascent)} of size ${fmt(c.size)}`)

      check('warnings is an array of strings',
        c.warningsIsArray && c.warningTypes.every(t => t === 'string'),
        `${c.warningsIsArray ? 'array' : 'not an array'} of ${c.warningTypes.join('/') || 'nothing'}`)

      check('a link carries the keys index.js reads',
        c.linkKeys && ['height', 'href', 'width', 'x', 'y'].every(k => c.linkKeys.includes(k)),
        (c.linkKeys || []).join(','))
      check('link href is the resolved absolute URL',
        c.linkHref === 'https://snapdom.dev/contract', String(c.linkHref))

      // The other two modules index.js reads shape-first.
      const n = await page.evaluate(async () => {
        const { collectTextLayer } = await import('/src/text-layer.js')
        const { collectNav, outlineTree, fragmentOf } = await import('/src/nav.js')
        const { collectRepeats } = await import('/src/paginate.js')
        const target = document.getElementById('target')
        const layer = collectTextLayer(target, {})
        const nav = collectNav(target, { links: layer.links })
        const entry = nav.outline.find(o => o.title === 'CONTRACTHEAD') || null
        const node = outlineTree(nav.outline).find(o => o.title === 'CONTRACTHEAD') || null
        return {
          navKeys: Object.keys(nav).sort(),
          destsIsMap: nav.dests instanceof Map,
          destKeys: nav.dests.get('pinned') && Object.keys(nav.dests.get('pinned')).sort(),
          entry: entry && { keys: Object.keys(entry).sort(), level: entry.level, dest: entry.dest },
          boxKeys: entry && entry.box && Object.keys(entry.box).sort(),
          nodeKeys: node && Object.keys(node).sort(),
          nodeChildren: node && Array.isArray(node.children),
          fragSame: fragmentOf(new URL('#pinned', location.href).href),
          fragTop: fragmentOf(new URL('#top', location.href).href),
          fragAway: fragmentOf('https://example.invalid/other#pinned'),
          fragNone: fragmentOf('https://example.invalid/other'),
          repeat: collectRepeats(target)[0] && Object.keys(collectRepeats(target)[0]).sort(),
          repeatCount: collectRepeats(target).length,
        }
      })

      check('collectNav returns dests, outline and warnings',
        JSON.stringify(n.navKeys) === JSON.stringify(['dests', 'outline', 'warnings']) && n.destsIsMap,
        n.navKeys.join(','))
      // A destination is a POINT, and the same point whether it came from a link
      // target or from a heading — `/XYZ` takes nothing else, and the two used to
      // disagree about it.
      check('a destination is exactly a point',
        JSON.stringify(n.destKeys) === JSON.stringify(['x', 'y']), (n.destKeys || []).join(','))
      check('an outline entry carries level, title, dest and box',
        n.entry && JSON.stringify(n.entry.keys) === JSON.stringify(['box', 'dest', 'level', 'title']),
        n.entry ? n.entry.keys.join(',') : 'no entry')
      check('an outline entry names its own destination',
        n.entry && n.entry.dest === 'pinned' && n.entry.level === 2,
        n.entry ? `${n.entry.dest} at level ${n.entry.level}` : 'no entry')
      check('the entry box is the heading rect the index crops from',
        JSON.stringify(n.boxKeys) === JSON.stringify(['h', 'w', 'x', 'y']), (n.boxKeys || []).join(','))
      check('outlineTree keeps title, dest, box and children',
        JSON.stringify(n.nodeKeys) === JSON.stringify(['box', 'children', 'dest', 'title']) && n.nodeChildren,
        (n.nodeKeys || []).join(','))

      // The one function that decides whether a link leaves the document at all.
      check('fragmentOf: a same-document fragment is its name',
        n.fragSame === 'pinned', String(n.fragSame))
      check('fragmentOf: #top is the document top, not a name', n.fragTop === '', JSON.stringify(n.fragTop))
      check('fragmentOf: another document is not a fragment at all',
        n.fragAway === null && n.fragNone === null, `${n.fragAway} / ${n.fragNone}`)

      check('collectRepeats returns one band per repeatable thead',
        n.repeatCount === 1, `${n.repeatCount} band(s)`)
      check('a header band carries the two edges and the table bottom',
        JSON.stringify(n.repeat) === JSON.stringify(['bodyBottom', 'bottom', 'top']),
        (n.repeat || []).join(','))
    },
  },

  {
    name: 'paginate',
    dom: false,
    run() {
      const EPS = 1e-6
      /** Absolute slack for the two bounds paginate itself computes with EPS. */
      const SLACK = 1e-4

      /** The whole contract: slices tile [0, contentHeight) with no gap and no overlap. */
      const problem = (slices, contentHeight, availHeight) => {
        if (!slices.length) return 'no slices'
        if (Math.abs(slices[0].top) > EPS) return `starts at ${slices[0].top}`
        for (let i = 0; i < slices.length; i++) {
          const s = slices[i]
          if (!(s.height > EPS)) return `slice ${i} has height ${s.height}`
          if (s.height > availHeight + SLACK) return `slice ${i} is ${s.height} > availHeight ${availHeight}`
          if (i && Math.abs(s.top - (slices[i - 1].top + slices[i - 1].height)) > SLACK) return `gap or overlap before slice ${i}`
          if (!(s.cut >= 0)) return `slice ${i} reports cut ${s.cut}`
        }
        const last = slices[slices.length - 1]
        if (Math.abs(last.top + last.height - contentHeight) > SLACK) return `ends at ${last.top + last.height}, not ${contentHeight}`
        if (last.cut !== 0) return 'the last slice reports a cut'
        return ''
      }
      const tiles = (label, out, contentHeight, availHeight) =>
        check(label, !problem(out.slices, contentHeight, availHeight), problem(out.slices, contentHeight, availHeight))

      check('paginate rejects a non-positive contentHeight',
        (() => { try { paginate({ contentHeight: 0, availHeight: 100 }); return false } catch { return true } })())
      check('paginate rejects a non-positive availHeight',
        (() => { try { paginate({ contentHeight: 100, availHeight: 0 }); return false } catch { return true } })())

      const short = paginate({ contentHeight: 300, availHeight: 800 })
      check('paginate returns { slices, forcedIgnored }',
        Array.isArray(short.slices) && Number.isInteger(short.forcedIgnored),
        JSON.stringify(short).slice(0, 120))
      tiles('a document shorter than a page is one slice', short, 300, 800)
      check('a document shorter than a page is exactly one slice', short.slices.length === 1)

      // A block taller than a page has to be cut wherever it lands; honouring it
      // would drag every cut back to the top of the document and never terminate.
      tiles('a block taller than a page is cut rather than looping',
        paginate({ blocks: [{ top: 0, bottom: 5000 }], contentHeight: 5000, availHeight: 700 }), 5000, 700)

      // A break the author declared beats the greedy cut, wherever in the window it falls.
      const declared = paginate({ blocks: [{ top: 400, bottom: 400, forced: true }], contentHeight: 1200, availHeight: 500 })
      tiles('a declared break tiles', declared, 1200, 500)
      check('a declared break is taken where the author put it',
        declared.slices.some(s => Math.abs(s.top - 400) < EPS), declared.slices.map(s => s.top).join(','))
      check('a taken break is not counted as ignored', declared.forcedIgnored === 0, String(declared.forcedIgnored))

      // Forced breaks every half point: the belt in the loop is the only thing
      // between this and a slice list the length of the document.
      const dense = Array.from({ length: 400 }, (_, i) => ({ top: i * 0.5, bottom: i * 0.5, forced: true }))
      const crowded = paginate({ blocks: dense, contentHeight: 900, availHeight: 300 })
      tiles('a pathological forced-break list still tiles', crowded, 900, 300)
      check('the breaks that could not be taken are reported',
        crowded.forcedIgnored > 0, String(crowded.forcedIgnored))

      // The cut is pulled UP to a block boundary, never left inside a row.
      const rows = Array.from({ length: 20 }, (_, i) => ({ top: i * 90, bottom: i * 90 + 90 }))
      const paged = paginate({ blocks: rows, contentHeight: 1800, availHeight: 500 })
      tiles('rows tile', paged, 1800, 500)
      check('no slice boundary falls inside a row',
        paged.slices.every(s => s.cut === 0), paged.slices.map(s => s.cut).join(','))
      check('the cut is the row boundary just above the ideal one',
        Math.abs(paged.slices[0].height - 450) < EPS, `${paged.slices[0].height} vs 450`)

      // `cut` is the damage count index.js turns into "N block(s) had to be split
      // across a page break", so a constant 0 would ship a silent lie. Every cut
      // value asserted above is 0 — `tiles` only bounds the rest from below — so
      // these two are what pin a positive one. Here the second block straddles the
      // ideal cut at 400, every edge above it that still fills the page (390, then
      // 100) is straddled too, and the only edge left, 50, is below minFill's floor
      // of 80, where the descending scan stops.
      const torn = paginate({ blocks: [{ top: 50, bottom: 390 }, { top: 100, bottom: 410 }], contentHeight: 900, availHeight: 400 })
      tiles('an unavoidable tear still tiles', torn, 900, 400)
      check('a tear no boundary can avoid is counted', torn.slices[0].cut === 1,
        torn.slices.map(s => s.cut).join(','))

      // figure > blockquote > p torn by one break is ONE visible tear, not three.
      const nested = paginate({
        blocks: [{ top: 50, bottom: 440 }, { top: 60, bottom: 430 }, { top: 70, bottom: 420 }],
        contentHeight: 900, availHeight: 400,
      })
      tiles('a nested tear still tiles', nested, 900, 400)
      check('nested blocks torn by one break count as one tear', nested.slices[0].cut === 1,
        nested.slices.map(s => s.cut).join(','))

      // minFill is clamped, not trusted: 5 means 0.9 and -3 means 0, and neither
      // may cost the caller the block boundaries that are the point of the function.
      for (const minFill of [5, -3, 0, 0.9]) {
        const out = paginate({ blocks: rows, contentHeight: 1800, availHeight: 500, minFill })
        tiles(`minFill ${minFill} is clamped into range`, out, 1800, 500)
        check(`minFill ${minFill} still respects row boundaries`,
          out.slices.every(s => s.cut === 0), out.slices.map(s => s.cut).join(','))
      }

      // minFill is clamped but not sanitised, so a non-finite one poisons the
      // iteration limit and the greedy loop never runs at all. The blind tail belt
      // is the only thing between that and a document with no slices — this is the
      // one input in this block that reaches it.
      tiles('a non-finite minFill still tiles the page',
        paginate({ blocks: rows, contentHeight: 1800, availHeight: 500, minFill: NaN }), 1800, 500)

      // ——— repeated header bands ———
      // The reserve is a function of the page's TOP alone, which is the property
      // that makes one pass enough. Everything below is a consequence of it.
      const band = (top, bottom, bodyBottom) => ({ top, bottom, bodyBottom })
      const head = band(100, 130, 2000)

      check('a header on the page it lives on reserves nothing',
        repeatsAt([head], 0, 400).height === 0)
      check('a header above the page reserves its own height',
        repeatsAt([head], 500, 400).height === 30, String(repeatsAt([head], 500, 400).height))
      check('a header stops reserving once its own table has ended',
        repeatsAt([head], 2500, 400).height === 0)
      // A page cut through the header itself keeps it where it is: `<thead>` is
      // atomic, so this is the shape paginate has already refused to produce.
      check('a header the page starts inside is not repeated',
        repeatsAt([head], 115, 400).height === 0)
      const tall = repeatsAt([band(0, 300, 2000)], 500, 100)
      check('a header taller than the budget is refused whole, and says so',
        tall.height === 0 && tall.bands.length === 0 && tall.refused === true,
        JSON.stringify(tall))
      const two = repeatsAt([head, band(200, 220, 900)], 500, 400)
      check('two nested tables reserve both headers', two.height === 50 && two.bands.length === 2,
        JSON.stringify(two.height))
      check('no bands at all means no reserve function', headerReserve([], 100) === null)

      const reserved = paginate({
        blocks: rows, contentHeight: 1800, availHeight: 500,
        reserve: headerReserve([band(0, 50, 1800)], 250),
      })
      tiles('a reserve still tiles the page exactly', reserved, 1800, 500)
      check('every page after the header gives up exactly its height',
        reserved.slices.slice(1).every(s => s.height <= 450 + SLACK),
        reserved.slices.map(s => fmt(s.height)).join(' '))
      const bare = paginate({ blocks: rows, contentHeight: 1800, availHeight: 500 })
      check('a reserve costs pages rather than losing content',
        reserved.slices.length >= bare.slices.length,
        `${reserved.slices.length} with vs ${bare.slices.length} without`)

      // Randomized: the invariants have to hold for block lists nobody would write.
      let seed = 20240817
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      let failure = null
      for (let iter = 0; iter < 400 && !failure; iter++) {
        const availHeight = 50 + rnd() * 800
        const contentHeight = availHeight * (0.2 + rnd() * 8)
        const blocks = []
        for (let n = Math.floor(rnd() * 30); n > 0; n--) {
          const top = rnd() * contentHeight * 1.1 - contentHeight * 0.05
          if (rnd() < 0.15) blocks.push({ top, bottom: top, forced: true })
          else blocks.push({ top, bottom: top + rnd() * rnd() * availHeight * 2.5 })
        }
        const minFill = [0.2, 0, 0.5, 5, -1][iter % 5]
        // A third of the iterations carry header bands too, including ones far
        // taller than the budget allows: a reserve that could stall the walk or
        // hand back a slice bigger than its page would show up here as a tiling
        // failure rather than as a slow test.
        const heads = []
        if (iter % 3 === 0) {
          for (let n = Math.floor(rnd() * 3); n > 0; n--) {
            const top = rnd() * contentHeight
            heads.push({ top, bottom: top + rnd() * availHeight * 1.5, bodyBottom: top + rnd() * contentHeight })
          }
        }
        const reserve = headerReserve(heads, availHeight * 0.5)
        try {
          const why = problem(paginate({ blocks, contentHeight, availHeight, minFill, reserve }).slices,
            contentHeight, availHeight)
          if (why) failure = { iter, why, contentHeight, availHeight, minFill, heads, blocks }
        } catch (e) {
          failure = { iter, why: e.message, contentHeight, availHeight, minFill, heads, blocks }
        }
      }
      check('400 randomized block lists all tile their page, reserves included', !failure,
        failure ? JSON.stringify(failure).slice(0, 400) : '')
    },
  },

  {
    name: 'unicode',
    async run() {
      const { items: box } = await page.evaluate(PROBES)
      const { real, r } = await standard('unicode')
      const pageH = r.pages[0].height

      for (const s of ['“quotes”', 'em—dash', 'café', 'naïve', '中文测试段落', 'Русский', 'текст',
        'Ελληνικά', 'κείμενα', '😀', '🚀', 'Mixed中文Latin']) present(r, s)

      const arabic = presentBidi(r, 'العربية', 'Arabic')
      presentBidi(r, 'עברית', 'Hebrew')
      // The one RTL claim that is a decision: the origin is the run's LEFT edge, the
      // visual end of the logical string, not its right.
      if (arabic) near('Arabic: origin x is the box left, not its right',
        toCssX(arabic), box.arabic.left, 2, 'px')

      noDropWarning()
      check('a Type0/Identity-H font is embedded', real.raw.includes('/Identity-H'))
      check('a /ToUnicode CMap is embedded', real.raw.includes('/ToUnicode'))
      // The Type0 path is the one with state that COULD vary between runs — a CMap
      // built by walking the codepoints a document happened to use. Asserted on the
      // document that exercises it hardest, for the same reason `geometry` asserts
      // it on the one that does not.
      const utwin = await makePdf('unicode-twin', {})
      check('a Type0 document is byte-identical across exports too',
        Buffer.compare(real.bytes, utwin.bytes) === 0,
        `${real.bytes.length} B vs ${utwin.bytes.length} B`)
      fs.rmSync(path.join(OUT, 'unicode-twin.pdf'), { force: true })

      // The Unicode path uses a different Tz divisor than base-14; a wrong one shows
      // up as a run that is far too wide or too narrow for its box.
      for (const key of ['cjk', 'mixed']) {
        const b = box[key]
        const item = needItem(r, key, b.text)
        if (item) checkPlacement(key, item, b, pageH, 3)
      }
    },
  },

  {
    name: 'transform',
    async run() {
      const { items: box } = await page.evaluate(PROBES)
      const { r } = await standard('transform')
      const pageH = r.pages[0].height

      for (const key of ['rot0', 'rot15', 'rot45', 'rotneg', 'nested', 'vert']) {
        const b = box[key]
        const item = needItem(r, key, b.text)
        if (!item) continue
        // PDF user space is y-up, so a clockwise CSS rotation is a negative PDF angle.
        check(`${key}: text matrix encodes ${-b.rotate}°`,
          angleDelta(angleOf(item), -b.rotate) <= 1.5,
          `got ${fmt(angleOf(item))}°`)
        if (b.rotate === 0) checkPlacement(key, item, b, pageH)
        else checkInside(key, item, b, pageH)
      }

      const sk = box.skew
      const item = needItem(r, 'skew', sk.text)
      if (item) {
        near('skew: shear is carried into the text matrix',
          item.c / item.d, -Math.tan(sk.skew * Math.PI / 180), 0.05)
        near('skew: baseline stays horizontal', angleOf(item), 0, 1.5, '°')
        checkInside('skew', item, sk, pageH)
      }
    },
  },

  {
    /**
     * The 2D-affine gate: whether a run's accumulated transform is a map a 2×2 can
     * describe. Say yes wrongly and the layer claims an exactness it does not have —
     * the last regression shipped a silent identity for a chain Blink paints 1.1111×,
     * which is 11.97px of miss at the far corner of a 100×40 box. Say no wrongly and
     * the card flip and every flattened chain below lose their rotation.
     *
     * Nothing here trusts the module's own arithmetic. Each leaf carries four
     * zero-size corner markers, so the map Chromium PAINTS is read off the live DOM
     * and the shipped 2×2 is checked against it — the literals are there so that a
     * Blink change shows up as a failure instead of moving both sides at once.
     *
     * Every chain appears twice: once with its boxes stacked at their parents'
     * origins, once with `margin-left:37px; margin-top:23px` on every link. Blink
     * paints four of these pairs DIFFERENTLY while every computed style this module
     * reads is identical across the pair — which is the whole argument for refusing
     * them rather than picking an answer.
     */
    name: 'perspective3d',
    async run() {
      // The chains, outermost first, as written in the fixture. `blink` is what
      // Chromium paints, MEASURED here from the corner markers; for a rescued chain
      // it is also what the run must carry. `blinkOff` is the offset twin's, present
      // only where it differs.
      const CASES = [
        // ——— rescues: 3D in the chain, an exact 2×2 at the leaf ———
        {
          name: 'RESCUEFLATPERSP', ship: true, blink: [0.6645, 0.3420, -0.2418, 0.9397],
          // rotateY(45°) flat › perspective:500px › rotate(20°). The flat parent closes
          // the 3D context, so the rotateY is already flattened to a 0.7071 squash and
          // the perspective below it projects a leaf that never leaves z = 0.
        },
        {
          name: 'RESCUEGAPPERSP', ship: true, blink: [0.7198, 0.3420, -0.2620, 0.9397],
          // The same with an untransformed div between the perspective and the leaf:
          // the projection has to survive a link that contributes nothing.
        },
        {
          name: 'RESCUEPERSPGAP', ship: true, blink: [0.7071, 0, 0, 1],
          // perspective:500px › empty div › rotateY(45°). The perspective is the
          // identity on a z-neutral plane, leaving the bare orthographic squash.
        },
        {
          name: 'RESCUEFUNCFLAT', ship: true, blink: [0.7071, 0, 0, 1],
          // Same squash from the transform FUNCTION: `perspective(500px)` on a flat
          // parent is flattened away entirely before the child's rotateY is applied.
        },
        {
          name: 'RESCUEKEEPCHAIN', ship: true, blink: [0.6287, 0.2079, -0.1336, 0.9781],
          // preserve-3d rotateY(35°) › rotateY(15°) › perspective:500px › rotate(12°):
          // an open 3D context, a close, and a perspective, all in one chain.
        },

        // ——— refusals: no 2×2 is honest here ———
        {
          name: 'REFUSEORIGINZ', ship: false, blink: [1.3158, 0, 0, -1.3158],
          // The card flip about a z-shifted origin. `transform-origin: 50% 50% 60px`
          // lands the plane at z = 120 and the perspective scales it by 1/(1 − 120/500);
          // the accumulated 2×2 has no term for that and reads [1, 0, 0, −1].
        },
        {
          name: 'REFUSEFUNCORIGIN', ship: false, blink: [0.9127, 0, 0, 0.9127],
          // `perspective(324px)` under `transform-origin: 14px 47px 31px`: the origin
          // conjugation divides through a projective matrix, so 1/(1 + 31/324) is
          // painted where the unconjugated matrix claims 1.
        },
        {
          name: 'REFUSEKEEPCANCEL', ship: false,
          blink: [0.9063, 0.4226, -0.4226, 0.9063], blinkOff: [0.8684, 0.4050, -0.4050, 0.8684],
          // perspective:600px › preserve-3d rotateY(45°) › rotateY(−45°) rotate(25°).
          // The rotations cancel to a clean rotate(25°) — and that is exactly what
          // Blink paints while the boxes share an origin, and 0.9582× it once they do
          // not, because the pair then turns about two origins and leaves the plane
          // off z. The difference is a layout offset the module never sees, so the
          // true cancellation is refused too, loudly rather than silently.
        },
        {
          name: 'REFUSEFLATCANCEL', ship: false,
          blink: [0.2236, 0.4342, -0.1145, 0.9350], blinkOff: [0.1723, 0.4074, -0.0877, 0.8770],
          // The same cancellation across a FLAT boundary under perspective:500px. The
          // leaf's painted quad is not a parallelogram at all: the numbers above are its
          // two edges out of the origin corner, and the fourth corner misses where they
          // put it by 2.33px. No 2×2 is right here, whatever it says.
        },
        {
          name: 'REFUSEREACHBACK', ship: false,
          blink: [0.4295, 0.3913, -0.5000, 0.8536], blinkOff: [0.6409, 0.4532, -0.5000, 0.8536],
          // rotate3d(0,1,1,45°) flat › empty div › preserve-3d div › rotateY(25°). The
          // leaf reaches back past the empty div and composes against the UNFLATTENED
          // chain — until a margin on that div restores the close and Blink switches
          // answers. Same computed styles, two paints, 0.21 apart in `a`.
        },
        {
          name: 'REFUSETRANSLATEZ', ship: false,
          blink: [1.1111, 0, 0, 1.1111], blinkOff: [1, 0, 0, 1],
          // The most recent regression. `perspective(300px)` › bare preserve-3d div ›
          // `translate: 0 0 30px`: ownLinear drops the `translate` longhand as a pure
          // translation, so the reach-back guard never fired and a 1/(1 − 30/300) scale
          // shipped as the identity. Its twin IS the identity — same styles again.
        },

        // ——— regression guards: 3D that is exactly describable and must keep shipping ———
        {
          name: 'GUARDFLIPY', ship: true, blink: [-1, 0, 0, 1],
          // Two preserve-3d contexts under a perspective, ending in rotateY(180°): 3D
          // throughout, z-neutral throughout, so the mirror is exact.
        },
        { name: 'GUARDFLIPX', ship: true, blink: [1, 0, 0, -1] },
        {
          name: 'GUARDNESTFLAT', ship: true, blink: [0.75, 0, 0, 1],
          // Nested rotateY(30°): 0.75 when the outer element flattens its child's
          // context and 0.5 when it preserves it. The pair is the reason `seg` is
          // flattened at the boundary instead of multiplied straight through.
        },
        { name: 'GUARDNESTKEEP', ship: true, blink: [0.5, 0, 0, 1] },
      ]

      const quads = await page.evaluate(() => window.__quads())
      const layer = await page.evaluate(async () => {
        const { collectTextLayer } = await import('/src/text-layer.js')
        const l = collectTextLayer(document.getElementById('target'), {})
        // Also once per slot. A run's own verdict is not on the run — a refused one
        // reports matrix === null, and so does a run whose map is the identity. The
        // difference is the warning, and only a per-slot collect attributes it. That
        // difference is the whole of the REFUSETRANSLATEZ regression.
        const per = {}
        for (const leaf of document.querySelectorAll('.leaf')) {
          per[leaf.dataset.probe] = collectTextLayer(leaf.closest('.slot'), {}).warnings
        }
        return { runs: l.runs.map(r => ({ text: r.text, matrix: r.matrix })), warnings: l.warnings, per }
      })

      // The literals above are written to 4dp, so the last digit is the tolerance. The
      // module is held to a tighter one against the live corners: it is describing the
      // same map, not approximating it.
      const TOL_LIT = 1e-4
      const TOL_LIVE = 5e-4
      const quad = (name) => [quads[name].a, quads[name].b, quads[name].c, quads[name].d]
      const show = (m) => `[${m.map(v => v.toFixed(4)).join(', ')}]`
      const worst = (got, want) => Math.max(...got.map((v, i) => Math.abs(v - want[i])))

      function sameMatrix(label, got, want, tol) {
        return check(label, worst(got, want) <= tol,
          `${show(got)} vs ${show(want)} (off ${worst(got, want).toExponential(1)})`)
      }

      const names = CASES.flatMap(c => [c.name, `${c.name}OFF`])
      const wrong = names.filter(n => layer.runs.filter(r => r.text === n).length !== 1)
      check('every leaf produced exactly one run', wrong.length === 0 && layer.runs.length === names.length,
        `${layer.runs.length} run(s) of an expected ${names.length}${wrong.length ? `; wrong count for ${wrong.join(', ')}` : ''}`)
      const matrixOf = (name) => (layer.runs.find(r => r.text === name) || {}).matrix

      const ONE_REFUSED = '1 run(s) under a 3D/perspective transform — placed axis-aligned'

      for (const c of CASES) {
        for (const name of [c.name, `${c.name}OFF`]) {
          const want = name.endsWith('OFF') && c.blinkOff ? c.blinkOff : c.blink
          const m = matrixOf(name)
          const warnings = layer.per[name]
          sameMatrix(`${name}: Chromium paints ${show(want)}`, quad(name), want, TOL_LIT)
          if (c.ship) {
            if (m) sameMatrix(`${name}: the run carries the map Chromium paints`, [m.a, m.b, m.c, m.d], quad(name), TOL_LIVE)
            else check(`${name}: the run carries the map Chromium paints`, false, 'matrix === null — placed axis-aligned')
            check(`${name}: no 3D/perspective warning`, warnings.length === 0, warnings.join(' | '))
          } else {
            check(`${name}: refused — matrix === null and the run is warned about`,
              (m === null || m === undefined) && warnings.length === 1 && warnings[0] === ONE_REFUSED,
              `${m ? `shipped ${show([m.a, m.b, m.c, m.d])}` : 'matrix === null'}, warnings: ${warnings.join(' | ') || 'none'}`)
          }
        }
      }

      // A rescued chain has to be a parallelogram, or the 2×2 it was handed describes
      // one edge of the box and lies about the other.
      const ship = CASES.filter(c => c.ship).flatMap(c => [c.name, `${c.name}OFF`])
      const bent = ship.filter(n => quads[n].gap > 0.01)
      check('every rescued chain is painted as a parallelogram', bent.length === 0,
        bent.map(n => `${n} off by ${fmt(quads[n].gap)}px`).join(', '))
      // And the one refusal that is refused because it is NOT one.
      near('REFUSEFLATCANCEL: the far corner misses the other three', quads.REFUSEFLATCANCEL.gap, 2.33, 0.05, 'px')
      near('REFUSEFLATCANCELOFF: the far corner misses the other three', quads.REFUSEFLATCANCELOFF.gap, 2.03, 0.05, 'px')

      // The offset twin is only evidence if the margins moved the chain. A dropped
      // inter-element translation is invisible when every box sits at (0, 0).
      const still = names.filter(n => n.endsWith('OFF'))
        .map(n => ({ n, d: Math.hypot(quads[n].ox - quads[n.slice(0, -3)].ox, quads[n].oy - quads[n.slice(0, -3)].oy) }))
        .filter(t => t.d < 40)
      check('every offset twin really moved', still.length === 0,
        still.map(t => `${t.n} moved ${fmt(t.d)}px`).join(', '))

      // What the refusals cost if they were rescues instead: the axis-aligned fallback
      // against the corner Chromium paints. 11.97px is the miss the last regression
      // shipped as an identity, on a box only 100×40.
      near('REFUSETRANSLATEZ: the axis-aligned fallback misses the far corner',
        quads.REFUSETRANSLATEZ.miss, 11.97, 0.05, 'px')
      near('REFUSETRANSLATEZOFF: its twin is the identity Blink really paints',
        quads.REFUSETRANSLATEZOFF.miss, 0, 0.01, 'px')

      // The pairs that settle it: identical computed styles, different paint.
      for (const c of CASES.filter(c => c.blinkOff)) {
        const d = worst(quad(c.name), quad(`${c.name}OFF`))
        check(`${c.name}: the offset twin is painted differently, and no computed style says so`,
          d > 0.03, `twins ${fmt(d)} apart, ${show(quad(c.name))} vs ${show(quad(`${c.name}OFF`))}`)
      }

      const refused = CASES.filter(c => !c.ship).length * 2
      check('one warning, naming exactly the refused runs',
        layer.warnings.length === 1 &&
        layer.warnings[0] === `${refused} run(s) under a 3D/perspective transform — placed axis-aligned`,
        layer.warnings.join(' | ') || 'no warnings')

      // Through the real export path, not just the module's own return value: a
      // refusal the caller never hears about is a silent claim by another route.
      const { r } = await standard('perspective3d')
      noDropWarning()
      check('the refusal reaches the console through index.js',
        pageLog.some(l => l.includes(`[snapdom-pdf] ${refused} run(s) under a 3D/perspective transform`)),
        pageLog.filter(l => l.includes('snapdom-pdf')).join(' | ') || 'nothing warned')
      // Each name occurs twice in the layer: once on its own, once inside its OFF twin.
      const all = strip(allText(r))
      const missing = CASES.map(c => [c.name, occurrences(all, c.name)]).filter(([, n]) => n !== 2)
      check('the PDF ships both twins of every case', missing.length === 0,
        missing.map(([n, k]) => `${n} ×${k}`).join(', '))
    },
  },

  {
    name: 'typography',
    async run() {
      const { items: box } = await page.evaluate(PROBES)
      const adv = await page.evaluate(() => window.__adv)
      const { r } = await standard('typography')
      const pageH = r.pages[0].height

      // The layer must carry what is PAINTED, not what the text node says.
      present(r, 'SHOUTINGLOWER')
      absent(r, 'shoutinglower', 'text-transform:uppercase is applied to the layer')
      present(r, 'Titlecaseword')
      absent(r, 'titlecaseword', 'text-transform:capitalize is applied to the layer')

      // Both tracking checks are worthless unless the tracking is actually there.
      check('letter-spacing really widens the browser advance',
        adv.tracked > adv.trackedPlain + 40 && adv.slant > adv.slantPlain + 40,
        `${fmt(adv.tracked)} vs ${fmt(adv.trackedPlain)}px, ${fmt(adv.slant)} vs ${fmt(adv.slantPlain)}px`)

      // Upright: the base-14 advance is the untracked one, so the run only fits its
      // box if Tz corrected for the difference.
      const tracked = needItem(r, 'tracked', 'TRACKEDWORD')
      if (tracked) checkPlacement('tracked', tracked, box.tracked, pageH)
      const plain = needItem(r, 'plain', 'PLAINWORD')
      if (plain) checkPlacement('plain', plain, box.plain, pageH)

      // Rotated: the width is unreadable from the AABB and comes from measureReal,
      // which is the only code path that consults ctx.letterSpacing.
      const slant = needItem(r, 'slant', 'TRACKEDSLANT')
      if (slant) {
        check('slant: text matrix encodes -25°', angleDelta(angleOf(slant), -25) <= 1.5, `got ${fmt(angleOf(slant))}°`)
        checkInside('slant', slant, box.slant, pageH)
        near('slant: the measured advance carries letter-spacing', slant.w / PT, adv.slant, 3, 'px')
      }

      // A wrapped word is one run per client rect. Concatenation is NOT enough: a
      // slice taken by character proportion rather than by measurement reassembles
      // the word correctly and still hands every fragment its neighbour's glyphs,
      // then squashes the last one to fit. Only the painted line strings see that,
      // so the fragments are matched against them, in order, character for
      // character. Selected by baseline, not by substring — a fragment carrying
      // characters that are not on its line must show up here, not be filtered out.
      const word = 'WRAPPINGLONGSINGLEWORD'
      const lines = await page.evaluate(() => window.__lines)
      check('the long word really wrapped into separate lines', lines.length >= 4, lines.join('|'))
      exactlyOnce(r, word)
      const wb = box.wrapped
      const frags = r.pages[0].items.filter(i => {
        const y = toCssY(i, pageH)
        return y > wb.top && y < wb.top + wb.height + 6
      })
      const got = frags.map(i => strip(i.str))
      check('each wrapped fragment carries the characters painted on its line',
        JSON.stringify(got) === JSON.stringify(lines),
        `${got.join('|') || 'no fragments'} vs ${lines.join('|')}`)
    },
  },

  {
    /**
     * Coverage by quantity. Every fixture above pins a handful of probe words, each
     * chosen because someone already suspected that case; this one asserts the same
     * geometry for EVERY word on a dense page — hundreds of them, across six
     * base-14 faces, inline code, links, all three text-transform keywords, tracking
     * and two rotations — so a case nobody suspected has nowhere to hide.
     *
     * It pairs run i with word i rather than searching for a match. index.js writes
     * its runs in the order text-layer walks the tree, and window.__words walks the
     * same tree the same way, so the two sequences are the same sequence: a run
     * dropped, duplicated, or emitted with the wrong text is a divergence at a known
     * index rather than a word the matcher failed to find and skipped in silence.
     */
    name: 'align',
    async run() {
      const source = await page.evaluate(() => window.__words())
      const { real, r } = await standard('align', { compress: false })
      const dom = await canonicalArtifactWords('align')
      const pageH = r.pages[0].height

      check('the canonical artifact preserves the source word sequence',
        JSON.stringify(dom.words.map(w => w.text)) === JSON.stringify(source.words.map(w => w.text)),
        `${dom.words.length} artifact fragments vs ${source.words.length} source fragments`)
      check('single page', r.numPages === 1, `got ${r.numPages}`)
      near('page height matches the element box', pageH, dom.target.height * PT, 0.5, 'pt')

      const runs = streamRuns(real.raw)
      const res = fontResources(real.raw)

      const sized = check(`the stream carries one run per painted word fragment (${dom.words.length})`,
        runs.length === dom.words.length, `${runs.length} runs vs ${dom.words.length} fragments`)
      let diff = -1
      for (let i = 0; i < Math.min(runs.length, dom.words.length) && diff < 0; i++) {
        if (runs[i].text !== dom.words[i].text) diff = i
      }
      check('every run carries the word painted at its own place, in document order', diff < 0,
        diff < 0 ? '' : `run ${diff} is ${JSON.stringify(runs[diff].text)}, the DOM has ${JSON.stringify(dom.words[diff].text)}`)
      if (!sized || diff >= 0) return

      // Every word here is WinAnsi on purpose: a hex string is a glyph id in the
      // Type0 font, and no byte comparison can read one back. `unicode` owns that
      // path, and a run appearing here would silently shrink this fixture's claim.
      check('no run needed the Type0 font, so the byte comparison covers every run',
        runs.every(x => x.text !== null), `${runs.filter(x => x.text === null).length} hex string(s)`)
      const nameless = [...new Set(runs.map(x => x.font).filter(f => !res.get(f)))]
      check('every run names a font the page resource dictionary carries',
        nameless.length === 0, nameless.join(','))

      const flat = []
      const turned = []
      for (let i = 0; i < runs.length; i++) (uprightRun(runs[i]) ? flat : turned).push(i)

      // page:'fit' means margin 0 and drawScale 1, so content points ARE the element
      // box scaled by PT: a run's x is its word's left edge times PT with nothing in
      // between to absorb an error. Measured worst case over this page is 0.0005pt,
      // which is the .toFixed(3) the writer rounds to; the tolerance is 100× that
      // and still 20× under the 1pt shift this was mutation-tested against.
      let worstX = { d: -1 }
      let worstY = { d: -1 }
      for (const i of flat) {
        const dx = Math.abs(runs[i].x - dom.words[i].left * PT)
        if (dx > worstX.d) worstX = { d: dx, i }
        const dy = Math.abs((pageH - runs[i].y) / PT - (dom.words[i].top + dom.words[i].ascent))
        if (dy > worstY.d) worstY = { d: dy, i }
      }
      check(`all ${flat.length} untransformed origins sit on their own word's left edge`,
        worstX.d <= 0.05,
        `worst ${worstX.d.toFixed(4)}pt on ${JSON.stringify(runs[worstX.i].text)} (tolerance 0.05pt)`)
      // The one claim about y that a client rect alone cannot make: the rect says
      // where the inline box is, not where the baseline inside it is. The fixture
      // measures that from the layout (a zero-height inline-block sits on the
      // baseline), so this compares the layer's baseline against the one the raster
      // is painted on — the same number reached two different ways. text-layer takes
      // it from an independent probe in that artifact document; a 1pt slide still leaves every baseline inside
      // its own box, and lands 1.33px out here.
      check(`all ${flat.length} untransformed baselines land on the line Chromium laid out`,
        worstY.d <= 0.05,
        `worst ${worstY.d.toFixed(4)}px on ${JSON.stringify(runs[worstY.i].text)} (tolerance 0.05px)`)
      // Keep the oracle honest: its expected side comes from DOM Range geometry,
      // while this mutation touches only the parsed PDF operator. If those ever
      // become the same data in disguise, a planted one-CSS-pixel Tm shift stops
      // being visible here.
      const planted = flat.length
        ? Math.abs((pageH - (runs[flat[0]].y + PT)) / PT -
          (dom.words[flat[0]].top + dom.words[flat[0]].ascent))
        : 0
      check('the independent artifact oracle rejects a planted 1px baseline shift',
        planted > 0.9, `${planted.toFixed(4)}px detected`)

      // Tz is the correction from the substitute's advance to the browser's, so
      // multiplying it back by the substitute's own metrics must give the width the
      // DOM reported. The metrics come from the face the FILE names, which is what
      // makes this catch a run measured against one base-14 font and written in
      // another, and a Tz that hit its clamp. The defaults keep a run that already
      // failed a check above from throwing here; a green run never reaches them.
      const natural = await page.evaluate((jobs) => window.__natural(jobs),
        runs.map(x => [canvasFont(res.get(x.font) || 'Helvetica', x.size), x.text || ' ']))
      let worstW = { d: -1 }
      for (const i of flat) {
        const painted = (runs[i].tz / 100) * natural[i]
        const want = dom.words[i].width * PT
        const d = Math.abs(painted / want - 1)
        if (d > worstW.d) worstW = { d, i, painted, want }
      }
      check(`all ${flat.length} untransformed advances match their own word box`,
        worstW.d <= 0.005,
        `worst ${(worstW.d * 100).toFixed(4)}% on ${JSON.stringify(runs[worstW.i].text)} — ` +
        `${worstW.painted.toFixed(4)}pt painted vs ${worstW.want.toFixed(4)}pt measured (tolerance 0.5%)`)

      check('a word that really wrapped exercises the per-fragment path',
        dom.wrapped.length > 0,
        dom.wrapped.join(', ') || 'no word broke across lines, so every run above is a whole word')

      // A rotated run cannot be compared against an axis-aligned rect: the DOM
      // reports the AABB of the turned box and the origin is a point inside it. So
      // invert the map instead — W = |a|w + |c|h and H = |b|w + |d|h solve for the
      // run's own width and height whenever |a||d| ≠ |b||c| — every angle but 45°,
      // the singularity text-layer sidesteps by MEASURING the advance rather than
      // solving for it. The origin is then the AABB centre displaced by
      // (−w/2, ascent − h/2) through the same matrix. Measured under 0.005px on both
      // stamps; a 1pt shift of either content axis puts it 1.3px out, and a text
      // matrix whose b is not sign-flipped puts it 17–34px out.
      check('the two stamps are the only rotated runs on the page',
        turned.length === 2, `${turned.length} rotated run(s)`)
      for (const i of turned) {
        const run = runs[i], b = dom.words[i]
        // The written matrix is the CSS linear part conjugated by the y flip.
        const L = { a: run.a, b: -run.b, c: -run.c, d: run.d }
        const det = Math.abs(L.a * L.d) - Math.abs(L.c * L.b)
        const label = `${JSON.stringify(run.text)} at ${fmt(Math.atan2(L.b, L.a) * 180 / Math.PI)}°`
        if (!check(`${label}: its box is invertible, so the projection is defined`,
          Math.abs(det) > 0.05, `det ${fmt(det)} — |a||d| = |b||c| at 45°`)) continue
        const w = (b.width * Math.abs(L.d) - b.height * Math.abs(L.c)) / det
        const h = (b.height * Math.abs(L.a) - b.width * Math.abs(L.b)) / det
        const dx = -w / 2
        const dy = b.ascent - h / 2
        const ox = b.left + b.width / 2 + L.a * dx + L.c * dy
        const oy = b.top + b.height / 2 + L.b * dx + L.d * dy
        const off = Math.hypot(run.x / PT - ox, (pageH - run.y) / PT - oy)
        check(`${label}: origin is the DOM box projected through the run's own matrix`,
          off <= 0.25, `${off.toFixed(4)}px off (tolerance 0.25px)`)
      }

      const hrefs = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll('#target a')].map(a => a.href))].sort())
      const annotated = [...new Set(r.pages[0].annots.map(an => an.url))].sort()
      check('every anchor on the page is annotated, and nothing else is',
        JSON.stringify(annotated) === JSON.stringify(hrefs),
        `${annotated.join(' ') || 'none'} vs ${hrefs.join(' ')}`)
    },
  },

  {
    /**
     * The one fixture that does not take the DOM's word for it.
     *
     * The other geometric assertions compare the PDF against layout boxes — source
     * DOM for older focused probes, the canonical final artifact for align/fuzz — so
     * they catch arithmetic between measuring and writing. They are structurally
     * blind to the failure a reader actually meets: the RASTER disagreeing with the
     * layout it was measured against. snapdom says so itself, on this very page — "text in
     * inline/table-cell elements kept its natural width and may re-wrap under
     * font-fallback rasterization", which the fixture asserts it still says, because
     * a page of block <p>s never provokes it. When that re-wrap happens the layer is
     * perfectly aligned to the DOM, visibly wrong against the pixels, and every
     * geometry-only check above stays green.
     *
     * So this one reads the pixels. For each word it finds the first and last COLUMN
     * carrying ink inside that line's band, and then the first and last ROW carrying
     * ink inside that word's own columns, in three images measured by one pair of
     * scans:
     * Chromium's own paint, snapdom's capture, and the finished PDF's page. Then it
     * asserts the text layer's own advance box, displaced by the word's MEASURED side
     * bearing, lands on those columns, and its baseline, displaced by the word's
     * measured ink ascent and descent, lands on those rows.
     *
     * The bearings are why a naive `ink.left === origin.x` does not hold: ink starts
     * and stops within 2.3px of the ends of its own advance box, on either side of
     * them. Usually inside — but measured here the left bearing runs -1.17 to +2.28px
     * and the right -2.08 to +1.88px, and 13 to 15 of these 38 words, depending on the
     * threshold, ink PAST one end of their box: "serif" runs 2.08px beyond its right
     * edge, "jumpy" starts 1.00px left of its left one. At threshold 192 two words
     * ("roman", "jumpy") ink past BOTH ends at once; at 64 and 128 none does.
     * Vertically the ink reaches 7.3 to 21.0px above
     * the baseline and anywhere from 0.2px above it to 5.0px below — per word, per
     * face, per size. They are measured off Chromium's pixels rather than modelled,
     * which is the only reason a per-word comparison at half-pixel tolerances is
     * possible at all.
     *
     * The row scan is what makes the vertical claim a pixel claim. Without it the
     * suite compares every baseline against layout and nothing against ink, and a
     * capture displaced downwards by a CSS pixel is green everywhere — `align`
     * included, because it asks the canonical artifact's boxes, not its pixels.
     *
     * Tolerances. One device column, 0.5px at scale 2, is the finest displacement
     * either scan can express, so every budget below is a count of columns and each
     * count is its own measurement's rather than a round number. The capture against
     * Chromium is held to HALF a column on both axes, because its residual is not
     * small but exactly zero — the two images ink the same first and last column and
     * the same first and last row at all 38 words at all three thresholds — so a whole
     * column there was budget nothing had bought, and on a `<=` against a quantised
     * scan it was exactly enough to let one device column of displacement, on every
     * word of the page, pass green. The shipped page against the capture gets a column
     * on each axis, because that channel's zero is not structural: its JPEG really
     * does move an edge by one device pixel, 6 edges in 456 on this page, three of
     * them column edges and three row edges. The two-term checks (layer against
     * capture) carry a column plus the control's own budget, so that a one-column
     * raster defect reddens the check that names the raster instead of the ones that
     * name the layer. No maximum can answer in anything finer than a whole column, so
     * where one still carries a column — the shipped page — the MEANS are what reads
     * inside it: they average a SIGNED displacement over every word and every edge, and
     * a page image moved wholesale reads 0.500 there where the JPEG's two edges read
     * 0.013.
     *
     * None of that is slack, and the headroom is not what the residuals suggest. The
     * four checks that name the layer read 0.001–0.004px because the capture and
     * Chromium's paint land on the SAME column and the SAME row, 0.000, at every word
     * and every threshold — what is left in those four is the layer's own error
     * against the DOM. That identity is structural rather than lucky: snapdom
     * rasterizes through Blink's own SVG/foreignObject path, at the same scale, from
     * the same layout. What the margin actually is, per channel, mutation-measured by
     * displacing the capture inside snapdom's own return value and the page image
     * inside the `cm` that places it:
     *   - capture against Chromium: 0.0025px of uniform displacement on either axis
     *     reddens the check that names that axis, and 0.001px does not — because
     *     0.001px moves no ink edge at any of the three thresholds, so there is
     *     nothing on this page for an ink scan to see. Half a device column (0.25px)
     *     on one line of three words, or on every line with the sign alternating and
     *     on both axes at once, is red. So is a stretch of half a device pixel over
     *     the width of the page.
     *     That floor is DIRECTIONAL, and this is the file's one real miss: negative
     *     displacements are 12-35x coarser, because a word's first inked column only
     *     moves when ink crosses it. One word displaced -0.175px is 35/35 green with
     *     a visibly different raster.png. Closing it means correlating the two images
     *     rather than scanning them for edges, which is a different instrument.
     *   - shipped page against the capture: its placement is snapped to whole device
     *     pixels before it is rasterized, so 0.24px of displacement changes no pixel
     *     of the page at all — every edge of every word lands where it did — and
     *     0.2533px moves EVERY edge by a whole one and reddens the mean. The step is
     *     at half a device pixel and there is no fraction to resolve on either side of
     *     it; the mean is what separates a page moved wholesale from the two edges the
     *     JPEG moves.
     *   - layer against the DOM: 0.05px vertical and 0.067px horizontal, the control's
     *     own budget, which is finer than any ink check and reddens first.
     *
     * What it still cannot see: anything the scan cannot separate. Ink is a column or
     * a row with a dark pixel in it, so this says where a word's ink BEGINS and ENDS
     * on both axes and nothing about the glyphs between — a letter swapped for another
     * of the same extent is invisible here. Between the capture and the shipped page,
     * one device pixel on up to six of the 76 edges that channel compares is inside
     * the budget the JPEG bought and stays silent — the seventh reddens the mean, and
     * two device pixels on any one edge reddens the max. A vertical displacement of the
     * capture by anything that is not a whole number of device rows reddens the columns
     * as well as the rows, because resampling the rows under a column can carry its
     * fringe across the threshold and shorten it; the row check reddens too, so the
     * reader is never sent to the wrong axis, but the extra red is there — and a whole
     * number of rows (`ry1`, `ry2`, `ry12`) reddens the rows alone, which is how the
     * two are told apart. The one place that still inverts is a vertical STRETCH of the
     * page image:
     * measured, 0.05% reddens the page's column max at 1.000px while its row max sits
     * exactly on its one-row budget — the mean is what names the axis there, and it
     * prints -0.224px on y against -0.026px on x. It reads one page of upright WinAnsi
     * text on white with the words held apart, so rotation, pagination, Type0, form
     * controls, clipping and colour all stay where their own fixtures are; a capture
     * that bled past the element box would move the origin every number here is
     * measured from, which is why the viewBox is pinned on both axes before any of
     * them run; and the capture it scans is a second call to snapdom, not the bytes
     * inside the PDF — which is what the three checks on the shipped page are for.
     */
    name: 'raster',
    async run() {
      const dom = await page.evaluate(() => window.__words())
      const live = await livePixels('raster', '#target')

      // One band per laid-out line, and the words the DOM put on it.
      const bands = []
      for (let i = 0; i < dom.words.length; i++) {
        const w = dom.words[i]
        const b = bands[w.line] || (bands[w.line] = { top: Infinity, bottom: -Infinity, idx: [] })
        b.top = Math.min(b.top, w.top)
        b.bottom = Math.max(b.bottom, w.top + w.height)
        b.idx.push(i)
      }

      check(`every probe word is one client rect (${dom.words.length} words on ${bands.length} lines)`,
        dom.words.every(w => w.rects === 1),
        dom.words.filter(w => w.rects !== 1).map(w => `${w.text}×${w.rects}`).join(' '))

      // A band that reached into its neighbour would scan two lines' ink as one, and
      // every group index below would be off by a word. The row scan looks INK_PAD
      // past both edges of a band, so the requirement is that much stronger here than
      // "they do not touch": two pads must fit in the gap and still leave the padded
      // window short of the next line's own box.
      let closest = Infinity
      for (let i = 1; i < bands.length; i++) closest = Math.min(closest, bands[i].top - bands[i - 1].bottom)
      check(`no two bands touch, and ${INK_PAD}px of row-scan padding fits twice between them`,
        closest > 2 * INK_PAD, `closest pair ${fmt(closest)}px apart, padding ${INK_PAD}px`)

      // A line with room to spare slides sideways under a bad capture; only a line
      // near its box edge falls onto a second one. Losing that is losing the fixture's
      // reach, and nothing else here would report it.
      const trip = await page.evaluate(() => {
        const p = document.getElementById('tripwire')
        const range = document.createRange()
        range.selectNodeContents(p)
        const rects = [...range.getClientRects()]
        return { used: Math.max(...rects.map(r => r.width)), avail: parseFloat(getComputedStyle(p).width), lines: rects.length }
      })
      check('the tripwire line is one drift away from wrapping, so a re-wrap is reachable',
        trip.lines === 1 && trip.used > trip.avail * 0.8 && trip.used < trip.avail,
        `${fmt(trip.used)}px of ${fmt(trip.avail)}px on ${trip.lines} line(s)`)

      // renderScale 2/PT puts the PDF's own page on the same 2× grid as the capture,
      // so all three images are scanned in one coordinate space.
      const { real, r } = await standard('raster', { compress: false }, { renderScale: 2 / PT })
      check('single page', r.numPages === 1, `got ${r.numPages}`)

      // Assert the risky layout directly: current core no longer emits the legacy
      // font-fallback prose. The pixel/text alignment assertions below still gate fidelity.
      check('the raster fixture retains inline and table text', await page.evaluate(() =>
        !!document.querySelector('span') && !!document.querySelector('td')
      ))

      // Every comparison below is asserted at each of these, so the ink threshold is
      // not a tuned constant: it is a midpoint whose value the result survives a 3×
      // change of. `scale: 2` is index.js's own default, which is what the PDF just
      // above was written with.
      const THRESHOLDS = [64, INK_DARK, 192]
      /**
       * The PDF page's own channel is compared at the DARKEST threshold alone. The
       * page image is JPEG — encodeImage writes /DCTDecode on every path, whatever
       * `compress` does to the content streams — so quantisation carries the
       * antialiased fringe of a glyph across the threshold and leaves its core where
       * it is. Measured on this page it costs one or two of the 38 words a single
       * device pixel at every threshold, but not on the same axis at each: at 64 the
       * page inks exactly the columns the capture does at all 38 words and two words'
       * top rows move; at 128 one word's left column moves and one word's bottom row;
       * at 192 two words' right columns move and no row does. Six edge moves in 456,
       * all of them exactly one device pixel, spread evenly over the two axes.
       * Pooling the three thresholds would put a column into both of this channel's
       * maxima; the darkest leaves the column comparison exact and the row comparison
       * carrying only what its own check accounts for below.
       */
      const PDF_TH = Math.min(...THRESHOLDS)
      const scan = await page.evaluate(INK, {
        live, hostId: 'h-raster', thresholds: THRESHOLDS, pad: INK_PAD,
        gap: INK_GAP, scale: 2, pageCssW: r.pages[0].width / PT,
        bands: bands.map(b => ({ top: b.top, bottom: b.bottom })),
      })

      if (!check('the capture reported a viewBox to scale by', !!scan.vb,
        scan.vb ? '' : 'no viewBox in the snapdom data URL — the raster origin is unknowable')) return
      // Under a bleed the raster starts left of and above the element box, and column
      // 0 is no longer x 0, nor row 0 y 0. index.js predicts that offset; here it must
      // be absent on BOTH axes, so that the mapping this fixture uses is the identity
      // it claims to be — the row scan leans on the vertical half of that as hard as
      // the column scan leans on the horizontal.
      near('the raster viewBox is the element box, so column 0 is its left edge',
        scan.vb[0], scan.rect.width, 0.5, 'px')
      near('the raster viewBox is the element box, so row 0 is its top edge',
        scan.vb[1], scan.rect.height, 0.5, 'px')
      near('the raster scale is the canvas over the viewBox', scan.rasterS, 2, 0.005)
      near('the PDF page rendered onto the same grid', scan.pdfS, scan.rasterS, 0.005)
      near('the live screenshot is on the same grid', scan.liveS, scan.rasterS, 0.005)
      /** One raster pixel — the finest disagreement either scan can express. */
      const TOL = 1 / scan.rasterS

      // The one layout constant the scan is given. Both populations are measured off
      // the page itself: a scan at single-column resolution splits every line into
      // letters, and a gap is inside a word when its midpoint is inside a word's box.
      // Measured at every threshold the segmentation is certified at, and taken the
      // conservative way round on each side: a fringe that counts as ink only at 192
      // would narrow the gaps BETWEEN words, and its absence at 64 would widen the
      // ones inside. On this page all three thresholds land on the same 4.00 and
      // 33.00 — but the constant was certified over a range it was only measured at
      // one point of, and now it is not.
      let insideWord = 0
      let betweenWords = Infinity
      for (let l = 0; l < bands.length; l++) {
        for (const th of THRESHOLDS) {
          const g = scan.bands[l].letters[th]
          for (let i = 1; i < g.length; i++) {
            const d = g[i].left - g[i - 1].right
            const mid = (g[i - 1].right + g[i].left) / 2
            if (bands[l].idx.some(k => mid > dom.words[k].left && mid < dom.words[k].left + dom.words[k].width)) {
              insideWord = Math.max(insideWord, d)
            } else betweenWords = Math.min(betweenWords, d)
          }
        }
      }
      check(`the ${INK_GAP}px word gap sits between the two gap populations this page has`,
        insideWord * 2 <= INK_GAP && INK_GAP * 2 <= betweenWords,
        `widest inside a word ${fmt(insideWord)}px, narrowest between two ${fmt(betweenWords)}px`)

      // Same pairing as `align`: run i is word i, so a dropped or reordered run is a
      // divergence at a known index instead of a word the matcher quietly skipped.
      const runs = streamRuns(real.raw)
      const res = fontResources(real.raw)
      const sized = check(`the stream carries one run per painted word (${dom.words.length})`,
        runs.length === dom.words.length, `${runs.length} runs vs ${dom.words.length} words`)
      let diff = -1
      for (let i = 0; i < Math.min(runs.length, dom.words.length) && diff < 0; i++) {
        if (runs[i].text !== dom.words[i].text) diff = i
      }
      check('every run carries the word painted at its own place, in document order', diff < 0,
        diff < 0 ? '' : `run ${diff} is ${JSON.stringify(runs[diff].text)}, the DOM has ${JSON.stringify(dom.words[diff].text)}`)
      if (!sized || diff >= 0) return
      check('every run is upright, so its advance box is axis-aligned', runs.every(uprightRun))

      const natural = await page.evaluate((jobs) => window.__natural(jobs),
        runs.map(x => [canvasFont(res.get(x.font) || 'Helvetica', x.size), x.text || ' ']))

      // page:'fit' means margin 0 and drawScale 1, so a run's x IS its word's left
      // edge in CSS px times PT, Tz times the substitute's own advance is what the run
      // will actually paint, and a run's y is its baseline measured up from the page
      // bottom. The DOM's own baseline is the top of the word's box plus the ascent
      // the fixture reads off the LAYOUT — text-layer reads its ascent from canvas
      // font metrics, so the two are the same number reached two different ways.
      const pageH = r.pages[0].height
      const layerBox = (i) => {
        const left = runs[i].x / PT
        return { left, right: left + (runs[i].tz / 100) * natural[i] / PT }
      }
      const layerBase = (i) => (pageH - runs[i].y) / PT
      const domBase = (i) => dom.words[i].top + dom.words[i].ascent

      /** The control tolerances, in the units their own comparison is made in. */
      const CTRL_X = 0.05   // pt
      const CTRL_Y = 0.05   // px
      // The control, and the reason everything below it exists. This is what every
      // other fixture asserts — the layer against the DOM it was measured from — at
      // `align`'s own tolerances, and it runs FIRST so that a red ink check is read
      // next to a green one and not instead of it. Green here and red below is the
      // raster disagreeing with the DOM: the failure nothing else in this suite sees.
      let domX = { d: -1 }
      let domY = { d: -1 }
      let domW = { d: -1 }
      for (let i = 0; i < runs.length; i++) {
        const dx = Math.abs(runs[i].x - dom.words[i].left * PT)
        if (dx > domX.d) domX = { d: dx, i }
        const dy = Math.abs(layerBase(i) - domBase(i))
        if (dy > domY.d) domY = { d: dy, i }
        const dw = Math.abs((runs[i].tz / 100) * natural[i] / (dom.words[i].width * PT) - 1)
        if (dw > domW.d) domW = { d: dw, i }
      }
      check(`control: all ${runs.length} origins sit on their word's left edge in the DOM`,
        domX.d <= CTRL_X, `worst ${domX.d.toFixed(4)}pt on ${JSON.stringify(runs[domX.i].text)} (tolerance ${CTRL_X}pt)`)
      check(`control: all ${runs.length} baselines sit on the line the DOM laid out`,
        domY.d <= CTRL_Y, `worst ${domY.d.toFixed(4)}px on ${JSON.stringify(runs[domY.i].text)} (tolerance ${CTRL_Y}px)`)
      check(`control: all ${runs.length} advances match their word box in the DOM`,
        domW.d <= 0.005, `worst ${(domW.d * 100).toFixed(4)}% on ${JSON.stringify(runs[domW.i].text)} (tolerance 0.5%)`)

      const wrongGroups = new Set()
      /** Worst over every word, and separately over every threshold: the point of
       *  scanning at three is that the answer does not depend on which, and only the
       *  per-threshold spread shows that. A single "at threshold N" cannot — strict
       *  `>` means the first threshold always wins a tie, and ties are the normal
       *  case here. */
      const worst = () => ({ d: -1, text: '', per: {} })
      const take = (best, d, th, text) => {
        best.per[th] = Math.max(best.per[th] ?? -1, d)
        if (d > best.d) { best.d = d; best.text = text }
      }
      const bear = worst()
      const worstLive = worst()
      const worstLiveV = worst()
      const worstPdf = worst()
      const worstPdfV = worst()
      const worstL = worst()
      const worstR = worst()
      const worstT = worst()
      const worstB = worst()
      /** The one figure below that is a MINIMUM: how much of the padded row window is
       *  still blank above and below a word's live ink. It is the room a displacement
       *  has to move into before the window clips it and the defect reads as smaller
       *  than it is. */
      let room = { d: Infinity, text: '', th: 0 }
      /**
       * Signed, and averaged over every word and every edge. A per-word maximum is
       * quantised to a device column and can only ever answer in whole ones; but a
       * whole image placed wrong displaces every word by the SAME fraction, while the
       * JPEG that costs the comparison a column moves one word's edge and not its
       * neighbour's. So a mean over 38 words whose ink edges fall at unrelated
       * sub-pixel phases resolves a displacement well under the column the scan is
       * made of, and it is the only thing here that can.
       *
       * Where that buys reach is the channel whose maximum still carries a column: the
       * shipped page against the capture. On the capture against Chromium the maximum
       * is held to half a column, so it reddens the moment any single edge of any word
       * disagrees, and its mean can no longer be the first to fire. That one is kept
       * for what a maximum of absolute values cannot say — which way the image moved,
       * and by how much on average rather than at its worst word — and because it is
       * the reading that survives if the two scans ever stop sharing one lattice.
       */
      const mean = () => ({ sum: 0, n: 0 })
      const add = (m, ...ds) => { for (const d of ds) { m.sum += d; m.n++ } }
      const avg = (m) => (m.n ? m.sum / m.n : NaN)
      const meanRX = mean()
      const meanRY = mean()
      const meanPX = mean()
      const meanPY = mean()
      for (const th of THRESHOLDS) {
        for (let l = 0; l < bands.length; l++) {
          const g = scan.bands[l][th]
          const n = bands[l].idx.length
          const words = bands[l].idx.map(k => dom.words[k].text).join(' ')
          if (g.raster.length !== n || g.live.length !== n || g.pdf.length !== n) {
            wrongGroups.add(`"${words}" is ${n} word(s) but inks ${g.live.length} group(s) live, ` +
              `${g.raster.length} in the raster, ${g.pdf.length} in the PDF page`)
            continue
          }
          for (let j = 0; j < n; j++) {
            const i = bands[l].idx[j]
            const w = dom.words[i]
            const lv = g.live[j]
            const rs = g.raster[j]
            const pf = g.pdf[j]
            const box = layerBox(i)
            // Side bearing: how far inside its own advance box this word's ink starts
            // and how far short of the end it stops, straight off Chromium's pixels.
            const bearL = lv.left - w.left
            const bearR = (w.left + w.width) - lv.right
            // The same quantity on the other axis: how far above the baseline this
            // word's ink reaches and how far below it stops. Also off Chromium's
            // pixels, and per word — "pygmy" has a descender and "LARGE CAPS ROW"
            // does not, so no single font metric would do.
            const bearT = lv.top - domBase(i)
            const bearB = lv.bottom - domBase(i)
            take(bear, Math.max(Math.abs(bearL), Math.abs(bearR)), th, w.text)
            take(worstLive, Math.max(Math.abs(rs.left - lv.left), Math.abs(rs.right - lv.right)), th, w.text)
            take(worstLiveV, Math.max(Math.abs(rs.top - lv.top), Math.abs(rs.bottom - lv.bottom)), th, w.text)
            take(worstL, Math.abs(rs.left - (box.left + bearL)), th, w.text)
            take(worstR, Math.abs(rs.right - (box.right - bearR)), th, w.text)
            take(worstT, Math.abs(rs.top - (layerBase(i) + bearT)), th, w.text)
            take(worstB, Math.abs(rs.bottom - (layerBase(i) + bearB)), th, w.text)
            add(meanRX, rs.left - lv.left, rs.right - lv.right)
            add(meanRY, rs.top - lv.top, rs.bottom - lv.bottom)
            if (th === PDF_TH) {
              take(worstPdf, Math.max(Math.abs(pf.left - rs.left), Math.abs(pf.right - rs.right)), th, w.text)
              take(worstPdfV, Math.max(Math.abs(pf.top - rs.top), Math.abs(pf.bottom - rs.bottom)), th, w.text)
              add(meanPX, pf.left - rs.left, pf.right - rs.right)
              add(meanPY, pf.top - rs.top, pf.bottom - rs.bottom)
            }
            const clear = Math.min(lv.clearT, lv.clearB)
            if (clear < room.d) room = { d: clear, text: w.text, th }
          }
        }
      }

      // A re-wrap is visible here before any coordinate is compared: the words moved
      // to another line, so the line they left inks one group fewer than it has words.
      check('every line inks exactly one group per word the browser put on it',
        wrongGroups.size === 0, [...wrongGroups].slice(0, 3).join(' | '))
      // Group j is word j only while the counts agree. Past that the coordinates
      // below would compare a word against whichever one took its place.
      if (wrongGroups.size) return

      const at = (best, tol, ths = THRESHOLDS) =>
        `worst ${best.d.toFixed(3)}px on ${JSON.stringify(best.text)} — ` +
        `${ths.map(t => best.per[t].toFixed(3)).join('/')} at threshold${ths.length > 1 ? 's' : ''} ` +
        `${ths.join('/')} (tolerance ${tol.toFixed(3)}px)`

      /**
       * The budget for a comparison that names the LAYER: one device column, plus the
       * control's own budget from just above. Those comparisons are sums — ink is
       * (raster − Chromium) + (DOM − layer) — so on a bare one-column budget a raster
       * displaced by exactly one column would trip them while the check that names the
       * RASTER stayed inside its own column, and the reader would be sent to debug the
       * layer over a defect in the capture.
       *
       * With the control's budget carried on top, the origin check and the two
       * baseline checks can only redden once one of their own two terms has. The
       * advance check is the exception, by construction: its second term is a WIDTH
       * error, and the control that bounds that one is relative — 0.5% is 0.63px on
       * the longest word here — so it stays the sharpest reading of Tz on the page and
       * can go red on its own.
       */
      const INK_TOL = TOL + CTRL_X / PT
      const INK_TOL_V = TOL + CTRL_Y

      // Stated before they are used: without them the four comparisons below are a
      // different, weaker claim that happens to have the same numbers in it.
      check('the side bearing is larger than the tolerance, so compensating for it matters',
        bear.d > TOL, `worst |bearing| ${bear.d.toFixed(3)}px on ${JSON.stringify(bear.text)} vs a ${TOL}px tolerance`)
      check(`the row window is blank around every word's ink, so a shift moves an edge instead of being clipped`,
        room.d > TOL, `least room ${room.d.toFixed(3)}px on ${JSON.stringify(room.text)} at threshold ${room.th} ` +
        `(padding ${INK_PAD}px, tolerance ${TOL}px)`)

      // The four that are the point of the file: the layer's own box, displaced by the
      // measured bearings, against the ink of the capture that ships under it.
      check(`all ${dom.words.length} words: the layer's origin lands on the raster's first inked column`,
        worstL.d <= INK_TOL, at(worstL, INK_TOL))
      check(`all ${dom.words.length} words: the layer's advance ends on the raster's last inked column`,
        worstR.d <= INK_TOL, at(worstR, INK_TOL))
      check(`all ${dom.words.length} words: the layer's baseline sits the measured ascent under the raster's first inked row`,
        worstT.d <= INK_TOL_V, at(worstT, INK_TOL_V))
      check(`all ${dom.words.length} words: the layer's baseline sits the measured descent over the raster's last inked row`,
        worstB.d <= INK_TOL_V, at(worstB, INK_TOL_V))

      // Which side of a failure to look at. snapdom's capture against Chromium's own
      // paint is the re-wrap itself; the PDF's page against the capture is everything
      // downstream of it — JPEG, the placement cm, and pdf.js drawing it back. These
      // carry ONE term each, so they are what a red check above is triaged against:
      // green here and red above is the layer, red here is the capture or the page
      // image.
      /**
       * HALF a device column, for the two comparisons whose residual is not merely
       * small but exactly zero. Every edge any of the three scans reports is a whole
       * pixel index over that image's own scale, and all three scales are exactly 2,
       * pinned above — so a disagreement between two of them is a whole number of
       * columns or it does not exist; there is no value between 0.000 and 0.500 for
       * any of these checks to read. Measured, snapdom's capture and Chromium's paint
       * ink the same first and last column and the same first and last row at every
       * one of the 38 words, at every threshold: 0.000, 228 edges per axis, no
       * exceptions. That identity is structural rather than lucky — snapdom rasterizes
       * through Blink's own SVG/foreignObject path, at the same scale, from the same
       * layout — and it held at 0.000 through all 16 mutation runs that left the
       * capture itself alone, four of which relaid the whole page out. So the whole
       * column this check used to carry was budget nothing had bought, and `<=` against
       * a quantised scan spent it on precisely the failure it was
       * built for: one device column out, on every word of the page, on both axes
       * at once, reads 0.500 and passes. At half a column the first column of
       * disagreement anywhere on the page is a red, and a quarter of one on a single
       * line of three words is too.
       */
      const EXACT_TOL = TOL / 2
      check(`all ${dom.words.length} words: snapdom's raster inks the columns Chromium does`,
        worstLive.d <= EXACT_TOL, at(worstLive, EXACT_TOL))
      check(`all ${dom.words.length} words: snapdom's raster inks the rows Chromium does`,
        worstLiveV.d <= EXACT_TOL, at(worstLiveV, EXACT_TOL))
      // The page's own two keep a whole column each, for a reason the two above do not
      // have: their zero is not structural, it is this page's luck at this threshold.
      // The JPEG fringe demonstrably moves an edge by one device pixel here — 6 edges
      // in 456, spread over both axes and all three thresholds — and while the column
      // comparison reads 0.000 on the page as it stands, hand the encoder the same page
      // rendered a hair differently and it reads 0.500: it did in 16 of the 49 mutation
      // runs that left the page's own placement alone, which is exactly the evidence
      // that says a zero measured once is not a zero to budget against. A column is the
      // artefact's own magnitude, and that is what these two are permitted, no more.
      check(`all ${dom.words.length} words: the shipped PDF page inks the columns the capture does`,
        worstPdf.d <= TOL, at(worstPdf, TOL, [PDF_TH]))
      // Measured, on the rows the artefact costs exactly two of this page's 38 words
      // one row at the top edge — 0.500px, the finest thing the scan can express — and
      // nothing anywhere else, on any word, on either edge. So the budget is that one
      // row, and over those same 49 runs it never once read more. The second row this
      // check used to carry was margin against the measurement rather than anything the
      // measurement bought, and it doubled what a misplaced page image could hide: a
      // `cm` that drops the page image 0.8px reads 1.000px here, which passed a two-row
      // budget on the `<=` and does not pass a one-row one.
      // Under a row it is the mean below that reads this
      // channel, and that is the arrangement: the max prices the artefact in, the mean
      // prices it out by dividing it over every edge on the page.
      check(`all ${dom.words.length} words: the shipped PDF page inks the rows the capture does`,
        worstPdfV.d <= TOL, at(worstPdfV, TOL, [PDF_TH]))

      /** Edges the JPEG moves by exactly one device pixel, over the edges a mean is
       *  taken across. It is the whole of the residual on all four means, and it is
       *  not jitter but an exact fraction: measured, 2 of the 76 on the shipped page's
       *  rows — the -0.013px this file prints is 2 x 0.5 / 76 to the last digit — and
       *  0 of 76 on its columns, 0 of 228 on each axis of the capture's. Over 204 runs
       *  that left the page's placement alone — each handing the encoder a differently
       *  rendered image of the same page — it reaches THREE edges (0.020px) and never
       *  more, though the word carrying it moves around ("width", "Heavy", "serif",
       *  "proves", …). */
      const MEAN_SHARE = 2 / 76
      /** Three times that incidence — six edges in 76 rather than two, which is
       *  0.039px against the 0.500 the maxima above are held to. It is the only
       *  instrument here that can see under one column: a whole image placed wrong
       *  displaces every edge, where the JPEG displaces two, so the two cases separate
       *  by an order of magnitude in the mean and not at all in a maximum. The budget
       *  is a COUNT of edges and lands exactly on the lattice the mean is quantised
       *  to, which is the point of it: six edges is the JPEG's and seven is a defect,
       *  with `<=` deciding a boundary that is exact rather than approached. */
      const MEAN_TOL = 3 * MEAN_SHARE * TOL
      check(`snapdom's raster is not displaced against Chromium's paint by a fraction of a column`,
        Math.abs(avg(meanRX)) <= MEAN_TOL && Math.abs(avg(meanRY)) <= MEAN_TOL,
        `mean x ${avg(meanRX).toFixed(3)}px, mean y ${avg(meanRY).toFixed(3)}px over ${meanRX.n} edges ` +
        `(tolerance ${MEAN_TOL.toFixed(3)}px)`)
      check(`the shipped PDF page is not displaced against the capture by a fraction of a column`,
        Math.abs(avg(meanPX)) <= MEAN_TOL && Math.abs(avg(meanPY)) <= MEAN_TOL,
        `mean x ${avg(meanPX).toFixed(3)}px, mean y ${avg(meanPY).toFixed(3)}px over ${meanPX.n} edges ` +
        `(tolerance ${MEAN_TOL.toFixed(3)}px)`)
    },
  },

  {
    name: 'forms',
    async run() {
      const { items: box } = await page.evaluate(PROBES)
      // fields:false on purpose: this fixture owns the TEXT LAYER's treatment of
      // control values. The default — values as fillable /AcroForm fields — is
      // asserted at the end, and in depth by test/megacheck.mjs.
      const { r } = await standard('forms', { fields: false })
      const pageH = r.pages[0].height

      present(r, 'AdaLovelace')
      present(r, 'PlaceholderProbe')
      present(r, 'TEXTAREASTART')
      present(r, 'TEXTAREAEND')
      present(r, 'WebkitOption')
      present(r, 'NameLabel')

      absent(r, 'Sup3rSecretValue', 'password values are never painted')
      absent(r, 'ChromiumOption', 'unselected <option>s are not painted')
      absent(r, 'FirefoxOption', 'unselected <option>s are not painted')

      const input = needItem(r, 'nameinput', 'AdaLovelace')
      if (input) checkInside('nameinput', input, box.nameinput, pageH, 3)

      // A <select> paints its value inset past its own content box by a few px that
      // no layout metric reports. Chromium's own pixels are the expectation.
      const ink = await inkLeft('#target select')
      const sel = box.engineselect
      check('the select value is inset past its content box', ink >= 11,
        `first inked column at +${ink}px, content box at +9px`)
      const option = needItem(r, 'engineselect', 'WebkitOption')
      if (option) near('select value origin is where Chromium paints the glyphs',
        toCssX(option), sel.left + ink, 2.5, 'px')

      // The default: a captured form is still a form. The value moves into the
      // field's /V — where a filler edits it and pdf.js extracts it — and OUT of
      // the invisible layer, so no extraction returns it twice.
      const fielded = await makePdf('forms-fielded', { compress: false })
      const fr = await analyze(fielded, { hostId: 'h-forms-fielded' })
      const fieldedText = fr.pages.flatMap(p => p.items.map(i => i.str)).join(' ')
      check('with fields on, the value lives in /AcroForm and leaves the layer',
        fielded.raw.includes('/AcroForm') && fielded.raw.includes('/V (AdaLovelace)') &&
        !fieldedText.includes('AdaLovelace'),
        fielded.raw.includes('/AcroForm') ? 'AcroForm present' : 'AcroForm missing')
      check('password fields are written empty, with the password flag',
        !fielded.raw.includes('Sup3rSecretValue'), 'password value leaked')
    },
  },

  {
    name: 'shadow',
    async run() {
      // fields:false — SHADOWINPUTVALUE is a text-layer assertion.
      const { r } = await standard('shadow', { fields: false })
      exactlyOnce(r, 'LIGHTOUTSIDE')
      exactlyOnce(r, 'SHADOWHEADING')
      // The one that catches a walker descending both the light tree and the slot.
      exactlyOnce(r, 'SLOTTEDTITLE')
      exactlyOnce(r, 'NESTEDSHADOWTEXT')
      exactlyOnce(r, 'SHADOWINPUTVALUE')
    },
  },

  {
    /**
     * Navigation. Three things are one thing here — an in-document link, a
     * bookmark and a named destination all resolve to the same `/XYZ` point — so
     * they are asserted together, against a document long enough that a forward
     * jump has to name a page it is not on. A destination that quietly collapses
     * to page 1 is the failure this fixture exists to catch, and on a one-page
     * document it is invisible.
     */
    name: 'nav',
    async run() {
      const from = pageLog.length
      const { real, r } = await standard('nav', { page: 'a4', margin: 24 })
      check('the document paginates, so a forward jump crosses pages',
        r.numPages >= 3, `${r.numPages} page(s)`)

      // —— bookmarks ——
      const titles = r.outline.map(o => o.title)
      const wantTitles = ['MANUALTITLE', 'INTROHEAD', 'MIDDLEHEAD', 'DEEPHEAD',
        'ANÁLISIS 日本語', 'SLOTTEDHEAD', 'SHADOWONLYHEAD']
      check('every painted heading is a bookmark, in document order, exactly once',
        JSON.stringify(titles) === JSON.stringify(wantTitles), titles.join(' | ') || 'none')
      check('a display:none heading is not a bookmark', !titles.includes('NEVERSHOWN'))

      const depth = Object.fromEntries(r.outline.map(o => [o.title, o.depth]))
      const dest = Object.fromEntries(r.outline.map(o => [o.title, o.dest]))
      check('h2 nests under the h1', depth.INTROHEAD === 1, String(depth.INTROHEAD))
      // The one that catches a level gap being read as a level: DEEPHEAD is an h3
      // under an h2 that has no id, and it must not be promoted for it.
      check('h3 nests under its own h2', depth.DEEPHEAD === 2, String(depth.DEEPHEAD))

      for (const title of ['INTROHEAD', 'MIDDLEHEAD', 'DEEPHEAD', 'SLOTTEDHEAD']) {
        const d = dest[title]
        if (!d) { check(`bookmark "${title}" has a destination`, false, 'none'); continue }
        check(`bookmark "${title}" keeps the reader's zoom`, d.kind === 'XYZ', String(d.kind))
        const item = d.page === null ? null : r.pages[d.page].items.find(i => strip(i.str).includes(title))
        check(`bookmark "${title}" names the page its heading is actually on`,
          !!item, `points at page ${d.page === null ? '?' : d.page + 1}`)
        // The destination is the TOP of the heading box and the item is its
        // BASELINE, so one sits above the other by about an ascent — never below
        // it, which is what an off-by-one-page or a flipped axis would look like.
        if (item) near(`bookmark "${title}" sits an ascent above its own baseline`,
          d.y - item.y, 14, 14, 'pt')
      }

      // —— links ——
      const annots = r.pages.flatMap(p => p.annots)
      const external = annots.filter(a => a.url)
      const internal = annots.filter(a => a.dest)
      check('the external link is still a URI',
        external.length === 1 && external[0].url === 'https://snapdom.dev/nav',
        external.map(a => a.url).join(' ') || 'none')
      check('every in-document link jumps inside the FILE, not back to the web page',
        internal.length === 5, `${internal.length} of 5`)
      // 7 anchors, one of them pointing at nothing: the file must carry 6.
      check('a fragment with no target gets no annotation rather than a link to page 1',
        annots.length === 6, `${annots.length} annotations`)
      check('the dead fragment is reported', pageLog.slice(from).some(l =>
        /in-document link\(s\) got no annotation|no element for/.test(l)),
        pageLog.slice(from).filter(l => l.includes('snapdom-pdf')).join(' | ') || 'nothing warned')

      // Every link's point against every fragment's point, as sets: which
      // annotation is which is not knowable from the file, but "the five links
      // resolve to exactly these five places" is, and it is the whole claim.
      const spot = (d) => (d ? `p${d.page + 1}@${d.y.toFixed(2)}` : 'none')
      const got = internal.map(a => spot(a.dest)).sort()
      const want = [
        spot({ page: 0, y: r.pages[0].height }),          // #top
        spot(dest.MANUALTITLE), spot(dest.INTROHEAD),
        spot(dest.DEEPHEAD), spot(dest['ANÁLISIS 日本語']),
      ].sort()
      check('each in-document link resolves to exactly the point its fragment names',
        JSON.stringify(got) === JSON.stringify(want), `${got.join(' ')} vs ${want.join(' ')}`)
      check('a link to a later section really does name a later page',
        dest.DEEPHEAD.page > 0 && internal.some(a => a.dest.page === dest.DEEPHEAD.page),
        `DEEPHEAD is on page ${dest.DEEPHEAD.page + 1}`)

      // —— named destinations ——
      check('a heading keeps its own id as its destination name, so `nav.pdf#intro` works',
        !!r.named.intro && r.named.intro.page === dest.INTROHEAD.page,
        Object.keys(r.named).join(' ') || 'none')
      const anon = Object.values(r.named).some(d =>
        d && d.page === dest.MIDDLEHEAD.page && Math.abs(d.y - dest.MIDDLEHEAD.y) < 0.01)
      check('a heading with no id still gets a name, so every bookmark is addressable',
        anon, Object.keys(r.named).join(' '))

      // A name tree is binary-searched by conforming readers, so an unsorted one
      // resolves to the wrong destination in every reader that is not pdf.js.
      // Slice to the array's own `]`: a fixed window used to work only because
      // nothing with parentheses followed within it — the trailer /Info does now.
      const at = real.raw.indexOf('/Names [')
      const close = at < 0 ? -1 : real.raw.indexOf(']', at)
      const names = at < 0 ? [] : [...real.raw.slice(at, close < 0 ? at + 4000 : close)
        .matchAll(/\(([^)]*)\)/g)].map(m => m[1])
      check('the destination name tree is sorted',
        names.length > 0 && JSON.stringify(names) === JSON.stringify([...names].sort()),
        names.join(' ') || 'no name tree')

      check('a paginated document with bookmarks opens the outline panel',
        r.pageMode === 'UseOutlines', String(r.pageMode))

      // —— the outline is optional, the navigation is not ——
      const off = await analyze(await makePdf('nav-flat', { page: 'a4', margin: 24, outline: false }),
        { hostId: 'h-nav-flat' })
      check('outline:false writes no bookmarks', off.outline.length === 0, `${off.outline.length}`)
      check('outline:false leaves in-document links working',
        off.pages.flatMap(p => p.annots).filter(a => a.dest).length === 5,
        `${off.pages.flatMap(p => p.annots).filter(a => a.dest).length} of 5`)
      check('outline:false opens no panel', !off.pageMode || off.pageMode !== 'UseOutlines',
        String(off.pageMode))

      // A selector replaces the h1–h6 walk. PDF measures SnapDOM's canonical final
      // SVG, where open shadow and slotted content have already been flattened into
      // ordinary descendants; the selector therefore sees both painted headings.
      const pickedFrom = pageLog.length
      const picked = await analyze(await makePdf('nav-picked',
        { page: 'a4', margin: 24, outline: 'h2' }), { hostId: 'h-nav-picked' })
      check('an outline selector lists exactly what the flattened final artifact matches',
        JSON.stringify(picked.outline.map(o => o.title)) ===
          JSON.stringify(['INTROHEAD', 'MIDDLEHEAD', 'ANÁLISIS 日本語', 'SLOTTEDHEAD', 'SHADOWONLYHEAD']),
        picked.outline.map(o => o.title).join(' | ') || 'none')
      check('a flattened artifact emits no stale shadow-root selector warning',
        !pageLog.slice(pickedFrom).some(l => /heading\(s\).*shadow root/.test(l)),
        pageLog.slice(pickedFrom).filter(l => l.includes('shadow root')).join(' | ') || 'none')
      fs.rmSync(path.join(OUT, 'nav-picked.pdf'), { force: true })
    },
  },

  {
    /**
     * Everything a paginated DOCUMENT has that the captured element does not:
     * cover, generated index, running heads, page number, watermark, colophon.
     * None of it had a test before this fixture — the geometry suite only ever
     * exported `#target`.
     *
     * The load-bearing assertion is the one that joins two of them: the number
     * the index PRINTS beside a heading against the number PRINTED on the page
     * that heading is on. Those come from different code and different inputs,
     * and nothing else in the file notices when they drift apart.
     */
    name: 'furniture',
    async run() {
      const opts = {
        page: 'a4',
        margin: 24,
        header: { left: 'HEADLEFT', right: { $format: 'HEADRIGHT{page}OF{pages}' } },
        footer: { element: '#brand' },
        pageNumbers: true,
        cover: '#cover',
        back: '#colophon',
        toc: { title: 'INDEXTITLE' },
        watermark: 'WATERMARKSTAMP',
      }
      const { r } = await standard('furniture', opts)
      const perPage = r.pages.map(p => strip(pageText(p)))
      const on = (needle) => perPage.map((t, i) => (t.includes(needle) ? i : -1)).filter(i => i >= 0)

      // —— page order ——
      check('the cover is page 1', on('COVERPAGE')[0] === 0, `page ${on('COVERPAGE')[0] + 1}`)
      check('the index follows the cover', on('INDEXTITLE')[0] === 1, `page ${on('INDEXTITLE')[0] + 1}`)
      // The index lists DOCUMENTTITLE too, so the FIRST occurrence is the index
      // page — the body's copy is the first one past the front matter.
      const bodyAt = (needle) => on(needle).find(i => i >= 2)
      check('the body follows the index', bodyAt('DOCUMENTTITLE') === 2, `page ${bodyAt('DOCUMENTTITLE') + 1}`)
      check('the colophon is the last page', on('LEGALCOLOPHON')[0] === r.numPages - 1,
        `page ${on('LEGALCOLOPHON')[0] + 1} of ${r.numPages}`)

      // —— a cover is not a picture of a cover ——
      // The whole reason front matter carries a text layer: legal text nobody can
      // search or copy is a photograph of a contract.
      check('the cover carries selectable text, not just pixels',
        perPage[0].includes('COVERPAGE') && perPage[0].includes('COVERSUBTITLE'), perPage[0].slice(0, 80))
      check('the colophon carries selectable text',
        perPage[r.numPages - 1].includes('COLOPHONBODY'), perPage[r.numPages - 1].slice(0, 80))
      check('a cover link remains interactive after full-page fitting',
        r.pages[0].annots.some(a => a.url === 'https://snapdom.dev/cover'),
        r.pages[0].annots.map(a => a.url || 'internal').join(' | ') || 'no annotations')
      check('a cover-local fragment resolves inside the cover artifact',
        r.pages[0].annots.some(a => a.dest?.page === 0),
        r.pages[0].annots.map(a => a.dest ? `p${a.dest.page + 1}` : a.url).join(' | '))
      check('a cover fragment can jump to a destination in the body',
        r.pages[0].annots.some(a => a.dest?.page >= 2),
        r.pages[0].annots.map(a => a.dest ? `p${a.dest.page + 1}` : a.url).join(' | '))
      check('a back-matter link remains interactive after full-page fitting',
        r.pages[r.numPages - 1].annots.some(a => a.url === 'https://snapdom.dev/back'),
        r.pages[r.numPages - 1].annots.map(a => a.url || 'internal').join(' | ') || 'no annotations')

      // Present is not placed. A layer that is in the file but half an inch off
      // its own glyphs looks identical to this test until you try to select a
      // word — so the cover's own fit is recomputed here from the DOM and the run
      // has to land on it.
      const cover = await page.evaluate(() => {
        const el = document.getElementById('cover')
        const box = el.getBoundingClientRect()
        const probe = document.getElementById('coverprobe').getBoundingClientRect()
        const cs = getComputedStyle(document.getElementById('coverprobe'))
        return {
          w: box.width, h: box.height,
          x: probe.left - box.left, top: probe.top - box.top,
          size: parseFloat(cs.fontSize),
        }
      })
      const coverItem = itemStartingWith(r, 'COVERPAGE', 0)
      if (check('the cover title is its own run', !!coverItem)) {
        // The same fit `fullPageOps` performs: scale to the page, never crop.
        const ratio = cover.h / cover.w
        let cw = r.pages[0].width
        let ch = cw * ratio
        if (ch > r.pages[0].height) { ch = r.pages[0].height; cw = ch / ratio }
        // Points per CSS px, which already carries PT: `cw` is points and
        // `cover.w` is CSS px, so dividing one by the other IS the whole map.
        const s = cw / cover.w
        const x0 = (r.pages[0].width - cw) / 2
        const y0 = (r.pages[0].height - ch) / 2
        near('cover run x is its DOM box scaled by the page fit',
          coverItem.x, x0 + cover.x * s, 2, 'pt')
        near('cover run size is its DOM size scaled by the page fit',
          Math.hypot(coverItem.a, coverItem.b), cover.size * s, 1, 'pt')
        // The baseline sits an ascent below the box top; asserting the box top is
        // above the baseline and within one line of it pins the flip without
        // needing the font's ascent.
        const boxTop = y0 + ch - cover.top * s
        check('cover run sits just under its own box top',
          coverItem.y < boxTop && coverItem.y > boxTop - cover.size * s * 1.4,
          `baseline ${fmt(coverItem.y)} vs box top ${fmt(boxTop)}`)
      }

      // —— running heads and numbers, on the body and NOWHERE else ——
      const bodyPages = perPage.map((t, i) => i).filter(i => i > 1 && i < r.numPages - 1)
      check('every body page carries the running head',
        bodyPages.every(i => perPage[i].includes('HEADLEFT')), on('HEADLEFT').join(','))
      check('the running head knows its own page number',
        bodyPages.every((i, n) => perPage[i].includes(`HEADRIGHT${n + 1}OF${bodyPages.length}`)),
        bodyPages.map(i => (/HEADRIGHT\d+OF\d+/.exec(perPage[i]) || ['none'])[0]).join(' '))
      check('the captured footer band is on every body page',
        bodyPages.every(i => perPage[i].includes('FOOTBRAND')) ||
        // A captured band is a raster: it has no text layer, so its absence from
        // the extracted text is expected and only its presence would be news.
        on('FOOTBRAND').length === 0, on('FOOTBRAND').join(','))
      check('no running head strays onto the cover, the index or the colophon',
        !perPage[0].includes('HEADLEFT') && !perPage[1].includes('HEADLEFT') &&
        !perPage[r.numPages - 1].includes('HEADLEFT'),
        on('HEADLEFT').join(','))
      // Read off the UNSTRIPPED text: stripped, a running head ending in a digit
      // runs straight into the page number and "…OF4" + "1 / 4" reads as "41 / 4".
      const numbered = r.pages.map(p => /\b(\d+) \/ (\d+)\b/.exec(pageText(p)) || null)
      check('every body page prints its number, and only body pages do',
        bodyPages.every(i => numbered[i]) && !numbered[0] && !numbered[1] && !numbered[r.numPages - 1],
        numbered.map((m, i) => `p${i + 1}:${m ? m[0] : '—'}`).join(' '))
      check('the printed count is the number of BODY pages, not of sheets',
        numbered[bodyPages[0]] && Number(numbered[bodyPages[0]][2]) === bodyPages.length,
        `${numbered[bodyPages[0]] && numbered[bodyPages[0]][0]} across ${bodyPages.length} body pages`)

      // —— the watermark ——
      check('the watermark is on every page, cover and colophon included',
        perPage.every(t => t.includes('WATERMARKSTAMP')),
        perPage.map((t, i) => (t.includes('WATERMARKSTAMP') ? '' : `p${i + 1}`)).filter(Boolean).join(' ') || 'all')

      // —— the index ——
      const tocAnnots = r.pages[1].annots.filter(a => a.dest)
      check('every index line is a live jump', tocAnnots.length === 6, `${tocAnnots.length} of 6`)
      check('the index lists every heading',
        ['DOCUMENTTITLE', 'SECTIONALPHA', 'SECTIONBETA', 'SECTIONGAMMA', 'SECTIONDELTA', '日本語報告']
          .every(h => perPage[1].includes(h)), perPage[1].slice(0, 160))
      check('every index jump lands on a body page',
        tocAnnots.every(a => a.dest.page >= 2 && a.dest.page < r.numPages - 1),
        tocAnnots.map(a => `p${a.dest.page + 1}`).join(' '))

      // The one that matters. Each index line's printed number, read back off the
      // page that line jumps to.
      const listed = [...perPage[1].matchAll(/(DOCUMENTTITLE|SECTIONALPHA|SECTIONBETA|SECTIONGAMMA|SECTIONDELTA|日本語報告)(\d+)/g)]
        .map(m => ({ title: m[1], label: m[2] }))
      check('the index prints a number beside every heading it lists',
        listed.length === 6, `${listed.length} of 6: ${perPage[1].slice(0, 200)}`)
      const wrong = listed.filter(({ title, label }) => {
        const at = bodyAt(title)
        const printed = at === undefined ? null : numbered[at]
        return !printed || printed[1] !== label
      })
      check('every number the index prints is the number printed on the page it names',
        listed.length === 6 && wrong.length === 0,
        wrong.map(w => `${w.title} says ${w.label}`).join(', ') || `${listed.length} entries`)

      // —— a script base-14 cannot address ——
      // The Type0 font carries NO GLYPHS, by design, so painting it is undefined:
      // pdf.js substitutes a system face and looks fine, Acrobat has nothing to
      // draw. The index shows such a heading by CROPPING IT OUT OF THE RASTER
      // instead — pixels snapdom already drew — with the invisible text over it.
      const plain = await makePdf('furniture-plain', { ...opts, compress: false })
      const painted = [...plain.raw.matchAll(/BT (\d) Tr \/(\w+)/g)]
      check('the glyph-less Type0 font is never PAINTED, only written invisibly',
        painted.every(m => m[2] !== 'FU' || m[1] === '3'),
        painted.filter(m => m[2] === 'FU' && m[1] !== '3').map(m => m[0]).join(' ') || 'none painted')
      check('a non-Latin index line is a crop of the raster, not typeset text',
        pageLog.some(l => /index line\(s\) show the heading's own pixels/.test(l)),
        pageLog.filter(l => l.includes('index line')).join(' | ') || 'nothing reported')
      check('and it is still searchable',
        perPage[1].includes('日本語報告'), perPage[1].slice(0, 200))

      // —— the index at other settings ——
      // An index long enough to need a second page, no leaders, and a watermark
      // that is an ELEMENT rather than a string: three options with no coverage,
      // and the first is the one that silently drops entries when it is wrong.
      const big = await makePdf('furniture-toc', {
        ...opts, compress: false,
        toc: { title: 'INDEXTITLE', size: 50, dots: false },
        watermark: { element: '#stamp', opacity: 0.2 },
      })
      const bigR = await analyze(big, { hostId: 'h-furniture-toc' })
      const bigPages = bigR.pages.map(p => strip(pageText(p)))
      // An index page is the one between the cover and the colophon that carries
      // neither a page number nor a running head — front matter takes neither.
      const idx = bigPages
        .map((text, i) => ({ text, i }))
        .filter(({ text, i }) => i > 0 && i < bigR.numPages - 1 &&
          !/\d+ \/ \d+/.test(pageText(bigR.pages[i])) && !text.includes('HEADLEFT'))
        .map(({ i }) => i)
      check('an index too long for one page runs onto a second', idx.length === 2,
        `${idx.length} index page(s) of ${bigR.numPages}`)
      const headings = ['DOCUMENTTITLE', 'SECTIONALPHA', 'SECTIONBETA',
        'SECTIONGAMMA', 'SECTIONDELTA', '日本語報告']
      // Prefixes, not whole titles: at size 50 a long heading legitimately runs out
      // of room and is cut with an ellipsis. What must not happen is a LINE going
      // missing at the page break.
      const listedBig = headings.filter(h => idx.some(i => bigPages[i].includes(h.slice(0, 9))))
      check('no entry is lost to the index page break',
        listedBig.length === 6, `${listedBig.length} of 6: ${idx.map(i => bigPages[i]).join(' | ').slice(0, 200)}`)
      check('every index page keeps its jumps live',
        idx.every(i => bigR.pages[i].annots.filter(a => a.dest).length > 0),
        idx.map(i => bigR.pages[i].annots.length).join('/'))
      check('dots:false draws no leader rule', !/\[0\.7 [\d.]+\] 0 d/.test(big.raw))
      check('an element watermark is a stamp, not a string',
        !bigPages.some(t => t.includes('WATERMARKSTAMP')) && /\/GSw gs/.test(big.raw),
        bigPages[0].slice(0, 60))

      const lean = await analyze(await makePdf('furniture-levels', { ...opts, toc: { levels: 1 } }),
        { hostId: 'h-furniture-levels' })
      const leanIdx = strip(pageText(lean.pages[1]))
      check('toc levels:1 lists the top tier only',
        leanIdx.includes('DOCUMENTTITLE') && !leanIdx.includes('SECTIONALPHA'), leanIdx.slice(0, 120))
      for (const f of ['furniture-toc', 'furniture-levels']) {
        fs.rmSync(path.join(OUT, `${f}.pdf`), { force: true })
      }

      // —— every page of a document is a tagged page ——
      // Untagged content inside a tagged file is content a reader may skip, so the
      // pages that are NOT the capture have to carry structure too — and the
      // colophon is where the legal text lives.
      const rolesOn = (p) => {
        const out = []
        const walk = (n) => { if (n && n.role) out.push(n.role); for (const k of (n && n.children) || []) walk(k) }
        walk(r.pages[p].structTree)
        return out
      }
      check('every page carries a structure tree, front and back matter included',
        r.pages.every((_, i) => rolesOn(i).length > 0),
        r.pages.map((_, i) => `p${i + 1}:${rolesOn(i).length}`).join(' '))
      check('the cover is structured, not a bare picture',
        rolesOn(0).includes('Sect'), rolesOn(0).join(' ') || 'none')
      check('the generated index announces itself as one',
        rolesOn(1).includes('TOC'), rolesOn(1).join(' ') || 'none')
      check('the colophon is structured, so its legal text is readable in order',
        rolesOn(r.numPages - 1).includes('Sect'), rolesOn(r.numPages - 1).join(' ') || 'none')

      // —— several images, several answers ——
      // A document with a cover, a footer band and a body raster can beat BOTH
      // fixed codecs, because `auto` decides per image: the prose page wants
      // Flate and a gradient cover wants DCT, and no single setting gives both.
      const [asJpeg, asFlate] = [
        await makePdf('furniture-jpeg', { ...opts, codec: 'jpeg' }),
        await makePdf('furniture-flate', { ...opts, codec: 'flate' }),
      ]
      const auto = fs.statSync(path.join(OUT, 'furniture.pdf')).size
      check('across a whole document auto is never worse than either fixed codec',
        auto <= asJpeg.bytes.length && auto <= asFlate.bytes.length,
        `auto ${auto} vs jpeg ${asJpeg.bytes.length} vs flate ${asFlate.bytes.length}`)
      for (const f of ['furniture-jpeg', 'furniture-flate']) {
        fs.rmSync(path.join(OUT, `${f}.pdf`), { force: true })
      }

      // —— the index page is not the body ——
      check('the index does not count itself into the page numbers',
        !numbered[1], perPage[1].slice(0, 120))

      // —— and none of it happens on a page that has nowhere to put it ——
      const fit = await analyze(await makePdf('furniture-fit',
        { ...opts, page: 'fit' }), { hostId: 'h-furniture-fit' })
      check("page:'fit' is one page — no cover, no index, no colophon", fit.numPages === 1,
        `${fit.numPages} pages`)
      check("page:'fit' still takes the watermark, which needs no room",
        strip(pageText(fit.pages[0])).includes('WATERMARKSTAMP'))
      check("page:'fit' says why the rest did nothing",
        pageLog.some(l => /cover, back and toc need a paginated page size/.test(l)),
        pageLog.filter(l => l.includes('snapdom-pdf')).slice(0, 3).join(' | ') || 'nothing warned')
    },
  },

  {
    /**
     * The structure tree, read back through pdf.js's own `getStructTree()`.
     *
     * Reading it back rather than grepping the bytes is the whole point: pdf.js
     * only returns a tree when the /ParentTree resolves, and the parent tree is
     * the half that is easy to write wrong and invisible in a structure
     * inspector. A file can look perfectly tagged and give a screen reader
     * nothing.
     */
    name: 'tagged',
    async run() {
      const { real, r } = await standard('tagged', { compress: false })
      const tree = r.pages[0].structTree
      if (!check('pdf.js can walk the structure tree', !!tree,
        tree ? '' : 'none returned — the /ParentTree did not resolve')) return

      /** Every role in the tree, depth-first, with the text its content covers. */
      const flat = []
      const walk = (node, depth, parents) => {
        if (!node) return
        if (node.role) {
          flat.push({ role: node.role, depth, parents })
          parents = [...parents, node.role]
        }
        for (const kid of node.children || []) walk(kid, depth + 1, parents)
      }
      walk(tree, 0, [])
      const roles = flat.map(f => f.role)
      const has = (role) => roles.includes(role)
      const parentOf = (role) => (flat.find(f => f.role === role) || { parents: [] }).parents

      check('the document is marked as tagged',
        /\/MarkInfo << \/Marked true >>/.test(real.raw) && /\/StructTreeRoot/.test(real.raw))
      check('the document declares its language', /\/Lang \(en\)/.test(real.raw),
        (/\/Lang [^\n]*/.exec(real.raw) || ['none'])[0])

      check('headings keep their level', has('H1') && has('H2'), roles.join(' '))
      check('an aria heading becomes the level it claims', has('H3'), roles.join(' '))
      check('paragraphs are paragraphs', has('P'))
      check('a list is a list of items', has('L') && has('LI'), roles.join(' '))
      check('a table has header cells and data cells',
        has('Table') && has('TH') && has('TD'), roles.join(' '))
      check('table rows sit under the table', parentOf('TR').includes('Table'),
        parentOf('TR').join('>') || 'none')
      check('cells sit under a row', parentOf('TD').includes('TR'), parentOf('TD').join('>') || 'none')
      check('a section groups what is inside it', has('Sect'), roles.join(' '))
      check('a figure keeps its caption', has('Figure') && has('Caption'), roles.join(' '))

      // Inline emphasis must NOT be its own element: a node per span is richer on
      // paper and unusable in practice.
      check('inline emphasis does not become structure', !has('Span'), roles.join(' '))

      check('alternative text reaches the file', /\/Alt \(TAGGEDALTTEXT\)/.test(real.raw),
        (/\/Alt [^\n]*/.exec(real.raw) || ['none'])[0])
      check('a paragraph in another language says so', /\/Lang \(fr\)/.test(real.raw),
        (/\/Lang \(fr\)/.exec(real.raw) || ['none'])[0])

      // ——— what must NOT be content ———
      // The raster is a picture of the same words the layer carries. Tagged as
      // content it would have a screen reader announce a full-page image over the
      // text it duplicates.
      /** Is every occurrence of `needle` inside an open /Artifact block? */
      const artifacted = (raw, needle) => {
        let at = -1
        let n = 0
        let bad = 0
        while ((at = raw.indexOf(needle, at + 1)) >= 0) {
          n++
          const before = raw.slice(0, at)
          const bmc = before.lastIndexOf('/Artifact BMC')
          if (bmc < 0 || before.lastIndexOf('EMC') > bmc) bad++
        }
        return { n, bad }
      }
      const img = artifacted(real.raw, '/Im0 Do')
      check('every draw of the page image is inside an artifact',
        img.n > 0 && img.bad === 0, `${img.bad} of ${img.n} draw(s) outside`)

      // Every marked-content id on the page must be claimed by exactly one struct
      // element, or the parent tree points somewhere that does not exist.
      const mcids = [...real.raw.matchAll(/<<\/MCID (\d+)>> BDC/g)].map(m => Number(m[1]))
      check('marked content is numbered densely from zero',
        mcids.length > 0 && mcids.every((n, i) => n === i),
        `${mcids.length} ids: ${mcids.slice(0, 8).join(',')}…`)
      const mcrs = (real.raw.match(/\/Type \/MCR/g) || []).length
      check('every marked run is claimed by exactly one structure element',
        mcrs === mcids.length, `${mcrs} references for ${mcids.length} marks`)

      // ——— the escape hatch ———
      const off = await makePdf('tagged-off', { tagged: false, compress: false })
      check('tagged:false writes no structure at all',
        !/\/StructTreeRoot/.test(off.raw) && !/BDC/.test(off.raw) && !/\/Artifact/.test(off.raw))
      const offR = await analyze(off, { hostId: 'h-tagged-off' })
      check('tagged:false still says the same words',
        strip(allText(offR)) === strip(allText(r)),
        `${strip(allText(offR)).length} vs ${strip(allText(r)).length} chars`)
      fs.rmSync(path.join(OUT, 'tagged-off.pdf'), { force: true })
    },
  },

  {
    /** Regressions for semantics that have no useful pixel-only assertion. */
    name: 'semantic',
    async run() {
      const from = pageLog.length
      const direct = await page.evaluate(async () => {
        const { collectTextLayer } = await import('/src/text-layer.js')
        const { collectNav } = await import('/src/nav.js')
        const { buildStructure } = await import('/src/tagged.js')
        const { collectBlocks, paginate } = await import('/src/paginate.js')
        const { numberSpec, bandSpec, bandHeight } = await import('/src/furniture.js')
        const target = document.getElementById('target')
        const layer = collectTextLayer(target)
        const nav = collectNav(target, { links: layer.links })
        const invalid = collectNav(target, { links: layer.links, headings: '[' })
        const structure = buildStructure(target, layer.owners)

        const nodes = []
        const visit = (node) => {
          nodes.push({ type: node.type, alt: node.alt, lang: node.lang, keep: node.keep === true })
          for (const child of node.children || []) visit(child)
        }
        visit(structure.root)

        const hiddenRun = layer.runs.findIndex(r => r.text.includes('STRUCTARIAHIDDEN'))
        const frenchRun = layer.runs.findIndex(r => r.text.includes('INHERITEDFRENCH'))
        const svg = layer.links.find(l => l.href.includes('#svgdest')) || null
        const unsafe = layer.links.filter(l => /^(?:javascript|data):/i.test(l.href))
        const privacyText = layer.runs.map(r => r.text).join(' ')
        const effectLink = layer.links.find(l => l.href === 'https://snapdom.dev/effect-secret') || null
        const partialLink = layer.links.find(l => l.href === 'https://snapdom.dev/partial-visible') || null
        const partialRect = document.getElementById('privacy-overflow').getBoundingClientRect()
        const passwordRun = layer.runs.find((r, i) => layer.owners[i]?.id === 'privacy-password') || null

        const blocks = collectBlocks(target)
        const tr = target.getBoundingClientRect()
        const pr = document.getElementById('long-prose').getBoundingClientRect()
        const lines = blocks.filter(b => !b.loose && !b.forced &&
          b.top >= pr.top - 1 && b.bottom <= pr.bottom + 1)
        const local = blocks.map(b => ({
          ...b, top: b.top - tr.top, bottom: b.bottom - tr.top,
        }))
        const out = paginate({ blocks: local, contentHeight: tr.height, availHeight: 260 })
        const cuts = out.slices.slice(0, -1).map(s => s.top + s.height + tr.top)
        const tornLine = cuts.some(y => lines.some(l => l.top < y - 1e-6 && l.bottom > y + 1e-6))

        return {
          href: svg && svg.href,
          unsafe: unsafe.map(l => l.href),
          titles: nav.outline.map(o => o.title),
          invalid: { count: invalid.outline.length, warnings: invalid.warnings },
          nodes,
          hiddenOwner: hiddenRun < 0 ? 'missing' : structure.ofRun[hiddenRun]?.type || null,
          frenchOwner: frenchRun < 0 ? null : structure.ofRun[frenchRun] && {
            type: structure.ofRun[frenchRun].type,
            lang: structure.ofRun[frenchRun].lang,
          },
          preRuns: layer.runs.filter((r, i) => layer.owners[i]?.closest('#pre-probe')).map(r => r.text),
          privacy: {
            text: privacyText,
            effectLink,
            partialLink,
            passwordRun: passwordRun && passwordRun.text,
            hasSafeShadow: privacyText.includes('SHADOWVISIBLESAFE'),
            hasAutoVisible: privacyText.includes('CONTENTAUTOVISIBLE'),
            partialRect: {
              left: partialRect.left, right: partialRect.right,
              top: partialRect.top, bottom: partialRect.bottom,
            },
            warnings: layer.warnings,
          },
          pagination: { lineCount: lines.length, tornLine },
          furniture: {
            numberSize: numberSpec({ size: 0 }).size,
            band: bandSpec({ center: 'SAFE', size: -2, gap: -4 }),
            badWidth: bandHeight(target, -100),
          },
        }
      })

      check('an SVG #fragment is normalized to the document absolute URL',
        direct.href === `${base}/test/fixtures/semantic.html#svgdest`, String(direct.href))
      check('active and data URL schemes never become PDF links',
        direct.unsafe.length === 0, direct.unsafe.join(' | '))
      check('opacity/filter/aria-hidden headings stay out of outline and TOC',
        !direct.titles.includes('OUTLINEOPACITYZERO') &&
        !direct.titles.includes('OUTLINEFILTERZERO') &&
        !direct.titles.includes('OUTLINEARIAHIDDEN'), direct.titles.join(' | '))
      check('aria-hidden descendants do not leak into a visible heading title',
        direct.titles.includes('OUTLINESAFE') && !direct.titles.some(t => t.includes('OUTLINESECRET')),
        direct.titles.join(' | '))
      const outlineSecrets = ['OUTLINECLIPSECRET', 'OUTLINEMASKSECRET',
        'OUTLINEBLURSECRET', 'OUTLINECOLORSECRET']
      check('paint-redacted headings stay out of bookmarks and generated TOC input',
        outlineSecrets.every(secret => !direct.titles.includes(secret)) &&
        direct.titles.includes('OUTLINEREASSERTED'),
        outlineSecrets.filter(secret => direct.titles.includes(secret)).join(' | ') || 'none')
      check('an invalid outline selector becomes one clear warning, not a DOMException',
        direct.invalid.count === 0 && direct.invalid.warnings.some(w => /invalid outline selector/i.test(w)),
        direct.invalid.warnings.join(' | '))

      const alt = (value) => direct.nodes.find(n => n.type === 'Figure' && n.alt === value)
      check('textless figure/img/role=img produce persistent Figure nodes with Alt',
        ['FIGUREONLYALT', 'IMAGEONLYALT', 'ROLEIMAGEONLYALT'].every(v => alt(v)?.keep),
        direct.nodes.filter(n => n.type === 'Figure').map(n => `${n.alt}:${n.keep}`).join(' | '))
      check('hidden or masked image alternatives are not marked persistent',
        !alt('MASKEDIMAGEALTSECRET')?.keep && !alt('HIDDENIMAGEALTSECRET')?.keep,
        direct.nodes.filter(n => /ALTSECRET$/.test(n.alt || '')).map(n => `${n.alt}:${n.keep}`).join(' | '))
      check('aria-hidden text has no tagged owner', direct.hiddenOwner === null, String(direct.hiddenOwner))
      check('language inherited through a transparent container reaches its structure node',
        direct.frenchOwner?.lang === 'fr', JSON.stringify(direct.frenchOwner))

      check('preformatted runs retain meaningful repeated spaces',
        direct.preRuns.join('').includes('PREALPHA    PREBETA') &&
        direct.preRuns.join('').includes('PRESECOND  COLUMN'),
        JSON.stringify(direct.preRuns))
      const paintSecrets = ['CLIPPATHSECRET', 'CLIPEFFECTLINKSECRET', 'MASKSECRET',
        'BLURSECRET', 'COLORTRANSPARENTSECRET', 'TEXTSECURITYSECRET', 'SVGPAINTSECRET',
        ...outlineSecrets]
      check('unmodelled clipping, masks, filters and invisible paint expose no text runs',
        paintSecrets.every(secret => !direct.privacy.text.includes(secret)),
        paintSecrets.filter(secret => direct.privacy.text.includes(secret)).join(' | ') || 'none')
      check('a link below an unmodelled visual effect is omitted',
        direct.privacy.effectLink === null, JSON.stringify(direct.privacy.effectLink))
      check('a partially clipped token is dropped whole, never leaked with its hidden suffix',
        !direct.privacy.text.includes('OVERFLOWPARTIALSECRET'),
        direct.privacy.text.includes('OVERFLOWPARTIALSECRET') ? 'secret present' : 'absent')
      const pl = direct.privacy.partialLink
      const prc = direct.privacy.partialRect
      check('a partially clipped link annotation is intersected with the visible overflow box',
        !!pl && pl.x >= prc.left - 0.25 && pl.y >= prc.top - 0.25 &&
        pl.x + pl.width <= prc.right + 0.25 && pl.y + pl.height <= prc.bottom + 0.25,
        pl ? `${pl.x},${pl.y} ${pl.width}x${pl.height} inside ${JSON.stringify(prc)}` : 'no link')
      check('privacy-safe omissions produce an explicit warning',
        direct.privacy.warnings.some(w => /visual effect|paint is invisible/i.test(w)),
        direct.privacy.warnings.join(' | '))
      check('password controls retain only same-length bullets, never their source value',
        direct.privacy.passwordRun === '•'.repeat('PASSWORDSOURCESECRET'.length) &&
        !direct.privacy.text.includes('PASSWORDSOURCESECRET'),
        JSON.stringify(direct.privacy.passwordRun))
      check('opaque text-shadow and visible content-visibility:auto remain selectable',
        direct.privacy.hasSafeShadow && direct.privacy.hasAutoVisible,
        `shadow=${direct.privacy.hasSafeShadow} auto=${direct.privacy.hasAutoVisible}`)
      check('long loose prose contributes line boundaries to pagination',
        direct.pagination.lineCount > 10 && !direct.pagination.tornLine,
        `${direct.pagination.lineCount} line spans; torn=${direct.pagination.tornLine}`)
      check('invalid furniture dimensions normalize to safe values',
        direct.furniture.numberSize === 9 && direct.furniture.band.size === 9 &&
        direct.furniture.band.gap === 10 && direct.furniture.badWidth === 0,
        JSON.stringify(direct.furniture))

      // fields:false — the redaction and bullet assertions live in the text layer.
      const { real, r } = await standard('semantic', { page: 'a4', margin: 24, compress: false, fields: false })
      const annots = r.pages.flatMap(p => p.annots)
      const written = streamRuns(real.raw).map(run => run.text)
      check('preformatted spacing survives in the finished PDF text operators',
        written.includes('PREALPHA    PREBETA') &&
        written.includes('PRESECOND  COLUMN'),
        JSON.stringify(written.filter(s => /PRE|COLUMN/.test(s || ''))))
      check('the SVG fragment is emitted as an internal destination, never /URI',
        annots.filter(a => a.dest).length === 1 &&
        !annots.some(a => a.url && a.url.includes('#svgdest')),
        annots.map(a => a.url || (a.dest && `page:${a.dest.page}`)).join(' | '))
      const structure = []
      const visitStructure = (node) => {
        if (!node) return
        structure.push(node)
        for (const child of node.children || []) visitStructure(child)
      }
      for (const p of r.pages) visitStructure(p.structTree)
      const figureAlts = structure.filter(n => n.role === 'Figure').map(n => n.alt)
      check('textless alternatives survive into the final PDF structure',
        ['FIGUREONLYALT', 'IMAGEONLYALT', 'ROLEIMAGEONLYALT']
          .every(v => figureAlts.includes(v)), figureAlts.join(' | '))
      check('hidden or masked alternatives are absent from the final PDF structure',
        !figureAlts.includes('MASKEDIMAGEALTSECRET') && !figureAlts.includes('HIDDENIMAGEALTSECRET') &&
        !real.raw.includes('MASKEDIMAGEALTSECRET') && !real.raw.includes('HIDDENIMAGEALTSECRET'),
        figureAlts.join(' | '))
      check('the inherited language survives into the final PDF',
        structure.some(n => n.role === 'P' && n.lang === 'fr'),
        structure.filter(n => n.lang).map(n => `${n.role}:${n.lang}`).join(' | '))
      const finalText = r.pages.flatMap(p => p.items.map(i => i.str)).join(' ')
      check('paint-redacted secrets stay absent from the finished PDF text layer',
        [...paintSecrets, 'OVERFLOWPARTIALSECRET', 'PASSWORDSOURCESECRET']
          .every(secret => !finalText.includes(secret)),
        [...paintSecrets, 'OVERFLOWPARTIALSECRET', 'PASSWORDSOURCESECRET']
          .filter(secret => finalText.includes(secret)).join(' | ') || 'none')
      check('safe shadow, auto visibility and password bullets survive in the finished PDF',
        finalText.includes('SHADOWVISIBLESAFE') && finalText.includes('CONTENTAUTOVISIBLE') &&
        finalText.includes('•'.repeat('PASSWORDSOURCESECRET'.length)),
        finalText.split(/\s+/).filter(s => /SHADOW|AUTO|•/.test(s)).join(' | '))
      check('paint-redacted heading titles stay absent from the finished PDF bytes',
        outlineSecrets.every(secret => !real.raw.includes(secret)),
        outlineSecrets.filter(secret => real.raw.includes(secret)).join(' | ') || 'none')
      check('the finished PDF has no annotation below an unmodelled visual effect',
        !annots.some(a => a.url === 'https://snapdom.dev/effect-secret'),
        annots.map(a => a.url).filter(Boolean).join(' | '))

      const invalid = await makePdf('semantic-invalid-outline', {
        page: 'a4', margin: 24, outline: '[', compress: false,
      })
      check('an invalid selector still produces a readable PDF',
        invalid.raw.startsWith('%PDF-1.7') && pageLog.slice(from).some(l => /invalid outline selector/i.test(l)),
        pageLog.slice(from).filter(l => /outline selector/i.test(l)).join(' | ') || 'no warning')
      fs.rmSync(path.join(OUT, 'semantic-invalid-outline.pdf'), { force: true })
    },
  },

  {
    name: 'hidden',
    async run() {
      const { r } = await standard('hidden')
      present(r, 'VISIBLEBASELINE')
      present(r, 'VISVISIBLEINSIDE')
      present(r, 'LOWOPACITYTEXT')
      absent(r, 'OPACITYZEROTEXT', 'an ancestor has opacity:0')
      absent(r, 'VISHIDDENTEXT', 'an ancestor has visibility:hidden')
      absent(r, 'DISPLAYNONETEXT', 'display:none')
    },
  },

  {
    name: 'clip',
    async run() {
      const probe = await page.evaluate(PROBES)
      const box = probe.items
      const { r } = await standard('clip')

      // Without this the absence assertions below are vacuous: content outside the
      // captured box is dropped by index.js's slice filter and culled again by
      // pdf.js, whether or not overflow clipping exists at all.
      for (const key of ['base', 'insideclip', 'outsideclip', 'scrolledaway', 'scrolledinview', 'scrolledbelow']) {
        const b = box[key]
        check(`${key} lies inside the captured box, so its absence can only be clipping`,
          b.top >= 0 && b.top + b.height <= probe.target.height,
          `${fmt(b.top)}…${fmt(b.top + b.height)}px of 0…${fmt(probe.target.height)}px`)
      }

      present(r, 'CLIPBASELINE')
      present(r, 'INSIDECLIP')
      present(r, 'SCROLLEDINTOVIEW')
      absent(r, 'OUTSIDECLIP', 'clipped away by an overflow:hidden ancestor')
      absent(r, 'SCROLLEDAWAY', 'scrolled above the visible part of its container')
      absent(r, 'SCROLLEDBELOW', 'scrolled below the visible part of its container')
    },
  },

  {
    name: 'alpha',
    async run() {
      // The card's centre is where its own white label is painted, so sample the
      // dark area above it instead — still well inside the card's rounded box.
      const { real, r } = await standard('alpha', {}, { backdrop: '#ff00ff', samples: [[0.03, 0.05], [0.5, 0.36]] })

      const images = (real.raw.match(/\/Subtype\s*\/Image/g) || []).length
      check('the page image carries an /SMask', /\/SMask\s/.test(real.raw))
      check('a soft-mask image XObject was written', images >= 2, `${images} image XObject(s)`)

      const [corner, centre] = r.pages[0].samples
      const isMagenta = (p) => p[0] > 200 && p[1] < 60 && p[2] > 200
      check('transparent corner lets the backdrop through', isMagenta(corner), `rgba(${corner})`)
      check('opaque card still covers the backdrop', !isMagenta(centre) && centre[0] < 90, `rgba(${centre})`)

      // Transparency and the lossless codec together: the /SMask is what makes a
      // capture with alpha possible at all, and it must survive whichever codec
      // carries the colour plane beside it. Flate needs no edge smear either —
      // that smear exists to give DCT ringing something to ring against — so this
      // is the one path where the colour plane is the capture untouched.
      const lossless = await makePdf('alpha-flate', { codec: 'flate' })
      // The colour space is whichever one the region's own pixels earned — this
      // card is few enough colours to travel indexed — so what is asserted is the
      // pairing that matters: a losslessly deflated colour plane in a space PDF
      // defines, with its mask still beside it.
      const space = (lossless.raw.match(
        /\/ColorSpace (\/DeviceRGB|\/DeviceGray|\[\/Indexed \/DeviceRGB \d+ <[0-9a-f]*>\]) \/Filter \/FlateDecode/
      ) || [])[1]
      check('codec:"flate" still writes the soft mask',
        !!space && /\/SMask\s/.test(lossless.raw), space ? `colour plane in ${space.slice(0, 40)}` : 'no flate image')
      const lr = await analyze(lossless, {
        hostId: 'h-alpha-flate', backdrop: '#ff00ff', samples: [[0.03, 0.05], [0.5, 0.36]],
      })
      const [lcorner, lcentre] = lr.pages[0].samples
      check('a lossless page is transparent in the same places',
        isMagenta(lcorner) && !isMagenta(lcentre) && lcentre[0] < 90,
        `corner rgba(${lcorner}), centre rgba(${lcentre})`)
      fs.rmSync(path.join(OUT, 'alpha-flate.pdf'), { force: true })

      present(r, 'TRANSPARENTCARD')
    },
  },

  {
    name: 'colorspace',
    async run() {
      // `encodeImage` narrows a page region to /DeviceGray or an /Indexed palette
      // when its pixels allow it — a third of the bytes, and the whole point is
      // that it costs NOTHING: the stream must decode back to the exact pixels the
      // capture drew. So this asks the encoder directly, with surfaces whose colour
      // content is known to the pixel, and inflates what comes back.
      const cases = await page.evaluate(async () => {
        const encodeImage = window.__encodeImage
        const W = 64, H = 64

        /** @param {(x:number,y:number)=>[number,number,number,number]} paint */
        const build = (paint, alpha = true) => {
          const c = Object.assign(document.createElement('canvas'), { width: W, height: H })
          const ctx = c.getContext('2d', { alpha, willReadFrequently: true })
          const img = ctx.createImageData(W, H)
          for (let y = 0, i = 0; y < H; y++) {
            for (let x = 0; x < W; x++, i += 4) {
              const [r, g, b, a] = paint(x, y)
              img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a
            }
          }
          ctx.putImageData(img, 0, 0)
          return c
        }

        const inflate = async (bytes) => new Uint8Array(await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
        ).arrayBuffer())

        /** The colour space the dictionary claims, plus its palette when indexed. */
        const readSpace = (dict) => {
          const indexed = dict.match(/\/ColorSpace \[\/Indexed \/DeviceRGB (\d+) <([0-9a-f]*)>\]/)
          if (indexed) {
            const hex = indexed[2]
            const palette = []
            for (let i = 0; i < hex.length; i += 6) palette.push(parseInt(hex.slice(i, i + 6), 16))
            return { kind: 'Indexed', hival: Number(indexed[1]), palette }
          }
          const plain = dict.match(/\/ColorSpace (\/DeviceGray|\/DeviceRGB)/)
          return { kind: plain ? plain[1].slice(1) : 'unknown' }
        }

        const run = async (label, canvas, expect) => {
          const encoded = await encodeImage(canvas, { codec: 'flate' })
          const space = readSpace(encoded.dict)
          const plane = await inflate(encoded.bytes)
          const want = canvas.getContext('2d').getImageData(0, 0, W, H).data

          // Rebuild RGB from whatever space the encoder chose, then compare against
          // the pixels that went in. A wrong space is not slower, it is different.
          let bad = -1
          const expectedLength = space.kind === 'DeviceRGB' ? W * H * 3 : W * H
          if (plane.length !== expectedLength) bad = -2
          else {
            for (let p = 0; p < W * H && bad < 0; p++) {
              let r, g, b
              if (space.kind === 'DeviceGray') { r = g = b = plane[p] }
              else if (space.kind === 'Indexed') {
                const rgb = space.palette[plane[p]]
                if (rgb === undefined) { bad = p; break }
                r = (rgb >> 16) & 255; g = (rgb >> 8) & 255; b = rgb & 255
              } else { r = plane[p * 3]; g = plane[p * 3 + 1]; b = plane[p * 3 + 2] }
              if (r !== want[p * 4] || g !== want[p * 4 + 1] || b !== want[p * 4 + 2]) bad = p
            }
          }

          // The mask carries the holes, and it is a plane of its own.
          let maskBad = -1
          if (encoded.smask) {
            const mask = await inflate(encoded.smask.bytes)
            if (mask.length !== W * H) maskBad = -2
            else for (let p = 0; p < W * H; p++) if (mask[p] !== want[p * 4 + 3]) { maskBad = p; break }
          }
          return {
            label, expect, got: space.kind, hival: space.hival ?? null,
            bytes: encoded.bytes.length, bad, maskBad, hasMask: !!encoded.smask,
          }
        }

        const out = []
        // Every pixel grey, across the whole 8-bit ramp — more distinct values than
        // a palette could hold, so grey is the only narrowing available.
        out.push(await run('every pixel grey', build((x, y) => {
          const v = (x * 4 + y) & 255
          return [v, v, v, 255]
        }), 'DeviceGray'))

        // One red pixel in a grey field. The cheap answer is "grey"; it is wrong,
        // and it would repaint that pixel.
        out.push(await run('grey but for one red pixel', build((x, y) =>
          (x === 31 && y === 31) ? [255, 0, 0, 255] : [(x * 4) & 255, (x * 4) & 255, (x * 4) & 255, 255]
        ), 'Indexed'))

        // Exactly 256 distinct colours, none of them grey: the last region a
        // palette can carry.
        out.push(await run('exactly 256 colours', build((x, y) => {
          const n = ((y * W + x) >> 4) & 255
          return [n, 255 - n, (n * 7 + 1) & 255, 255]
        }), 'Indexed'))

        // 257. One colour past the palette, and the answer must widen.
        out.push(await run('257 colours', build((x, y) => {
          const p = y * W + x
          const n = p < 257 ? p : 0
          return [n & 255, (n >> 8) & 255 ? 1 : 2, (n * 3) & 255, 255]
        }), 'DeviceRGB'))

        // Grey with holes: the colour plane narrows, the mask still carries alpha.
        out.push(await run('grey with holes', build((x, y) => {
          const v = (x * 4) & 255
          return [v, v, v, (x > 20 && x < 40 && y > 20 && y < 40) ? 0 : 255]
        }), 'DeviceGray'))

        return out
      })

      for (const c of cases) {
        check(`${c.label}: encoded as ${c.expect}`, c.got === c.expect,
          `got ${c.got}${c.hival != null ? ` (hival ${c.hival})` : ''}, ${c.bytes} bytes`)
        check(`${c.label}: the stream decodes back to the exact pixels`, c.bad < 0,
          c.bad === -2 ? 'plane is the wrong length' : `first wrong pixel at index ${c.bad}`)
      }
      const holes = cases.find(c => c.label === 'grey with holes')
      check('a narrowed colour plane still carries its soft mask', holes.hasMask && holes.maskBad < 0,
        holes.hasMask ? `first wrong alpha at ${holes.maskBad}` : 'no /SMask was produced')
      const solid = cases.filter(c => c.label !== 'grey with holes')
      check('an opaque region gets no mask it does not need', solid.every(c => !c.hasMask))
    },
  },

  {
    name: 'prose',
    async run() {
      const probe = await page.evaluate(PROBES)
      const words = await page.evaluate(() => window.__words)
      const { r: fit } = await standard('prose')
      const { r: a4 } = await standard('prose-a4', { page: 'a4', margin: 24 })

      check('fit is one page', fit.numPages === 1, `got ${fit.numPages}`)
      check('a4 paginates', a4.numPages >= 2, `got ${a4.numPages}`)

      const pageW = a4.pages[0].width
      const pageH = a4.pages[0].height
      const availHeight = pageH - 48
      const k = PT * ((pageW - 48) / (probe.target.width * PT))
      const para = probe.items.prose

      // The guard that makes this fixture mean anything: the paragraph is not atomic
      // and is taller than a page, so the first cut CANNOT avoid landing inside it.
      check('the first page break is forced through the paragraph',
        para.top * k < availHeight && (para.top + para.height) * k > availHeight,
        `paragraph ${fmt(para.top * k)}…${fmt((para.top + para.height) * k)}pt vs a page of ${fmt(availHeight)}pt`)

      const one = strip(allText(fit))
      const many = strip(allText(a4))
      check('paginated text equals single-page text', one === many,
        one === many ? '' : `${many.length} chars vs ${one.length}`)

      // —— orientation ——
      // A landscape page is the same paper turned, so it is WIDER, SHORTER, and
      // fits less of a tall document per page — and it must still say every word
      // exactly once, which is the only thing that proves the turn did not lose a
      // slice.
      const { r: land } = await standard('prose-landscape',
        { page: 'a4', margin: 24, orientation: 'landscape' })
      near('landscape width is the portrait height', land.pages[0].width, pageH, 0.01, 'pt')
      near('landscape height is the portrait width', land.pages[0].height, pageW, 0.01, 'pt')
      check('a turned page holds less of a tall document, so it takes more pages',
        land.numPages > a4.numPages, `${land.numPages} landscape vs ${a4.numPages} portrait`)
      check('turning the page loses no words', strip(allText(land)) === one,
        `${strip(allText(land)).length} vs ${one.length} chars`)
      const turnedBad = words.filter(w => occurrences(strip(allText(land)), w) !== 1)
      check('and says each of them exactly once', turnedBad.length === 0,
        `${turnedBad.length} bad: ${turnedBad.slice(0, 6).join(' ')}`)

      // Orientation is a fact about the PAPER, and `page: 'fit'` has no paper —
      // the page is the element. Saying so beats turning nothing silently.
      await makePdf('prose-fit-turned', { orientation: 'landscape' })
      check("orientation on page:'fit' is reported rather than ignored",
        pageLog.some(l => /orientation[^\n]*page:'fit'|page:'fit'[^\n]*orientation/.test(l)),
        pageLog.filter(l => l.includes('orientation')).join(' | ') || 'nothing warned')
      fs.rmSync(path.join(OUT, 'prose-fit-turned.pdf'), { force: true })

      // Limitation 2: a word whose baseline straddles a slice must land on exactly
      // one page, never be dropped from both and never be drawn on both.
      const wrong = words.filter(w => occurrences(many, w) !== 1)
      check('every word of the cut paragraph survives exactly once', wrong.length === 0,
        `${wrong.length} bad: ${wrong.slice(0, 8).join(' ')}`)
    },
  },

  {
    name: 'table',
    async run() {
      const probe = await page.evaluate(PROBES)
      const box = probe.items
      const rows = await page.evaluate(() => window.__rows)
      const rowTops = await page.evaluate(() => window.__rowTops)
      const headH = await page.evaluate(() => window.__headHeight)
      const { r: fit } = await standard('table')
      // Uncompressed so the page image's own placement operator stays readable — it
      // is where the height index.js paginated over is legible. See below.
      const { real: a4pdf, r: a4 } = await standard('table-a4', { page: 'a4', margin: 24, compress: false })

      check('fit is one page', fit.numPages === 1, `got ${fit.numPages}`)
      check('a4 paginates', a4.numPages >= 2, `got ${a4.numPages}`)

      const pageW = a4.pages[0].width
      const pageH = a4.pages[0].height
      const availHeight = pageH - 48
      const k = PT * ((pageW - 48) / (probe.target.width * PT))

      const headCells = ['HEADROW', 'HEADALPHA', 'HEADBETA']
      // Nothing may be lost to a slice boundary: same characters, whatever the
      // layout — once the deliberate duplication is taken back out. The repeated
      // header is the ONE thing a paginated export is allowed to say twice, and
      // subtracting it is what keeps this a test of loss rather than of the
      // feature that put it there.
      const withoutHeads = (t) => headCells.reduce((s, c) => s.split(c).join(''), t)
      const one = strip(allText(fit))
      const many = strip(allText(a4))
      check('paginated text equals single-page text, bar the repeated header',
        withoutHeads(one) === withoutHeads(many),
        withoutHeads(one) === withoutHeads(many) ? '' : `${many.length} chars vs ${one.length}`)

      const perPage = a4.pages.map(p => strip(pageText(p)))
      const lost = []
      for (let i = 0; i < rows; i++) {
        const n = String(i).padStart(2, '0')
        // R and S are the row's TWO baselines, so a cell dropped or drawn twice at a
        // slice edge is visible per row instead of as a shorter document.
        const cells = [`R${n}`, `S${n}`, `A${n}`, `B${n}`]
        if (cells.some(c => !perPage.some(t => t.includes(c)))) lost.push(`row ${n} missing`)
        else if (cells.some(c => occurrences(many, c) !== 1)) lost.push(`row ${n} duplicated`)
      }
      check('every row survives pagination exactly once', lost.length === 0, lost.join(', '))

      // Where EVERY cut landed, straight out of the collectBlocks → paginate pipeline
      // index.js runs, over this fixture's own DOM. A row that lands wholly on the
      // next page looks identical whether the cut was pulled up to its top or left
      // in its middle, so the rendered pages cannot answer this — the boundaries can.
      // Paginated output rasterizes the SVG by slice before decode, so a page uses
      // /IpN rather than one document-height /Im0. The placement remains an explicit
      // readable matrix; its height is now the bounded page crop by design.
      const cm = /\n([\d.]+) 0 0 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm\n\/Ip\d+ Do/.exec(a4pdf.raw)
      check('the page image is a readable pre-decode slice, not one giant raster', !!cm,
        cm ? '' : 'no `<w> 0 0 <h> <x> <y> cm` before /IpN Do')
      const contentHeight = cm
        ? Math.max(probe.target.height * k, Number(cm[2]) - (24 - Number(cm[3])))
        : probe.target.height * k
      const slices = await page.evaluate(([kk, av, ch]) => window.__slices(kk, av, ch), [k, availHeight, contentHeight])
      check('the replicated pagination has the pages the PDF has',
        slices.length === a4.numPages, `${slices.length} slices vs ${a4.numPages} pages`)
      const strayed = slices.slice(1)
        .map(s => ({ top: s.top, off: Math.min(...rowTops.map(t => Math.abs(t * k - s.top))) }))
        .filter(s => s.off > 0.01)
      check('every page break lands exactly on a row boundary',
        slices.length > 1 && strayed.length === 0,
        strayed.map(s => `${fmt(s.top)}pt is ${fmt(s.off)}pt off the nearest row`).join(', ') ||
          (slices.length > 1 ? '' : 'no break to check'))

      const head = headCells.map(c => perPage.findIndex(t => t.includes(c)))
      check('the header row is not cut', new Set(head).size === 1 && head[0] !== -1, head.join('/'))
      exactlyOnce(a4, 'PAGINATIONFIXTURE')

      // —— the repeated header ——
      // Pixels AND text: a header re-stamped as an image alone is a header no
      // search can find, and one written as text alone floats over the rows.
      check('the header is on every page the table reaches, as selectable text',
        perPage.every(t => headCells.every(c => t.includes(c))),
        perPage.map((t, i) => `p${i + 1}:${headCells.filter(c => t.includes(c)).length}/3`).join(' '))
      const copies = headCells.map(c => occurrences(many, c))
      check('the header is repeated once per page, never twice on one',
        copies.every(n => n === a4.numPages), `${copies.join('/')} for ${a4.numPages} pages`)

      // Where the break actually landed. Two rows either side of it pin the second
      // slice's top exactly, with the (unknown, identical) baseline offset cancelling.
      const label = (i) => `R${String(i).padStart(2, '0')}`
      const pageOf = (i) => perPage.findIndex(t => t.includes(label(i)))
      let first = -1
      for (let i = 1; i < rows && first < 0; i++) if (pageOf(i) === 1 && pageOf(i - 1) === 0) first = i
      const above = first > 0 ? itemStartingWith(a4, label(first - 1), 0) : null
      const below = first > 0 ? itemStartingWith(a4, label(first), 1) : null
      if (check('the rows either side of the first break are readable', !!above && !!below,
        `first row of page 2 is ${first < 0 ? 'undetermined' : label(first)}`)) {
        const offset = (pageH - 24 - above.y) - rowTops[first - 1] * k
        // Page 2's content starts one repeated header BELOW the top margin, so this
        // derivation recovers `slice.top − headerHeight`. Adding the header back is
        // therefore not a fudge: it is the assertion that the header cost the page
        // exactly its own height — a pixel more or less and the row boundary misses.
        const derived = rowTops[first] * k + offset - (pageH - 24 - below.y)
        const sliceTop = derived + headH * k
        near('page 2 begins exactly at the row boundary, one header lower',
          sliceTop, rowTops[first] * k, 1.5, 'pt')
        check('the break was pulled up off the blind cut', sliceTop < availHeight - 2,
          `${fmt(sliceTop)}pt vs a blind ${fmt(availHeight)}pt`)
      }

      // Multi-page annotations: index.js's slice test and its y mirror are the two
      // most sign-error-prone lines in the file, and only a4 exercises drawScale ≠ 1.
      const found = a4.pages.map(p => p.annots.filter(an => an.url === 'https://snapdom.dev/row'))
      check('the row link is annotated exactly once', found.reduce((n, l) => n + l.length, 0) === 1,
        found.map(l => l.length).join('/'))
      const at = found.findIndex(l => l.length === 1)
      check('the row link is on the last page', at === a4.numPages - 1, `page ${at + 1} of ${a4.numPages}`)
      if (at >= 0) {
        const [x1, y1, x2, y2] = found[at][0].rect
        const b = box.rowlink
        near('row link rect left', (x1 - 24) / k, b.left, 2, 'px')
        near('row link rect width', (x2 - x1) / k, b.width, 2, 'px')
        near('row link rect height', (y2 - y1) / k, b.height, 2, 'px')
        const anchor = itemStartingWith(a4, 'ROWLINK', at)
        check('the row link rect brackets its own baseline',
          !!anchor && anchor.y > y1 && anchor.y < y2,
          anchor ? `baseline ${fmt(anchor.y)} vs rect ${fmt(y1)}…${fmt(y2)}` : 'no ROWLINK run on that page')
      }

      // The escape hatch, pinned: with the header off, the file is the one this
      // suite asserted before repeating existed — same text, header on one page.
      const flat = await analyze(await makePdf('table-flat',
        { page: 'a4', margin: 24, repeatHeaders: false }), { hostId: 'h-table-flat' })
      const flatText = strip(allText(flat))
      check('repeatHeaders:false says every word exactly once again', flatText === one,
        flatText === one ? '' : `${flatText.length} chars vs ${one.length}`)
      const flatPages = flat.pages.map(p => strip(pageText(p)))
      check('repeatHeaders:false leaves the header on its own page',
        flatPages.filter(t => t.includes('HEADROW')).length === 1,
        `${flatPages.filter(t => t.includes('HEADROW')).length} pages carry it`)

      const title = itemFor(a4, 'PAGINATIONFIXTURE', 0)
      if (check('the title is its own run on page 1', !!title)) {
        near('a4: title origin x is scaled by drawScale', (title.x - 24) / k, box.title.left, 2, 'px')
        near('a4: title advance is scaled by drawScale', title.w / k, box.title.width,
          Math.max(2, box.title.width * 0.08), 'px')
      }
    },
  },

  {
    /**
     * The one fixture nobody wrote the pages for.
     *
     * Every other fixture in this file tests what somebody thought of. Looking back
     * at what actually FOUND the defects — 124 false affines over 30,000 random
     * transform chains, 33 character-order failures over 720 word × transform
     * combinations, 961 near-blank final pages over 40,000 pagination cases — every
     * one came out of a throwaway generator, and not one came out of a hand-written
     * page. This is that generator kept.
     *
     * fuzz.html builds a random DOM tree from a SEEDED PRNG: nested transforms,
     * mixed scripts and astral codepoints inside one word, columns too narrow to fit
     * a word, RTL, overflow clips and scroll offsets, form controls, open shadow
     * roots with slotted content, tables, `break-inside: avoid`, `text-transform` —
     * and, weighted above all of those, COMBINATIONS of them, because that is where
     * the regressions lived. The seeds are a fixed list. A generated page that
     * differs between runs is not a test: the failure it finds gets muted, and a
     * muted check protects nothing.
     *
     * What it asserts is only what holds for ANY page, which is what lets it catch
     * classes no probe enumerates:
     *
     *   pairing   one run per painted word fragment, in document order, and a wrapped
     *             word's fragments concatenate back to the word — the real regression
     *             was fragments carrying each other's characters
     *   tokens    every painted word is in the extracted text exactly once and
     *             nothing else is, over pdf.js — a token is unique by construction
     *   hidden    nothing the DOM does not paint reaches the file, named token by
     *             token, including a <select>'s unselected option and a password's
     *             value
     *   geometry  every origin on its own word's box, every baseline on the line
     *             Chromium laid out, every advance on its own measured width — what
     *             `align` does for one page, for every generated one
     *   paging    across a paginated export the words are the same words, once each
     *   bytes     pdfProblems() over every file — the same reader the rest uses
     *
     * The costs, so the trade is on the record: this reads the content stream and
     * pdf.js's text, and never a pixel — a `raster`-style ink scan of hundreds of
     * pages is minutes, and minutes is a suite nobody runs. Two more scoped
     * exclusions, both named in the code below: a control's origin (`forms` owns the
     * layout-metric path) and a Type0 run's advance (its natural width is not the
     * substitute's, and `unicode` owns that).
     */
    name: 'fuzz',
    run: fuzzRun,
  },
]

// ——— fuzz ————————————————————————————————————————————————————————
//
// Everything below belongs to the fixture above. It is out here rather than inside
// it because the seed list is the part that gets edited, and it should not be
// buried three levels into an array literal.

/**
 * The seeds. APPEND to extend — do not renumber, and do not remove one because it
 * went red: a seed that fails is the only reproduction of whatever it found, and
 * `FUZZ_SEEDS=8143 node test/verify.mjs fuzz` runs exactly that page.
 *
 * 36 seeds is where the marginal seed stopped finding new SHAPES rather than where
 * the clock ran out: over the last 12 added, the run count, the wrapped-fragment
 * count and the turned-run count all stayed inside the range the first 24 already
 * covered. It costs ~19s of the suite's ~2min. Depth beat breadth here — the seeds
 * that matter are the ones that stack three features on one element, which is what
 * `wrapped()` in the fixture exists to produce, and 200 shallow seeds would have
 * cost ten times as much for less.
 */
const SEEDS = process.env.FUZZ_SEEDS
  ? process.env.FUZZ_SEEDS.split(',').map(Number)
  : [
    1, 2, 3, 7, 11, 19, 23, 42, 57, 64, 91, 108,
    137, 199, 256, 314, 401, 512, 613, 719, 828, 911, 1024, 1117,
    1229, 1337, 1481, 1597, 1732, 1861, 1999, 2048, 2207, 2311, 2477, 2600,
  ]

/**
 * Seeds that are also exported to A4. Pagination doubles a seed's cost and needs a
 * page tall enough to cut, so it is a subset with `minHeight` forced rather than
 * every seed at its natural height.
 */
const PAGED = new Set([3, 23, 91, 199, 512, 911, 1337, 1999])

/** Tokens are the identity of a word. `text-transform: lowercase` is why /i. */
const TOKEN = /[whl]\d{4}/gi
const tokensOf = (s) => (s.match(TOKEN) || []).map(t => t.toUpperCase()).sort()

/**
 * The bytes, and nothing written to disk. `makePdf` is the right thing for a fixture
 * that produces one file worth looking at; this one produces ~44 and keeps only the
 * ones that fail.
 */
async function fuzzCapture(options, artifactName = 'fuzz') {
  const b64 = await page.evaluate(async ({ opts, artifactName }) => {
    const blob = await window.toPdf(document.getElementById('target'), opts)
    const artifacts = window.__pdfArtifacts || (window.__pdfArtifacts = Object.create(null))
    artifacts[artifactName] = window.__lastPdfArtifact
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return btoa(bin)
  }, { opts: options, artifactName })
  const bytes = Buffer.from(b64, 'base64')
  return { b64, bytes, raw: bytes.toString('latin1') }
}

/**
 * pdf.js, text and link annotations only — no canvas. The analyzer in harness.mjs
 * renders every page, which is what makes `out/*.png` and what makes 44 exports
 * unaffordable. Nothing here asserts a pixel.
 */
const FUZZ_TEXT = async (b64) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise
  const numPages = doc.numPages
  const pages = []
  for (let p = 1; p <= numPages; p++) {
    const pdfPage = await doc.getPage(p)
    const content = await pdfPage.getTextContent()
    pages.push({
      text: content.items.map(i => (typeof i.str === 'string' ? i.str : '')).join(' '),
      annots: (await pdfPage.getAnnotations())
        .filter(an => an.subtype === 'Link').map(an => an.url || an.unsafeUrl || null),
    })
  }
  // Every getDocument spawns a worker; 44 of them outlive the run otherwise.
  await doc.destroy()
  return { numPages, pages }
}

/**
 * Where a run's baseline origin has to be, and how wide it has to be, given ONE of
 * its word's client rects. Derived, not copied: the AABB centre is the image of the
 * local centre under any affine map, so the origin is one displacement along the
 * map from a point both sides can see, and the unknown translation cancels.
 *
 * Three cases, because the honest expectation differs:
 *   flat/axis  a diagonal map takes the local origin to a KNOWN corner of the AABB
 *              — left for a>0, right for a<0 — and the advance is the AABB's own
 *              width divided by |a|.
 *   turned     the AABB gives two equations, W = |a|w + |c|h and H = |b|w + |d|h,
 *              which solve for the run's own w and h whenever |a||d| ≠ |b||c|. That
 *              is singular at exactly 45°, which is the singularity text-layer.js
 *              sidesteps by MEASURING the advance instead of solving for it, and
 *              which the generator's `usable()` keeps its chains away from.
 *
 * @returns {{kind: string, x: number, y: number, w: number}|null} in CSS px from
 *   #target's border box; null when the map is too ill-conditioned to project.
 */
function fuzzPredict(run, box, ascent) {
  // The written matrix is the CSS linear part conjugated by the y flip.
  const L = { a: run.a, b: -run.b, c: -run.c, d: run.d }
  if (L.b === 0 && L.c === 0) {
    return {
      kind: L.a === 1 && L.d === 1 ? 'flat' : 'axis',
      x: L.a > 0 ? box.left : box.left + box.width,
      y: (L.d > 0 ? box.top : box.top + box.height) + L.d * ascent,
      w: box.width / Math.abs(L.a),
    }
  }
  const det = Math.abs(L.a * L.d) - Math.abs(L.c * L.b)
  if (!(det > 0.05)) return null
  const w = (box.width * Math.abs(L.d) - box.height * Math.abs(L.c)) / det
  const h = (box.height * Math.abs(L.a) - box.width * Math.abs(L.b)) / det
  const dx = -w / 2
  const dy = ascent - h / 2
  return {
    kind: 'turned',
    x: box.left + box.width / 2 + L.a * dx + L.c * dy,
    y: box.top + box.height / 2 + L.b * dx + L.d * dy,
    w,
  }
}

/**
 * The tolerances, in one place because two things read them: the check at the end,
 * and the artifact writer — a seed that puts a number over its tolerance has to keep
 * its PDF and its HTML, exactly like one that fails a structural invariant.
 *
 * Every one is a MEASURED worst case with a margin, over the seed list as it stands:
 * origin 0.0005pt, baseline 0.0012px, advance 0.04%, turned origin 0.012px, size
 * 0.0000pt. They are pinned 20–100× above that and still an order of magnitude under
 * what the planted defects moved (a 1pt origin shift lands 1.33px out, a Tz divisor
 * off by the flip factor moves an advance by 33%).
 */
const FUZZ_TOL = { size: 0.005, originX: 0.05, baseline: 0.05, advance: 0.005, turned: 0.6, advanceTurned: 0.03 }

async function fuzzRun() {
  /** Numeric invariants: worst case over every seed, and where it happened. */
  const worst = {}
  let overTolerance = false
  const worse = (key, d, where) => {
    const w = worst[key] || (worst[key] = { d: -1, where: 'nothing measured' })
    if (d > w.d) { w.d = d; w.where = where }
    if (d > FUZZ_TOL[key]) overTolerance = true
  }
  /** Structural invariants: every violation, with its seed. */
  const fails = {}
  const fail = (key, detail) => (fails[key] || (fails[key] = [])).push(detail)

  const stats = { runs: 0, wrapped: 0, turned: 0, scaled: 0, type0: 0, controls: 0, hidden: 0, pages: 0 }
  const keep = new Set()

  for (const seed of SEEDS) {
    const paged = PAGED.has(seed)
    const at = (msg) => `seed ${seed}: ${msg}`
    const from = pageLog.length

    const built = await page.evaluate(([s, h]) => window.__build(s, h), [seed, paged ? 2400 : 0])
    stats.hidden += built.hidden.length

    const artifactName = `fuzz-seed-${seed}`
    // fields:false — the fuzz asserts one text run per painted word, and a field
    // value's words deliberately leave the text layer for the field's /V.
    const pdf = await fuzzCapture({ compress: false, fields: false }, artifactName)
    const dom = await canonicalArtifactWords(artifactName)
    const before = Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, v.length]))
    overTolerance = false
    const bad = () => overTolerance || Object.entries(fails).some(([k, v]) => v.length !== (before[k] || 0))

    const problems = pdfProblems(pdf.raw)
    if (problems.length) fail('bytes', at(problems.slice(0, 2).join('; ')))
    const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.raw)
    if (!mb) fail('bytes', at('no readable /MediaBox'))
    const pageH = mb ? Number(mb[2]) : 0

    const runs = streamRuns(pdf.raw)
    const res = fontResources(pdf.raw)
    const expected = dom.words.reduce((n, w) => n + w.rects.length, 0)
    stats.runs += runs.length
    stats.controls += dom.words.filter(w => w.control).length
    stats.wrapped += dom.words.filter(w => w.rects.length > 1).length

    // Pair by POSITION, not by search: index.js writes its runs in the order
    // text-layer walks the flattened tree, and __words walks the same tree the same
    // way. A run dropped, duplicated or emitted with the wrong text is then a
    // divergence at a known index rather than a word a matcher quietly skipped.
    const pairs = []
    if (runs.length !== expected) {
      fail('pairing', at(`${runs.length} runs vs ${expected} painted word fragments`))
    } else {
      let cursor = 0
      for (const word of dom.words) {
        const rs = runs.slice(cursor, cursor + word.rects.length)
        cursor += word.rects.length
        // A hex string is a glyph id in the Type0 font and no byte comparison can
        // read it back; those runs are checked through pdf.js instead, below.
        if (rs.every(r => r.text !== null)) {
          const joined = rs.map(r => r.text).join('')
          if (joined !== word.text) {
            fail('pairing', at(`${JSON.stringify(word.text)} came back as ${JSON.stringify(joined)}` +
              (rs.length > 1 ? ` in ${rs.length} fragments` : '')))
          }
        } else stats.type0 += rs.length
        if (!pageH) continue
        // All of a word's fragments share one element and therefore one matrix, so
        // the prediction depends only on the rect. Which fragment landed in which
        // rect is NOT assumed: bidi hands its rects back in visual order, so the
        // assignment is by nearest predicted origin, one rect per run.
        const preds = word.rects.map(b => fuzzPredict(rs[0], b, word.ascent))
        const taken = new Array(rs.length).fill(false)
        for (const run of rs) {
          const rx = run.x / PT
          const ry = (pageH - run.y) / PT
          let best = -1
          let bd = Infinity
          for (let j = 0; j < preds.length; j++) {
            if (taken[j] || !preds[j]) continue
            const d = Math.hypot(rx - preds[j].x, ry - preds[j].y)
            if (d < bd) { bd = d; best = j }
          }
          if (best < 0) { fail('projection', at(`${JSON.stringify(word.text)} has no projectable rect`)); continue }
          taken[best] = true
          pairs.push({ run, pred: preds[best], word, rx, ry })
        }
      }
    }

    // The substitute's own advance, measured in the page against the face the FILE
    // names — which is what makes this catch a run measured in one base-14 font and
    // written in another, and a Tz that hit its clamp.
    const jobs = pairs.map(p => [canvasFont(res.get(p.run.font) || 'Helvetica', p.run.size), p.run.text || ' '])
    const natural = jobs.length ? await page.evaluate((js) => window.__natural(js), jobs) : []

    for (let i = 0; i < pairs.length; i++) {
      const { run, pred, word, rx, ry } = pairs[i]
      const what = `${JSON.stringify(run.text ?? '<type0>')} on seed ${seed}` +
        (word.track ? ` (letter-spacing ${word.track})` : '')
      worse('size', Math.abs(run.size - word.size * PT), `${what} (${fmt(run.size)}pt for ${fmt(word.size)}px)`)
      // A control's value has no client rect at all: text-layer places it from
      // layout metrics inside a box the browser insets by amounts no metric reports
      // (a themed <select> by 4px and 16px, MEASURED in `forms`, which owns that
      // geometry). The box read here is the control's border box, so neither its
      // origin nor its advance is comparable. Its size and its text are, above.
      if (word.control) continue
      if (pred.kind === 'turned') {
        stats.turned++
        worse('turned', Math.hypot(rx - pred.x, ry - pred.y), what)
      } else {
        if (pred.kind === 'axis') stats.scaled++
        worse('originX', Math.abs(run.x - pred.x * PT), what)
        worse('baseline', Math.abs(ry - pred.y), what)
      }
      // Tz corrects the substitute's advance to the browser's, so multiplying it
      // back must give the width the DOM reported. Not for a Type0 run: index.js
      // does not use naturalWidth there at all.
      if (run.text !== null && natural[i] > 0) {
        worse(pred.kind === 'turned' ? 'advanceTurned' : 'advance',
          Math.abs((run.tz / 100) * natural[i] / (pred.w * PT) - 1),
          `${what} — ${fmt((run.tz / 100) * natural[i])}pt painted vs ${fmt(pred.w * PT)}pt measured`)
      }
    }

    const texts = await page.evaluate(FUZZ_TEXT, pdf.b64)
    stats.pages += texts.numPages
    const corpus = strip(texts.pages.map(p => p.text).join(' '))
    const got = tokensOf(corpus)
    const want = tokensOf(dom.words.map(w => w.text).join(' '))
    const leaked = got.filter(t => t.startsWith('H'))
    if (leaked.length) fail('hidden', at(`${[...new Set(leaked)].join(' ')} is in the file`))
    if (String(got) !== String(want)) {
      const missing = want.filter(t => !got.includes(t))
      const extra = got.filter(t => !want.includes(t))
      // Uppercased, like the tokens themselves: `text-transform: lowercase` paints
      // w0039, and counting W0039 in the corpus as written finds nothing at all.
      const twice = want.filter(t => occurrences(corpus.toUpperCase(), t) !== 1)
      fail('tokens', at(`${missing.length} missing (${missing.slice(0, 4)}), ` +
        `${extra.length} unexpected (${extra.slice(0, 4)}), ${twice.length} not once (${twice.slice(0, 4)})`))
    }

    // URI annotations only, on both sides: an in-document fragment is a /Dest and
    // has no url at all, so counting one against the other would report a working
    // internal link as a missing external one.
    const hrefs = await page.evaluate(() => {
      const here = location.href.split('#')[0]
      return [...new Set([...document.querySelectorAll('#target a')].map(a => a.href)
        .filter(h => !h.startsWith(here + '#')))].sort()
    })
    const annotated = [...new Set(texts.pages.flatMap(p => p.annots).filter(Boolean))].sort()
    if (String(hrefs) !== String(annotated)) {
      fail('links', at(`${annotated.length} annotated vs ${hrefs.length} anchors`))
    }

    // Both of these are index.js counting a run it wrote and then lost: off the
    // MediaBox, or past the Type0 font's 65,534 codepoints. Either one would eat an
    // invariant above from underneath, so they are asserted rather than tolerated.
    const said = pageLog.slice(from)
    for (const line of said) {
      if (/land outside the page box/.test(line)) fail('offpage', at(line.slice(0, 120)))
      if (/left out of the text layer/.test(line)) fail('offpage', at(line.slice(0, 120)))
    }

    if (paged) {
      const a4 = await fuzzCapture({ page: 'a4', margin: 24, compress: false, fields: false })
      const a4t = await page.evaluate(FUZZ_TEXT, a4.b64)
      const a4Runs = streamRuns(a4.raw)
      if (a4t.numPages < 2) fail('paged', at(`a4 came back as ${a4t.numPages} page(s) — nothing was cut`))
      if (pdfProblems(a4.raw).length) fail('bytes', at(`a4: ${pdfProblems(a4.raw).slice(0, 2).join('; ')}`))
      // Multisets, not the concatenated string: a run's PAGE is decided by its
      // baseline, so a block the layout displaced upwards can legitimately reach an
      // earlier page than the one before it in document order, and the string
      // comparison prose/table can afford on linear copy would read that as a
      // difference. What may not change is WHICH words are in the file, and how
      // many times each one is.
      const a4Tokens = tokensOf(strip(a4t.pages.map(p => p.text).join(' ')))
      if (String(a4Tokens) !== String(got)) {
        const lost = got.filter(t => !a4Tokens.includes(t))
        const dupe = a4Tokens.filter((t, i) => a4Tokens.indexOf(t) !== i)
        fail('paged', at(`over ${a4t.numPages} pages: ${lost.length} lost (${lost.slice(0, 4)}), ` +
          `${dupe.length} duplicated (${dupe.slice(0, 4)})`))
      }
      if (a4Runs.length !== runs.length) {
        fail('paged', at(`${a4Runs.length} runs over ${a4t.numPages} pages vs ${runs.length} on one`))
      }
    }

    if (bad()) keep.add(seed)
    if (keep.has(seed)) {
      // The whole reproduction: the exact page, and the file it produced.
      fs.writeFileSync(path.join(OUT, `fuzz-${seed}.pdf`), pdf.bytes)
      fs.writeFileSync(path.join(OUT, `fuzz-${seed}.html`), await page.evaluate(() => window.__html()))
      console.log(`  ↳ seed ${seed} kept: ${built.recipe.join(' | ')}`)
    }
  }

  const structural = (key, name) => {
    const list = fails[key] || []
    check(name, list.length === 0, list.slice(0, 3).join(' ; ') + (list.length > 3 ? ` (+${list.length - 3})` : ''))
  }
  const numeric = (key, name, unit) => {
    const w = worst[key] || { d: -1, where: 'nothing measured' }
    check(name, w.d >= 0 && w.d <= FUZZ_TOL[key],
      `worst ${w.d.toFixed(4)}${unit} on ${w.where} (tolerance ${FUZZ_TOL[key]}${unit})`)
  }

  check(`${SEEDS.length} seeds built ${stats.runs} runs, ${stats.wrapped} of them wrapped words`,
    stats.runs > 2000 && stats.wrapped > 40 && stats.turned > 40 && stats.type0 > 40 &&
    stats.controls > 20 && stats.hidden > 60,
    `${stats.runs} runs, ${stats.wrapped} wrapped, ${stats.turned} turned, ${stats.scaled} scaled, ` +
    `${stats.type0} type0, ${stats.controls} controls, ${stats.hidden} hidden tokens, ${stats.pages} pages`)

  structural('bytes', 'every generated file\'s xref, /Size and /Length describe its bytes')
  structural('pairing', 'one run per painted word fragment, in document order, fragments concatenating back')
  structural('projection', 'every run\'s own map is invertible enough to project through')
  structural('tokens', 'every painted word is in the extracted text exactly once, and nothing else is')
  structural('hidden', 'nothing the DOM does not paint reaches the file')
  structural('links', 'every anchor is annotated, and nothing else is')
  structural('offpage', 'no run was written off the page box or dropped for want of a glyph')
  structural('paged', `across ${PAGED.size} paginated exports the words are the same words, once each`)

  numeric('size', 'every run\'s font size is its element\'s, in points', 'pt')
  numeric('originX', 'every untransformed origin sits on its own word\'s box', 'pt')
  numeric('baseline', 'every untransformed baseline lands on the line Chromium laid out', 'px')
  numeric('advance', 'every axis-aligned advance matches its own word box', '')
  numeric('turned', 'every turned origin is its DOM box projected through its own matrix', 'px')
  numeric('advanceTurned', 'every turned advance matches its own word box', '')
}

// ——— run ——————————————————————————————————————————————————————

const selected = FIXTURES.filter(f => !args.length || args.some(a => f.name.startsWith(a)))
if (!selected.length) {
  console.error(`no fixture matches ${args.join(', ')} — known: ${FIXTURES.map(f => f.name).join(', ')}`)
  await browser.close()
  server.close()
  process.exit(2)
}

for (const fx of selected) {
  setFixture(fx.name)
  pageLog.length = 0
  pageErrors.length = 0
  console.log(`\n── ${fx.name} ${'─'.repeat(Math.max(0, 56 - fx.name.length))}`)
  try {
    if (fx.dom !== false) await openFixture(page, `${base}/test/fixtures/${fx.name}.html`)
    await fx.run()
  } catch (e) {
    check('fixture completed', false, e.message)
  }
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  const noisy = pageLog.filter(l => l.startsWith('error:'))
  check('no console errors', noisy.length === 0, noisy.join(' | ').slice(0, 300))
}

await browser.close()
server.close()

report(results, { scope: `${selected.length} fixture(s)` })
console.log(`\nartifacts in ${OUT}`)
