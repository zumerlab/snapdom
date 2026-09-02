// Cross-library POLLING — memoization allowed and labeled.
//
// This is the one table where snapdom runs with DEFAULTS on purpose: a dashboard poller
// captures the same element every tick, which is exactly what auto-burst + differential
// recapture exist for (the 563ms -> 16ms headline win). The category table pins burst:false
// because it claims one-shot pipeline cost; THIS file claims the opposite scenario and says
// so in every label. Competitors run as-is — none of them memoizes. One bench iteration =
// a full 20-capture loop with a metric mutating every 4th tick (so snapdom's diff path does
// real work; a fully static loop would flatter the memo).
//
// Run:  npx vitest bench __tests__/category.polling.benchmark.js --browser.headless --watch=false
import { bench, describe, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, dashboardScenario, toDataUrl } from './category.libs.js'

const LIBS = await loadLibs()

const TICKS = 20
let scene = null
afterEach(() => { scene?.cleanup(); scene = null })

async function loop(capture) {
  scene = dashboardScenario()
  const values = scene.root.querySelectorAll('.metric-v')
  for (let t = 0; t < TICKS; t++) {
    if (t % 4 === 3) values[t % values.length].textContent = String(1000 + t)
    await capture(scene.root)
  }
}

const OPTS = { warmupIterations: 1, iterations: 6, time: 0 }

describe(`Polling: ${TICKS} captures of a live dashboard (memoization allowed, labeled)`, () => {
  bench('snapDOM defaults (auto-burst memo + diff engage)', async () => {
    await loop(async (el) => toDataUrl(await snapdom.toCanvas(el, { scale: 1, dpr: 1 })))
  }, OPTS)

  bench('snapDOM burst:false (what the poller would pay without the memo)', async () => {
    await loop(async (el) => toDataUrl(await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })))
  }, OPTS)

  bench('modern-screenshot 4.7.0', async () => {
    await loop(LIBS['modern-screenshot 4.7.0'])
  }, OPTS)

  bench('dom-to-image-more 3.10.2', async () => {
    await loop(LIBS['dom-to-image-more 3.10.2'])
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await loop(LIBS['domlens.js 0.1.0'])
  }, OPTS)
})
