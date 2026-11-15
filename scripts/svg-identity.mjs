/**
 * Byte identity of the capture between two source trees, for pure refactors.
 *
 * Builds tree A and tree B with their own `esbuild.config.mjs` (the bundle that ships), loads
 * every demo of THIS checkout's `demos/` once with each bundle, and compares the SVG text of
 * `snapdom(el)` (`result.url`, percent-decoded) byte for byte, per demo and engine. Each load
 * captures three times with the same options, and each capture is its own column: `first`;
 * `second`, right after it, which a burst memo can serve; `mutated`, after a nested text edit
 * (MUTATION), which is the only column that can reach the differential path of
 * src/core/diff.js. A refactor can break either recapture path alone. A pure refactor gives
 * identical bytes everywhere.
 *
 * What it owns, and what a change must keep:
 * - The demos, the server and the page are shared by A and B; only the injected bundle
 *   differs. Both builds load from the same origin, so a URL written into a capture cannot
 *   differ for that reason.
 * - Loads come from scripts/live-parity.mjs (1280x1024, DPR 1, `#target` or else the body, its
 *   settle) and the per-demo conditions from __tests__/visual.demos.shared.js (`overrides`),
 *   with the suite's options `{ dpr: 1, scale: 0.5, embedFonts: true }`. Keep DEMOS in step
 *   with those two files: a demo captured under other conditions proves nothing about them.
 * - A and B alternate per demo (A, B, next demo), each load in a fresh browser context, so
 *   time and network drift fall on both sides alike and no HTTP or snapdom cache crosses.
 * - Every normalisation is listed in NORMALISE with why it cannot hide a behaviour change,
 *   and the report counts how many differences each one absorbed. Demos known to differ
 *   between two runs of the SAME code are in UNSTABLE with their cause: they are still
 *   captured, compared and printed, in their own section, and do not set the exit code.
 *
 * Usage:
 *   node scripts/svg-identity.mjs --a main --b . [--engines chromium,firefox] [--filter d12,d5]
 *     [--out output/svg-identity]
 *   A tree is a directory (built in place, as `npm run compile` would) or a git ref of this
 *   repo (checked out with `git worktree add --detach` in a temp dir, node_modules linked in
 *   before the build, removed at the end). Run `--a . --b .` first: it measures determinism.
 *   Exit 0 when every stable demo is identical in every column, 1 on any difference, 2 when a
 *   load failed (nothing can be said about that demo).
 *
 * Reading a result. Each column is `same` or `DIFF@<offset>` (`n/a` for `mutated` when the
 * demo has nothing to edit), with `*` when the live page's
 * fingerprint (markup and element boxes) also differed between the two loads: a difference
 * without `*` on identical bundles is snapdom's own. The fingerprint does not see computed
 * paint values (a near-identity transform, a colour), so its absence does not clear the page.
 * Demos that load from a CDN can fail on a slow link (WebKit's `goto` waits for `load`):
 * that is an ERROR row and exit 2, never a pass. A full run on 2026-11-14: chromium 110 s,
 * firefox 132 s, webkit 145 s (270 s with four CDN timeouts), about 7 minutes in all.
 * The `mutated` column on chromium, 2026-11-15: 31 of 90 demos have nothing to edit (their
 * text sits in direct children of the root), and an attribute planted just before
 * diffCapture's serialization moved that column in 23 demos and no other column anywhere.
 */
import { createServer } from 'node:http'
import { readFile, readdir, mkdir, writeFile, rm, copyFile, mkdtemp, symlink, realpath } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as playwright from 'playwright'
import { skippedVisualDemos } from './visual-policy.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// The suite's capture options (visual.demos.shared.js, `snapdomOptions`).
const BASE_OPTIONS = { dpr: 1, scale: 0.5, embedFonts: true }

// Per-demo conditions from __tests__/visual.demos.shared.js. `options` replaces the base
// options; `setup` runs in the page after settle; `target: 'body'` skips `#target`.
const DEMOS = {
  'd-element-mirror-import': {
    options: { ...BASE_OPTIONS, scale: 1, captureSelection: true, outerShadows: 'subtree' },
    setup: () => { try { window.__selectDemo?.() } catch { /* best-effort */ } },
  },
  'd-root-transform': { options: { ...BASE_OPTIONS, outerTransforms: false } },
  'd-outer-shadows': { options: { ...BASE_OPTIONS, outerShadows: true } },
  'd-compress-codecs': { options: { ...BASE_OPTIONS, compress: true }, setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd-compress': { setup: async () => { await Promise.allSettled([...document.querySelectorAll('#target img')].map((im) => im.decode?.())) } },
  'd10-multi-background-text': { setup: () => until(() => document.querySelector('body > img')) },
  'd12-backgrounds-test': {
    setup: () => until(() => document.querySelector('#output')?.children.length >= document.querySelectorAll('.test-node').length),
  },
  'd13-svg-pdf-mathjax': {
    setup: async () => {
      await until(() => window.MathJax?.Hub)
      await Promise.race([new Promise((r) => { try { window.MathJax.Hub.Queue(r) } catch { r() } }), new Promise((r) => setTimeout(r, 8000))])
    },
  },
  'd25-font-import-multi-weight-2': {
    setup: async () => { await Promise.all([document.fonts.load('22px Roboto', 'Roboto 400 (usada)'), document.fonts.load('700 24px Roboto', 'Roboto 700 (usada)')]) },
  },
  'd454-katex-hide-tail': { setup: () => new Promise((r) => setTimeout(r, 2500)) },
  'd474-katex-formulas': { setup: () => new Promise((r) => setTimeout(r, 2500)) },
  'd-crop-pages': { setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd489-reconcile-transform': { options: { ...BASE_OPTIONS, reconcile: true }, setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  // Not in the suite. MathJax 4's speech explorer adds <mjx-speech> and semantic attributes
  // after the typeset, from a worker, so two loads captured either side of it. Wait for it.
  'd506-embedded-fonts': {
    setup: async () => {
      await until(() => window.MathJax?.startup?.promise)
      await window.MathJax.startup.promise
      await until(() => document.querySelector('mjx-speech'))
    },
  },
  'd522-fixed-svg-clip': { target: 'body', options: { ...BASE_OPTIONS, clip: 'viewport' }, setup: () => { window.scrollTo(0, 900) } },
  'd523-reconcile-custom-element': { options: { ...BASE_OPTIONS, reconcile: true } },
  'd548-clip-justify-self': { setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
  'd549-clip-long-page': { setup: async () => { try { await window.__ready } catch { /* best-effort */ } } },
}

// Rewrites applied to both texts before comparing. Each must be a bijection on what it
// touches, so two texts equal after it differed only in what it renames.
const NORMALISE = [
  {
    name: 'bg-clip-text ids',
    // src/modules/bgClipText.js names its <pattern> ids `sd-bct-<Math.random base36>`. The id
    // is referenced only inside the same svg (`fill="url(#id-k)"`), so renumbering every
    // distinct id by first appearance keeps every reference and changes nothing that paints.
    apply: (s) => { const seen = new Map(); return s.replace(/sd-bct-[a-z0-9]+/g, (m) => { if (!seen.has(m)) seen.set(m, `sd-bct-${seen.size}`); return seen.get(m) }) },
  },
]

// Demos whose bytes differ between two loads of the same build, per engine, with the cause
// and `only` when one column alone moves. Found by `--a . --b .` runs on 2026-11-14 (one full
// run on all three engines, then four more of every demo that moved), the cause read from
// the svg pair and the live-page fingerprint. Two of them are snapdom's own, not the page's.
const PAGE_RAF = 'the page moves its targets every frame from Math.random and requestAnimationFrame'
const PAGE_TIMER = 'the page prints its own measured capture time ("8 ms · GPU updated") and redraws a WebGL scene every frame'
const UNSTABLE = {
  'd-shooting-game': { chromium: { cause: PAGE_RAF }, firefox: { cause: PAGE_RAF }, webkit: { cause: PAGE_RAF } },
  'd-plugin-webgl-live-dom': { chromium: { cause: PAGE_TIMER }, firefox: { cause: PAGE_TIMER }, webkit: { cause: PAGE_TIMER } },
  // Firefox only, 4 runs in 5: the KaTeX boxes' live `top` and the row heights differ by
  // fractions of a pixel between loads (the live fingerprint differs), web fonts from a CDN.
  'd474-katex-formulas': { firefox: { cause: 'live KaTeX layout differs by sub-pixels between loads (CDN fonts, Firefox)' } },
  // Firefox only, 1 run in 4 after the speech wait above: the live formula box is 0.47px
  // taller in one load (the live fingerprint differs), MathJax fonts from a CDN.
  'd506-embedded-fonts': { firefox: { cause: 'live MathJax box height differs by 0.47px between some loads (CDN fonts, Firefox)' } },
  // snapdom, not the page: the live fingerprint is identical. On the recapture the image cache
  // hits and src/modules/images.js runs `img.src = cached` then `if (!img.width) img.width =
  // img.naturalWidth || 100` on the same tick; whether Firefox has decoded the data URL by
  // then decides whether width/height attributes are written (and 100 when it has not).
  // 1 run in 5 for each.
  // WebKit too, 2 runs in 4 with identical bundles (2026-11-15), same 75 characters.
  'd15-cors-fonts-test': {
    firefox: { only: 'second', cause: 'snapdom: images.js reads img.width before Firefox decoded the cached data URL (recapture)' },
    webkit: { only: 'second', cause: 'snapdom: images.js reads img.width before WebKit decoded the cached data URL (recapture)' },
  },
  'd1-divegood-visual-demos': { firefox: { only: 'second', cause: 'snapdom: images.js reads img.width before Firefox decoded the cached data URL (recapture)' } },
  // Firefox, 1 full run in 3, live fingerprint identical: the embedded Unbounded 400 face is
  // two different woff2 files (51,152 and 39,888 bytes in the header), one with the MIME
  // text/html. Not isolated: Google Fonts answering two subsets, or the fonts phase picking
  // a different face of the family. Both columns.
  'd6-demo-gallery-iframe': { firefox: { cause: 'the embedded Unbounded woff2 is a different file between loads (Google Fonts or face choice, not isolated)' } },
}

// The edit before the `mutated` capture, identical on both arms: the first element in document
// order at depth 2 or more under the captured root (a grandchild of it or deeper) that has a
// direct text node with non-blank text gets MUTATION appended to that text. Not a direct child:
// diffCapture sends an in-flow direct child of the root to the full pipeline, which the
// `first` column already covers. Not inside script, style, template, noscript or textarea,
// whose text is not laid out as text. Whether a given demo is then served by the
// differential path depends on its content and options (embedded fonts, heavy subtrees, plugins
// all bail to the full pipeline); the column compares whatever path the capture took.
const MUTATION = ' [svg-identity edit]'

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function parseArgs(argv) {
  const args = { a: null, b: null, engines: 'chromium,firefox,webkit', filter: '', out: 'output/svg-identity' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '')
    if (!(k in args)) throw new Error(`unknown option ${argv[i]}`)
    args[k] = argv[++i]
  }
  if (!args.a || !args.b) throw new Error('usage: node scripts/svg-identity.mjs --a <dir|ref> --b <dir|ref> [--engines chromium,firefox,webkit] [--filter d12,d5] [--out output/svg-identity]')
  return args
}

function run(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed in ${cwd}:\n${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

const worktrees = []

/** A directory is used as is; anything else must be a git ref of this repo. */
async function resolveTree(spec) {
  const dir = resolve(spec)
  if (existsSync(dir) && statSync(dir).isDirectory()) return { spec, dir: await realpath(dir), sha: null }
  const sha = run('git', ['rev-parse', '--verify', `${spec}^{commit}`], ROOT)
  const wt = await mkdtemp(join(tmpdir(), 'svg-identity-'))
  run('git', ['worktree', 'add', '--detach', wt, sha], ROOT)
  worktrees.push(wt)
  return { spec, dir: wt, sha }
}

/** Build with the tree's own config and copy the IIFE out, so A and B never share a file. */
async function buildTree(tree, dest) {
  if (!existsSync(join(tree.dir, 'node_modules'))) await symlink(await realpath(join(ROOT, 'node_modules')), join(tree.dir, 'node_modules'))
  run('node', ['esbuild.config.mjs'], tree.dir)
  await copyFile(join(tree.dir, 'dist/snapdom.js'), dest)
  return createHash('sha256').update(await readFile(dest)).digest('hex')
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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

// Runs in the page: live-parity's settle, which is the suite's.
async function settleInPage(budget) {
  const deadline = Date.now() + budget
  const left = () => Math.max(0, deadline - Date.now())
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const sheetsPending = () => {
    for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) if (!link.sheet && !link.disabled) return true
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
  // Paused before it is rewound, unlike the suite: rewound first, a running animation in
  // Firefox advanced again before pause() held it, and d5's rotation came out as
  // matrix(1, 0.000001793, ...) in one load and matrix(1, 1.19397e-7, ...) in the next.
  try { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0 } } catch { /* best-effort */ }
  try { await Promise.race([Promise.allSettled([...document.images].map((im) => im.decode?.())), sleep(left())]) } catch { /* best-effort */ }
}

const until = `async function until(pred, budget = 8000) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) { try { if (pred()) return true } catch {} await new Promise((r) => requestAnimationFrame(r)) }
  return false
}`

// Runs in the page: three captures of the same element (the third after the MUTATION edit, or
// null when there is nothing to edit), each as svg text, each preceded by a fingerprint of the
// live subtree (its markup and every element box, cyrb53). When the fingerprints of A and B
// differ the page itself was not the same, which is what tells a moving page from a snapdom
// that does not repeat itself.
async function captureThrice({ target, options, mutation }) {
  const el = target === 'body' ? document.body : (document.querySelector('#target') || document.body)
  const text = (url) => url.startsWith('data:image/svg+xml') ? decodeURIComponent(url.slice(url.indexOf(',') + 1)) : url
  const fingerprint = () => {
    let s = el.outerHTML
    for (const n of el.querySelectorAll('*')) { const r = n.getBoundingClientRect(); s += `|${r.x},${r.y},${r.width},${r.height}` }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  const pageFirst = fingerprint()
  const first = text((await window.snapdom(el, options)).url)
  const pageSecond = fingerprint()
  const second = text((await window.snapdom(el, options)).url)
  let edit = null
  for (const n of el.querySelectorAll(':scope > * *')) {
    if (n.closest('script,style,template,noscript,textarea')) continue
    edit = [...n.childNodes].find((c) => c.nodeType === 3 && c.data.trim())
    if (edit) break
  }
  if (!edit) return { first, second, mutated: null, pageFirst, pageSecond, pageMutated: null }
  edit.data += mutation
  const pageMutated = fingerprint()
  const mutated = text((await window.snapdom(el, options)).url)
  return { first, second, mutated, pageFirst, pageSecond, pageMutated }
}

/** One fresh page per load. `lane.browser` is relaunched when a page will not close: a WebKit
 *  page whose `goto` timed out on a CDN (d454, 2026-11-14) never answered `close()`, and
 *  the run waited on it forever. */
async function loadAndCapture(lane, base, demo, bundle) {
  const conf = DEMOS[demo] || {}
  const page = await lane.browser.newPage({ viewport: { width: 1280, height: 1024 }, deviceScaleFactor: 1 })
  let timer
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('load timed out after 90 s')), 90_000) })
    return await Promise.race([timeout, (async () => {
      await page.goto(`${base}/demos/${demo}.html`, { waitUntil: 'load', timeout: 30000 })
      // The suite's two frames and `defaultWait: 200` before its setup.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))))
      await page.evaluate(settleInPage, 8000)
      if (conf.setup) {
        await page.evaluate(`(async () => { ${until}; await (${conf.setup.toString()})() })()`)
        await page.evaluate(settleInPage, 8000)
      }
      await page.addScriptTag({ path: bundle })
      return await page.evaluate(captureThrice, { target: conf.target || null, options: conf.options || BASE_OPTIONS, mutation: MUTATION })
    })()])
  } finally {
    clearTimeout(timer)
    const closed = await Promise.race([page.close().then(() => true, () => true), new Promise((r) => setTimeout(r, 10_000, false))])
    if (!closed) {
      lane.browser.close().catch(() => {})
      lane.browser = await playwright[lane.engine].launch()
    }
  }
}

const COLUMNS = ['first', 'second', 'mutated']

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

const snippet = (s, at) => JSON.stringify(s.slice(Math.max(0, at - 40), at + 60))

/** Compare one column: raw, then normalised. Returns null when identical. */
function compareColumn(a, b, used) {
  if (a === b) return null
  let na = a, nb = b
  for (const n of NORMALISE) {
    const [xa, xb] = [n.apply(na), n.apply(nb)]
    if (xa === xb) { used[n.name] = (used[n.name] || 0) + 1; return null }
    na = xa; nb = xb
  }
  const at = firstDiff(na, nb)
  return { at, lenA: na.length, lenB: nb.length, ctxA: snippet(na, at), ctxB: snippet(nb, at), a, b }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const OUT = resolve(args.out)
  const engines = args.engines.split(',').map((s) => s.trim()).filter(Boolean)
  const filters = args.filter.split(',').map((s) => s.trim()).filter(Boolean)
  if (!filters.length) await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'builds'), { recursive: true })

  const treeA = await resolveTree(args.a)
  const treeB = await resolveTree(args.b)
  const bundleA = join(OUT, 'builds/A.js'), bundleB = join(OUT, 'builds/B.js')
  const hashA = await buildTree(treeA, bundleA)
  const hashB = treeB.dir === treeA.dir ? (await copyFile(bundleA, bundleB), hashA) : await buildTree(treeB, bundleB)
  console.log(`A ${treeA.spec} (${treeA.dir}) bundle ${hashA.slice(0, 12)}`)
  console.log(`B ${treeB.spec} (${treeB.dir}) bundle ${hashB.slice(0, 12)}${hashA === hashB ? ' (same bundle: any difference below is nondeterminism)' : ''}`)

  const demos = (await readdir(join(ROOT, 'demos')))
    .filter((f) => /^d.*\.html$/.test(f)).map((f) => f.replace(/\.html$/, ''))
    .filter((d) => !skippedVisualDemos.has(d))
    .filter((d) => !filters.length || filters.some((f) => d.includes(f)))
    .sort()

  const server = await serve()
  const base = `http://127.0.0.1:${server.address().port}`
  const rows = []
  const used = {}
  try {
    for (const engine of engines) {
      const started = Date.now()
      const lane = { engine, browser: await playwright[engine].launch() }
      for (const demo of demos) {
        const u = UNSTABLE[demo]?.[engine]
        const row = { engine, demo, unstable: u?.cause || null, unstableOnly: u?.only || null }
        try {
          const a = await loadAndCapture(lane, base, demo, bundleA)
          const b = await loadAndCapture(lane, base, demo, bundleB)
          row.first = compareColumn(a.first, b.first, used)
          row.second = compareColumn(a.second, b.second, used)
          // Both arms run the same page and the same edit, so one with nothing to edit and the
          // other with something means the live page itself differed: compared as a difference.
          row.na = a.mutated === null && b.mutated === null
          row.mutated = row.na ? null : compareColumn(a.mutated ?? '', b.mutated ?? '', used)
          // Whether the live page differed between the two loads, per column.
          row.pageMoved = [a.pageFirst !== b.pageFirst, a.pageSecond !== b.pageSecond, a.pageMutated !== b.pageMutated]
          row.bytes = a.first.length
        } catch (e) {
          row.error = String(e?.message || e).split('\n')[0].slice(0, 200)
        }
        rows.push(row)
        const cell = (c, moved) => (c ? `DIFF@${c.at}` : 'same') + (moved ? '*' : '')
        const status = row.error ? `ERROR ${row.error}` : `${cell(row.first, row.pageMoved[0]).padEnd(13)} ${cell(row.second, row.pageMoved[1]).padEnd(13)} ${row.na ? 'n/a' : cell(row.mutated, row.pageMoved[2])}`
        console.log(`${engine.padEnd(9)} ${demo.padEnd(34)} ${status}${row.unstable ? `  (unstable${row.unstableOnly ? ', ' + row.unstableOnly : ''})` : ''}`)
        for (const col of COLUMNS) {
          const c = row[col]
          if (!c) continue
          await mkdir(join(OUT, engine), { recursive: true })
          await writeFile(join(OUT, engine, `${demo}.${col}.A.svg`), c.a)
          await writeFile(join(OUT, engine, `${demo}.${col}.B.svg`), c.b)
          delete c.a; delete c.b
        }
      }
      await lane.browser.close()
      console.log(`${engine}: ${demos.length} demos in ${((Date.now() - started) / 1000).toFixed(0)} s\n`)
    }
  } finally {
    server.close()
  }

  // Summary: stable differences fail the run, unstable ones are listed on their own.
  const excused = (r, col) => r.unstable && (!r.unstableOnly || r.unstableOnly === col)
  const differs = (r) => COLUMNS.some((col) => r[col])
  const lines = []
  for (const r of rows.filter((x) => differs(x))) {
    COLUMNS.forEach((col, i) => {
      const c = r[col]
      if (c) lines.push(`${excused(r, col) ? 'UNSTABLE ' : ''}${r.engine} ${r.demo} [${col}] offset ${c.at} (A ${c.lenA} B ${c.lenB} chars)${r.pageMoved[i] ? ', live page differed too' : ', live page identical'}\n  A ${c.ctxA}\n  B ${c.ctxB}`)
    })
  }
  const stableDiffs = rows.filter((r) => COLUMNS.some((col) => r[col] && !excused(r, col)))
  const naRows = rows.filter((r) => r.na)
  const unstableRows = rows.filter((r) => r.unstable)
  const errors = rows.filter((r) => r.error)
  console.log(lines.join('\n'))
  console.log(`\n${rows.length} captures (demo x engine): ${stableDiffs.length} differ, ${errors.length} failed to load, ${unstableRows.length} in UNSTABLE (${unstableRows.filter(differs).length} of them differed), ${naRows.length} with nothing to edit (mutated n/a).`)
  for (const r of unstableRows) console.log(`  UNSTABLE ${r.engine} ${r.demo}${r.unstableOnly ? ` [${r.unstableOnly} only]` : ''}: ${r.unstable}${differs(r) ? ' (differed this run)' : ''}`)
  for (const [k, v] of Object.entries(used)) console.log(`  normalisation "${k}" absorbed ${v} difference(s)`)
  for (const r of errors) console.log(`  ERROR ${r.engine} ${r.demo}: ${r.error}`)
  await writeFile(join(OUT, filters.length ? 'report.partial.json' : 'report.json'), JSON.stringify({ a: { ...treeA, bundle: hashA }, b: { ...treeB, bundle: hashB }, normalised: used, rows }, null, 2))
  process.exitCode = errors.length ? 2 : stableDiffs.length ? 1 : 0
}

async function cleanup() {
  for (const wt of worktrees.splice(0)) {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT })
    await rm(wt, { recursive: true, force: true })
  }
}

process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
try {
  await main()
} catch (e) {
  console.error(e?.message || e)
  process.exitCode = 2
} finally {
  await cleanup()
}
