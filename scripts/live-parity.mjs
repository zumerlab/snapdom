// Live parity: every demo's capture against the page it was captured from.
//
// The visual suite compares a capture with the capture recorded the day its baseline was
// taken, so it catches CHANGE and nothing else: an output that was wrong when recorded passes
// forever (d24 held a 404'd font's fallback, d13 a July frame, d10 a white strip the page
// never shows). This compares each demo's snapdom capture with Playwright's screenshot of the
// live page, in the same engine, which is the only measure of fidelity there is.
//
// Same conditions as the visual suite: 1280x1024 viewport, DPR 1, `#target` or else the body,
// the suite's settle (stylesheets and fonts landed, geometry still for three frames, every
// animation paused on its first frame, images decoded) and the per-demo waits in DEMOS below.
// Unlike the suite it captures at scale 1, so the capture and the screenshot share a pixel
// grid. The capture is aligned on `meta.contentX/contentY` (bleed sits outside the element
// box) and composited on the colour behind the element, not on the screenshot, so a glyph the
// capture lost cannot hide behind the page's.
//
// Usage: npm run compile && node scripts/live-parity.mjs [demo-name-substring ...]
//   BROWSER=chromium|firefox|webkit|all (default all). Writes output/live-parity/report.md,
//   report.json and, for every demo over the report threshold, <engine>/<demo>.{live,capture,diff}.png.
//   SNAPDOM_ENGINE=html-in-canvas captures with that engine (BROWSER=chromium, through the
//   installed Chrome: the bundled Chromium predates the API, Chrome 157) and notes every demo
//   that fell back to svg, so a row measures the native paint or says it did not run.
//   CHROME_PATH=<binary> launches that Chrome instead (a Chrome for Testing, Beta or Canary
//   build), to check a release before the installed Chrome reaches it.
import { createServer } from 'node:http'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as playwright from 'playwright'
import { skippedVisualDemos } from './visual-policy.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'output/live-parity')

// A pixel differs when its channels differ by more than this in total, from every pixel of
// the 3x3 around it in the capture: font hinting between the page and the svg image moves
// edge pixels by a few levels and up to a pixel, a real defect by far more.
const PIXEL_DELTA = 48
// Demos above this share of differing pixels get their images written for review.
const REPORT_RATIO = 0.005

// Per-demo conditions, ported from __tests__/visual.demos.shared.js (`overrides`). `options`
// replaces the default capture options; `setup` runs in the page after settle.
const DEMOS = {
  'd-element-mirror-import': {
    options: { captureSelection: true, outerShadows: 'subtree' },
    setup: () => { try { window.__selectDemo?.() } catch { /* best-effort */ } },
  },
  'd-root-transform': { options: { outerTransforms: false } },
  'd-outer-shadows': { options: { outerShadows: true } },
  'd-compress-codecs': { options: { compress: true }, setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd-compress': { setup: async () => { await Promise.allSettled([...document.querySelectorAll('#target img')].map((im) => im.decode?.())) } },
  'd10-multi-background-text': { setup: () => until(() => document.querySelector('body > img')) },
  // Appends its own toSvg capture to the body on load: wait until that image has painted.
  'd60-saltosdelinea': { setup: async () => { await until(() => document.querySelector('body > img')); await document.querySelector('body > img')?.decode?.().catch(() => {}) } },
  'd12-backgrounds-test': {
    setup: () => until(() => document.querySelector('#output')?.children.length >= document.querySelectorAll('.test-node').length),
  },
  'd13-svg-pdf-mathjax': {
    setup: async () => {
      await until(() => window.MathJax?.Hub)
      await Promise.race([new Promise((r) => { try { window.MathJax.Hub.Queue(r) } catch { r() } }), new Promise((r) => setTimeout(r, 8000))])
    },
  },
  'd454-katex-hide-tail': { setup: () => new Promise((r) => setTimeout(r, 2500)) },
  'd474-katex-formulas': { setup: () => new Promise((r) => setTimeout(r, 2500)) },
  'd-crop-pages': { setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd489-reconcile-transform': { options: { reconcile: true }, setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd522-fixed-svg-clip': { target: 'body', options: { clip: 'viewport' }, setup: () => { window.scrollTo(0, 900) } },
  'd523-reconcile-custom-element': { options: { reconcile: true } },
  // The suite serves this demo's image from its cross-origin test server; without it the
  // image is the same-origin copy, which still paints.
  'd15-cors-fonts-test': {},
}

// Why a demo cannot be held to the page, when it cannot. Reported, never hidden.
const LIMITS = {
  'd522-fixed-svg-clip': 'clip: viewport captures the viewport, the reference crops the body box',
  'd-root-transform': 'outerTransforms: false drops the root transform on purpose',
  'd444-audio': 'native controls without author styles do not paint in a foreignObject (#427)',
  'd14-cors-test': 'a cross-origin image without CORS is a placeholder by design',
  'd32-iframe-same-origin': 'a cross-origin iframe is a placeholder by design',
  'd486-canvas-animation': 'its canvases redraw every frame, between the screenshot and the capture',
  'd498-layout-misalignment': 'headless Chromium paints no classic scrollbar in the reference',
  'd45-scrollbar-styles': 'headless Chromium paints no classic scrollbar in the reference',
  'd508-snapped-borders': 'a fractional zoom on an ancestor: compared after rescaling, off by sub-pixels',
  'd11-toblob-test': 'a fixed element outside #target paints over its box in the reference',
  'd42-nested-line-clamp': "a native button; Chromium's svg images ignore per-language default fonts",
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
      const body = await readFile(join(ROOT, path))
      res.writeHead(200, { 'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch { res.writeHead(404); res.end() }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// Runs in the page: the suite's settle(), condensed. Every wait shares one deadline.
async function settleInPage(budget) {
  const deadline = Date.now() + budget
  const left = () => Math.max(0, deadline - Date.now())
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const sheetsPending = () => {
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const rule of rules) if (rule.type === 3 && !rule.styleSheet) return true
    }
    return false
  }
  const facesPending = () => [...document.fonts].some((f) => f.status === 'loading')
  while (Date.now() < deadline && (sheetsPending() || facesPending())) await sleep(Math.min(50, left()))
  try { await Promise.race([document.fonts.ready, sleep(left())]) } catch { /* best-effort */ }
  let last = '', stable = 0
  while (Date.now() < deadline && stable < 3) {
    await new Promise((r) => requestAnimationFrame(r))
    const el = document.documentElement
    const sig = el.scrollWidth + 'x' + el.scrollHeight + 'x' + document.images.length
    if (sig === last) stable++
    else { stable = 0; last = sig }
  }
  try { for (const a of document.getAnimations()) { a.currentTime = 0; a.pause() } } catch { /* best-effort */ }
  try { await Promise.race([Promise.allSettled([...document.images].map((im) => im.decode?.())), sleep(left())]) } catch { /* best-effort */ }
}

const until = `async function until(pred, budget = 8000) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) { try { if (pred()) return true } catch {} await new Promise((r) => requestAnimationFrame(r)) }
  return false
}`

// Runs in the page: capture the target and describe what the reference needs.
async function captureInPage({ target, options }) {
  const el = target === 'body' ? document.body : (document.querySelector('#target') || document.body)
  // The colour behind the element: the first opaque background up the tree, else the canvas.
  const opaque = (c) => c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c)
  let backdrop = 'rgb(255, 255, 255)'
  const start = el === document.body ? document.documentElement : el.parentElement
  for (let n = start; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor
    if (opaque(c)) { backdrop = c; break }
  }
  if (el === document.body || start === document.documentElement || start === document.body) {
    const html = getComputedStyle(document.documentElement).backgroundColor
    const body = getComputedStyle(document.body).backgroundColor
    backdrop = opaque(html) ? html : opaque(body) ? body : backdrop
  }
  const r = el.getBoundingClientRect()
  const rect = { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
  // A zoomed ancestor outside the capture (d508) shows the element larger than its own CSS
  // pixels, which is the space snapdom captures in (#483): capture at that zoom so the two
  // pictures share one pixel grid.
  const rotated = getComputedStyle(el).transform !== 'none'
  const zoom = !rotated && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1
  if (Math.abs(zoom - 1) > 0.01) options = { ...options, scale: zoom }
  const res = await window.snapdom(el, options)
  const canvas = await res.toCanvas()
  // A native html-in-canvas capture has a PNG url; an svg one says the engine bailed.
  const svg = options.engine ? res.url.startsWith('data:image/svg') : false
  return { url: canvas.toDataURL(), meta: res.meta, rect, backdrop, isBody: el === document.body, rotated, zoom, svg }
}

function parseRgb(c) { return (c.match(/[\d.]+/g) || ['255', '255', '255']).slice(0, 3).map(Number) }

function compare(live, cap, ox, oy, backdrop, crop, stride = 1) {
  const [br, bg, bb] = parseRgb(backdrop)
  const w = Math.min(crop.width, live.width - crop.x, cap.width - ox)
  const h = Math.min(crop.height, live.height - crop.y, cap.height - oy)
  const diff = stride === 1 ? new PNG({ width: Math.max(1, w), height: Math.max(1, h) }) : null
  let bad = 0, seen = 0
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      seen++
      const i = ((y + crop.y) * live.width + x + crop.x) * 4
      // A pixel differs only when no pixel of the 3x3 around it in the capture matches it:
      // WebKit places text after an inline box up to half a pixel off and draws a dashed
      // border's dashes in another phase, which marked whole paragraphs and every box edge
      // without anything a reader could see. A missing, extra or shifted box still differs.
      let d = Infinity
      for (let ny = -1; ny <= 1 && d > PIXEL_DELTA; ny++) {
        for (let nx = -1; nx <= 1 && d > PIXEL_DELTA; nx++) {
          const yy = y + oy + ny, xx = x + ox + nx
          if (yy < 0 || xx < 0 || yy >= cap.height || xx >= cap.width) continue
          const jj = (yy * cap.width + xx) * 4
          const a = cap.data[jj + 3] / 255
          d = Math.min(d, Math.abs(live.data[i] - (cap.data[jj] * a + br * (1 - a))) +
            Math.abs(live.data[i + 1] - (cap.data[jj + 1] * a + bg * (1 - a))) +
            Math.abs(live.data[i + 2] - (cap.data[jj + 2] * a + bb * (1 - a))))
        }
      }
      if (d > PIXEL_DELTA) bad++
      if (!diff) continue
      const k = (y * w + x) * 4
      if (d > PIXEL_DELTA) { diff.data[k] = 255; diff.data[k + 1] = 0; diff.data[k + 2] = 0 } else {
        for (let n = 0; n < 3; n++) diff.data[k + n] = live.data[i + n] / 3 + 170
      }
      diff.data[k + 3] = 255
    }
  }
  return { ratio: seen ? bad / seen : 1, w, h, diff }
}

/** The capture offset in [from, from + span] squared that best matches the reference, on a
 *  sparse grid. Ties keep the first, so with `from` one short of the meta origin the exact
 *  origin wins unless a neighbour is strictly better. */
function bestOffset(live, cap, backdrop, crop, span, from = [0, 0]) {
  let best = null, score = Infinity
  const order = []
  for (let oy = from[1]; oy <= from[1] + span; oy++) for (let ox = from[0]; ox <= from[0] + span; ox++) order.push([ox, oy])
  // The centre first, so a tie stays on it.
  const centre = [from[0] + (span >> 1), from[1] + (span >> 1)]
  order.sort((a, b) => (Math.abs(a[0] - centre[0]) + Math.abs(a[1] - centre[1])) - (Math.abs(b[0] - centre[0]) + Math.abs(b[1] - centre[1])))
  for (const [ox, oy] of order) {
    if (ox < 0 || oy < 0) continue
    const { ratio } = compare(live, cap, ox, oy, backdrop, crop, 2)
    if (ratio < score) { score = ratio; best = [ox, oy] }
  }
  return best || [Math.max(0, from[0]), Math.max(0, from[1])]
}

function cropPng(src, x, y, w, h, backdrop) {
  const [br, bg, bb] = backdrop ? parseRgb(backdrop) : [0, 0, 0]
  const out = new PNG({ width: Math.max(1, w), height: Math.max(1, h) })
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = ((yy + y) * src.width + xx + x) * 4, k = (yy * w + xx) * 4
      if (yy + y >= src.height || xx + x >= src.width) { out.data[k + 3] = 0; continue }
      const a = backdrop ? src.data[i + 3] / 255 : 1
      out.data[k] = src.data[i] * a + br * (1 - a)
      out.data[k + 1] = src.data[i + 1] * a + bg * (1 - a)
      out.data[k + 2] = src.data[i + 2] * a + bb * (1 - a)
      out.data[k + 3] = 255
    }
  }
  return out
}

const SNAPDOM_ENGINE = process.env.SNAPDOM_ENGINE || null

async function runEngine(name, demos, base) {
  const browser = await playwright[name].launch(SNAPDOM_ENGINE && name === 'chromium' ? (process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) : {})
  const rows = []
  await mkdir(join(OUT, name), { recursive: true })
  for (const demo of demos) {
    const conf = DEMOS[demo] || {}
    const row = { demo, engine: name, limit: LIMITS[demo] || null }
    const page = await browser.newPage({ viewport: { width: 1280, height: 1024 }, deviceScaleFactor: 1 })
    // A capture that never settles must cost one demo, not the run.
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('demo timed out after 90 s')), 90_000) })
    try {
      await Promise.race([timeout, runDemo()])
    } catch (e) {
      row.error = String(e?.message || e).split('\n')[0].slice(0, 200)
    } finally {
      clearTimeout(timer)
      await page.close().catch(() => {})
    }
    rows.push(row)
    const pct = row.error ? 'ERROR ' + row.error : (100 * row.ratio).toFixed(2) + '%'
    console.log(`${name.padEnd(9)} ${demo.padEnd(34)} ${pct}`)
    continue

    async function runDemo() {
      await page.goto(`${base}/demos/${demo}.html`, { waitUntil: 'load', timeout: 30000 })
      await page.evaluate(settleInPage, 8000)
      if (conf.setup) {
        await page.evaluate(`(async () => { ${until}; await (${conf.setup.toString()})() })()`)
        await page.evaluate(settleInPage, 8000)
      }
      await page.addScriptTag({ path: join(ROOT, 'dist/snapdom.js') })
      // The reference first: nothing the capture does can then reach the screenshot.
      const shot = PNG.sync.read(await page.screenshot({ fullPage: true, animations: 'disabled' }))
      const options = { dpr: 1, scale: 1, embedFonts: true, ...(SNAPDOM_ENGINE && { engine: SNAPDOM_ENGINE }), ...conf.options }
      const r = await page.evaluate(captureInPage, { target: conf.target || null, options })
      if (r.svg) row.svgFallback = true
      const cap = PNG.sync.read(Buffer.from(r.url.split(',')[1], 'base64'))
      const crop = { x: Math.round(r.rect.x), y: Math.round(r.rect.y), width: Math.round(r.rect.width), height: Math.round(r.rect.height) }
      const z = r.zoom && Math.abs(r.zoom - 1) > 0.01 ? r.zoom : 1
      let ox = Math.max(0, Math.round((r.meta?.contentX || 0) * z)), oy = Math.max(0, Math.round((r.meta?.contentY || 0) * z))
      // A transformed root's meta origin is its untransformed box, the reference is the
      // transformed bounding box: align those by search. Every other root is held to the
      // meta origin exactly, so an offset bug cannot be aligned away.
      if (r.rotated) [ox, oy] = bestOffset(shot, cap, r.backdrop, crop, 16)
      else {
        // A fractional box rounds differently in the screenshot and in the capture: allow the
        // one pixel that can cost, and say when it was used.
        const [dx, dy] = bestOffset(shot, cap, r.backdrop, crop, 2, [ox - 1, oy - 1])
        if (dx !== ox || dy !== oy) row.nudged = [dx - ox, dy - oy]
        ox = dx; oy = dy
      }
      const { ratio, w, h, diff } = compare(shot, cap, ox, oy, r.backdrop, crop)
      row.offset = [ox, oy]
      Object.assign(row, {
        ratio, box: [crop.width, crop.height], compared: [w, h], capture: [cap.width, cap.height],
        rotated: r.rotated, network: /\bhttps?:\/\//.test(await readFile(join(ROOT, 'demos', demo + '.html'), 'utf8')),
      })
      if (ratio > REPORT_RATIO) {
        await writeFile(join(OUT, name, `${demo}.live.png`), PNG.sync.write(cropPng(shot, crop.x, crop.y, w, h)))
        await writeFile(join(OUT, name, `${demo}.capture.png`), PNG.sync.write(cropPng(cap, ox, oy, w, h, r.backdrop)))
        await writeFile(join(OUT, name, `${demo}.diff.png`), PNG.sync.write(diff))
      }
    }
  }
  await browser.close()
  return rows
}

const requested = (process.env.BROWSER || 'all').toLowerCase()
const engines = requested === 'all' ? ['chromium', 'firefox', 'webkit'] : [requested]
const filters = process.argv.slice(2)
const demos = (await readdir(join(ROOT, 'demos')))
  .filter((f) => /^d.*\.html$/.test(f)).map((f) => f.replace(/\.html$/, ''))
  .filter((d) => !skippedVisualDemos.has(d))
  .filter((d) => !filters.length || filters.some((f) => d.includes(f)))
  .sort()

// A filtered run adds to the last full one instead of wiping its images.
if (!filters.length) await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const rows = (await Promise.all(engines.map((e) => runEngine(e, demos, base)))).flat()
server.close()

// Report: one row per demo, one column per engine, worst first.
const byDemo = new Map()
for (const r of rows) {
  if (!byDemo.has(r.demo)) byDemo.set(r.demo, {})
  byDemo.get(r.demo)[r.engine] = r
}
const worst = (cells) => Math.max(...Object.values(cells).map((c) => (c.error ? 1 : c.ratio)))
const sorted = [...byDemo.entries()].sort((a, b) => worst(b[1]) - worst(a[1]))
const cell = (c) => !c ? '' : c.error ? `error: ${c.error}` : `${(100 * c.ratio).toFixed(2)}%`
const lines = [
  '# Live parity', '',
  `Capture against the live page, ${new Date().toISOString().slice(0, 10)}${SNAPDOM_ENGINE ? `, engine: ${SNAPDOM_ENGINE}` : ''}. A pixel differs past ${PIXEL_DELTA} in summed channels; images under each engine folder for every demo over ${(100 * REPORT_RATIO).toFixed(1)}%.`, '',
  `| demo | ${engines.join(' | ')} | notes |`, `|---|${engines.map(() => '---').join('|')}|---|`,
  ...sorted.map(([demo, cells]) => {
    const any = Object.values(cells)[0] || {}
    const nudged = Object.entries(cells).filter(([, c]) => c.nudged).map(([e, c]) => `${e} ${c.nudged}`)
    const fellBack = Object.entries(cells).filter(([, c]) => c.svgFallback).map(([e]) => e)
    const notes = [any.limit, any.network && 'network', any.rotated && `transformed root, aligned at ${any.offset}`, nudged.length && `1px nudge: ${nudged.join(', ')}`, fellBack.length && `svg fallback: ${fellBack.join(', ')}`].filter(Boolean).join('; ')
    return `| ${demo} | ${engines.map((e) => cell(cells[e])).join(' | ')} | ${notes} |`
  }),
]
const stem = filters.length ? 'report.partial' : 'report'
await writeFile(join(OUT, `${stem}.md`), lines.join('\n') + '\n')
await writeFile(join(OUT, `${stem}.json`), JSON.stringify(rows, null, 2))
const over = sorted.filter(([, cells]) => worst(cells) > REPORT_RATIO).length
console.log(`\n${sorted.length} demos, ${over} over ${(100 * REPORT_RATIO).toFixed(1)}% on some engine. Report: output/live-parity/${stem}.md`)
