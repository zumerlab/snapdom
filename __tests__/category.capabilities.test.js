// __tests__/category.capabilities.test.js
// Capability matrix for every element-to-image library in the category,
// verified by a pixel-presence oracle — not by docs, not by claims.
//
// What it does:
//   1. Mutation test: the oracle must report every capability ABSENT on a
//      fixture that has none. If it can't say "no", nothing it says means anything.
//   2. For each library: capture the discriminating fixture, count pixels of
//      each capability's marker color, record PASS/FAIL + cold first-capture ms.
//   3. snapdom's row is asserted (this doubles as a regression test);
//      competitors are recorded and reported, sanity soft-asserted.
//
// Cross-engine: run with BROWSER=all. A cell is "universal" only if identical
// in every engine (e.g. html-to-image drops embedded canvas in WebKit only).
// Profiles: defaults only (scale 1). A FAIL here means "fails with defaults";
// e.g. html2canvas passes conic/adoptedStyleSheets with foreignObjectRendering.
//
// Run:  npx vitest run __tests__/category.capabilities.test.js --browser.headless --reporter=verbose
//       BROWSER=all npx vitest run __tests__/category.capabilities.test.js --browser.headless

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { server } from '@vitest/browser/context'
import { loadLibs, LIB_NAMES, UNAVAILABLE } from './category.libs.js'
import { buildCapabilityFixture, analyzeCapabilities as analyze, CAPS } from '../docs/compare/live/harness.js'
import { networkGuard } from './helpers/network-gate.js'

// Every competitor comes from a CDN, so a library this machine cannot reach is reported as
// unavailable instead of failing the run. snapdom is local and always tested.
const LIBS = await loadLibs()

const ENGINE = server?.browser || 'unknown'

// The fixture, the marker colours and the pixel oracle live in docs/compare/live/harness.js:
// the live lab on the docs site runs this same matrix in the visitor's own browser, and a
// second copy of the oracle is a second thing to keep true.

// ── Tests ───────────────────────────────────────────────────────────────────

const results = []
let fixture

afterEach(() => { if (fixture) { fixture.remove(); fixture = null } })

// Only the competitor rows touch the network; snapdom's row and the oracle self-test run
// on a dead link, which is what keeps this file safe inside `npm test`.
beforeEach(networkGuard((name) => LIB_NAMES.includes(name) && name !== 'snapDOM current'))

describe(`Oracle self-test [${ENGINE}]`, () => {
  test('mutation test: oracle reports every capability absent on the mutant fixture', async () => {
    fixture = buildCapabilityFixture({ mutant: true })
    document.body.appendChild(fixture)
    const r = await analyze(await LIBS['snapDOM current'](fixture))
    expect(r.sanity_render).toBe(true)
    for (const cap of CAPS) expect(r[cap], `${cap} must be reported absent`).toBe(false)
  }, 30_000)
})

describe(`Capability matrix [${ENGINE}]`, () => {
  for (const name of LIB_NAMES) {
    const capture = LIBS[name]
    test(name, async (ctx) => {
      // Reported as skipped WITH the reason rather than as a green pass that covered nothing.
      if (!capture) ctx.skip(`could not load: ${UNAVAILABLE.get(name)}`)
      fixture = buildCapabilityFixture()
      document.body.appendChild(fixture)
      const t0 = performance.now()
      let dataUrl, error = null
      try { dataUrl = await capture(fixture) } catch (e) { error = String(e?.message || e).slice(0, 80) }
      const coldMs = Math.round(performance.now() - t0)
      const row = { engine: ENGINE, library: name, coldMs, error }
      if (!error) {
        const r = await analyze(dataUrl)
        row.sanity = r.sanity_render
        for (const cap of CAPS) row[cap] = r[cap] ? 'PASS' : 'FAIL'
      }
      results.push(row)

      if (name === 'snapDOM current') {
        expect(error).toBeNull()
        expect(row.sanity).toBe(true)
        for (const cap of CAPS) expect(row[cap], cap).toBe('PASS')
      } else {
        expect.soft(error, `${name} threw`).toBeNull()
        if (!error) expect.soft(row.sanity, `${name} rendered nothing`).toBe(true)
      }
    }, 60_000)
  }
})

afterAll(() => {
  // One table per engine; under BROWSER=all diff the tables to find browser-specific cells.
  // Rendered by hand rather than with console.table: the browser-mode console bridge
  // forwards the call but not the table, so the matrix printed as nothing at all.
  const cols = ['library', 'coldMs', 'sanity', ...CAPS]
  const head = { library: 'library', coldMs: 'cold ms', sanity: 'render' }
  for (const c of CAPS) head[c] = c.replace(/_/g, ' ')
  const cell = (r, c) => {
    if (r.error && c !== 'library') return c === 'coldMs' ? String(r.coldMs) : '—'
    const v = r[c]
    return v === true ? 'PASS' : v === false ? 'FAIL' : String(v ?? '—')
  }
  const w = cols.map((c) => Math.max(head[c].length, ...results.map((r) => cell(r, c).length)))
  const line = (get) => cols.map((c, i) => get(c).padEnd(w[i])).join('  ')
  console.log(`\n=== Capability matrix — ${ENGINE} (defaults profile, scale 1) ===`)
  console.log(line((c) => head[c]))
  console.log(w.map((n) => '-'.repeat(n)).join('  '))
  for (const r of results) {
    console.log(line((c) => cell(r, c)) + (r.error ? `   ERROR: ${r.error}` : ''))
  }
  if (UNAVAILABLE.size) {
    console.log(`not reachable from this machine: ${[...UNAVAILABLE.keys()].join(', ')}`)
  }
})
