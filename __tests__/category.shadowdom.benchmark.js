// Deep shadow-DOM component tree at scale — the design-system norm.
//
// The capability matrix proves one open root RENDERS; nothing measured the COST when a page
// has 150 of them nested 3 deep (~3000 nodes): per-root style extraction and scoping,
// slot resolution, and — on the polling arm — the per-capture trackShadowRoots rescan that
// burst.js prices at "~1ms at 8k nodes", a claim pinned nowhere until now.
//
// Only libraries whose shadow-DOM cell is PASS in the capability matrix are timed —
// dom-to-image, dom-to-image-modern and @renoun/screenshot drop the shadow content entirely
// (matrix, chromium), and timing a library that skips the work is not a comparison.
//
// Run:  npx vitest bench __tests__/category.shadowdom.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, shadowTreeScenario } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(() => { scene = shadowTreeScenario() })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 2, iterations: 10, time: 0 }

describe('Shadow DOM: 150 open roots, 3 levels, ~3000 nodes', () => {
  bench('snapDOM (burst:false)', async () => {
    await snapdom.toPng(scene.root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('snapDOM polling 20x, defaults (prices the per-capture root rescan vs the memo)', async () => {
    for (let t = 0; t < 20; t++) await snapdom.toPng(scene.root, { scale: 1, dpr: 1 })
  }, { warmupIterations: 1, iterations: 2, time: 0 })

  bench('modern-screenshot 4.7.0', async () => {
    await LIBS['modern-screenshot 4.7.0'](scene.root)
  }, OPTS)

  bench('html-to-image 1.11.13', async () => {
    await LIBS['html-to-image 1.11.13'](scene.root)
  }, OPTS)

  bench('dom-to-image-more 3.10.2', async () => {
    await LIBS['dom-to-image-more 3.10.2'](scene.root)
  }, OPTS)

  bench('html2canvas 1.4.1', async () => {
    await LIBS['html2canvas 1.4.1'](scene.root)
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await LIBS['domlens.js 0.1.0'](scene.root)
  }, OPTS)
})
