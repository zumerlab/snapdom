// Deep nested flex/grid tree — ~2,100 elements at depth ~11.
//
// Why this scene and not one of ours: it is domlens's own benchmark page
// (tests/bench/pages/deep-tree.html), and it is the cell their published table has snapdom
// losing worst on — 2,913 ms warm and 6,252 ms cold against their 1,058 ms canvas engine.
// That table benchmarks @zumer/snapdom 2.12.8 (published 2026-06-03) in a run dated
// 2026-08-19, so the first question is simply whether the number still describes anything.
// Running a competitor's own adversarial corpus is free, and a scene shape nothing else here
// covers: depth is its own cost, since every level is a flex or grid container whose children
// resolve used values against it. The port keeps 16 of their 24 chains: stacked, 24 are
// 1232x20340, past the 16384px decode limit, where snapdom downscales and the others do not —
// their table compares snapdom at 1031x16384 with html2canvas at 1280x20340 (see harness.js).
//
// ONE OUTPUT STAGE, as everywhere in this category: PNG data URL, defaults, scale 1, dpr 1.
//
// Run:  npx vitest bench __tests__/category.deeptree.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, deepTreeScenario } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(() => { scene = deepTreeScenario() })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 2, iterations: 6, time: 0 }

describe('Deep tree: 16 chains x 10 levels, ~2100 elements, depth ~11', () => {
  bench('snapDOM (burst:false)', async () => {
    await snapdom.toPng(scene.root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await LIBS['domlens.js 0.1.0'](scene.root)
  }, OPTS)

  bench('modern-screenshot 4.7.0', async () => {
    await LIBS['modern-screenshot 4.7.0'](scene.root)
  }, OPTS)

  bench('html2canvas 1.4.1', async () => {
    await LIBS['html2canvas 1.4.1'](scene.root)
  }, OPTS)

  bench('html-to-image 1.11.13', async () => {
    await LIBS['html-to-image 1.11.13'](scene.root)
  }, OPTS)
})
