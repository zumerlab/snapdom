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
import { loadLibs, LIB_NAMES, UNAVAILABLE } from './helpers/category.libs.js'
import { networkGuard } from './helpers/network-gate.js'

// Adapters come from the shared helper, NOT from category.benchmark.js: importing that file
// here would throw, because bench() only exists under `vitest bench`. Every competitor is
// fetched from a CDN, so a library this machine cannot reach is reported as unavailable
// instead of failing the run. snapdom is local and always tested.
const LIBS = await loadLibs()

const ENGINE = server?.browser || 'unknown'

// ── Fixture: one marker color per capability, all far apart in RGB ──────────

const TARGETS = {
  sanity_render:       [[0x00, 0xc8, 0x00]],                     // green: if missing, the capture itself failed
  open_shadow_dom:     [[0xe0, 0x00, 0x00]],                     // red inside an open shadow root
  pseudo_elements:     [[0x00, 0x00, 0xe0]],                     // blue ::before
  conic_gradient:      [[0xff, 0x88, 0x00], [0xcc, 0x00, 0xcc]], // orange AND magenta halves
  slotted_content:     [[0x00, 0x90, 0x90]],                     // teal light-DOM child through <slot>
  adopted_stylesheets: [[0x80, 0x80, 0x00]],                     // olive via constructable stylesheet
  canvas_content:      [[0xff, 0x66, 0xaa]],                     // pink painted on a <canvas> in the subtree
}
const CAPS = Object.keys(TARGETS).filter((k) => k !== 'sanity_render')
const TOL = 45        // per-channel tolerance
const THRESHOLD = 800 // pixels (each marker is 60x60 = 3600 at scale 1)

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

// ── Pixel oracle (in-browser) ───────────────────────────────────────────────

async function analyze(dataUrl) {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  const counts = {}
  for (const k of Object.keys(TARGETS)) counts[k] = TARGETS[k].map(() => 0)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    for (const k of Object.keys(TARGETS)) TARGETS[k].forEach((t, j) => {
      if (Math.abs(r - t[0]) <= TOL && Math.abs(g - t[1]) <= TOL && Math.abs(b - t[2]) <= TOL) counts[k][j]++
    })
  }
  const res = {}
  for (const k of Object.keys(TARGETS)) res[k] = counts[k].every((n) => n >= THRESHOLD)
  return res
}

// ── Tests ───────────────────────────────────────────────────────────────────

const results = []
let fixture

// Only the competitor rows touch the network; snapdom's row and the oracle self-test run
// on a dead link, which is what keeps this file safe inside `npm test`.
beforeEach(networkGuard((name) => name !== 'snapDOM current'))
afterEach(() => { if (fixture) { fixture.remove(); fixture = null } })

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
  console.log(`\n=== Capability matrix — ${ENGINE} (defaults profile, scale 1) ===`)
  console.table(results.map(({ engine: _engine, ...r }) => r))
  if (UNAVAILABLE.size) {
    console.log(`not reachable from this machine: ${[...UNAVAILABLE.keys()].join(', ')}`)
  }
})
