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

/** CSS px → PDF points (96dpi → 72dpi). */
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

export function clearArtifacts(dir) {
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) fs.rmSync(path.join(dir, entry.name), { force: true })
    }
  }
  fs.mkdirSync(dir, { recursive: true })
}
