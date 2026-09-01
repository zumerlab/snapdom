// CSS-heavy page: ~10k author rules, ~1000 nodes styled ONLY by classes.
//
// Every older scene styles inline, so styleScan's property universe, the per-pseudo selector
// gates and the class-CSS diffing — the machinery with its own reverted-optimization history
// (the rule-epoch revert) — were unexercised by any benchmark. This is where Tailwind-scale
// apps live. The soft-vs-disabled pair prices what the cross-capture caches buy HERE.
//
// Run:  npx vitest bench __tests__/category.cssheavy.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, cssHeavyScenario } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(() => { scene = cssHeavyScenario() })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 1, iterations: 4, time: 0 }

describe('CSS-heavy: 10k rules, 1000 class-styled nodes', () => {
  bench('snapDOM (cache soft)', async () => {
    await snapdom.toRaw(scene.root, { burst: false })
  }, OPTS)

  bench('snapDOM (cache disabled)', async () => {
    await snapdom.toRaw(scene.root, { burst: false, cache: 'disabled' })
  }, OPTS)

  bench('modern-screenshot 4.7.0', async () => {
    await LIBS['modern-screenshot 4.7.0'](scene.root)
  }, OPTS)

  bench('dom-to-image-more 3.10.2', async () => {
    await LIBS['dom-to-image-more 3.10.2'](scene.root)
  }, OPTS)

  bench('html-to-image 1.11.13', async () => {
    await LIBS['html-to-image 1.11.13'](scene.root)
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await LIBS['domlens.js 0.1.0'](scene.root)
  }, OPTS)
})
