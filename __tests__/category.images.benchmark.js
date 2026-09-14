// Image-heavy page over REAL same-origin URLs — the fetch → inline path.
//
// compress.benchmark.js and the old galleries feed canvas-generated data: URLs, so only
// decode was ever paid: inlineImages' fetch -> blob -> dataURL path and the resource cache
// never ran in any bench. Real pages have 30-50 <img> loaded by URL. The second snapdom arm
// runs with `cache: 'disabled'`, the escape hatch that empties every persistent cache before
// the capture, so every image is fetched and inlined again: the gap between the two arms is
// the resource cache's payoff, which a page's second capture gets for free. Fixtures are
// served by the vitest dev server, so network jitter is bounded; setup awaits decode so the
// live page is settled.
//
// Run:  npx vitest bench __tests__/category.images.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, imageGridScenario, toDataUrl } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(async () => { scene = imageGridScenario(); await scene.ready })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 1, iterations: 4, time: 0 }

describe('Image grid: 40 distinct same-origin PNGs over HTTP', () => {
  bench('snapDOM', async () => {
    await toDataUrl(await snapdom.toCanvas(scene.root, { scale: 1, dpr: 1, burst: false }))
  }, OPTS)

  bench('snapDOM, caches wiped before each capture (every image re-fetched)', async () => {
    await toDataUrl(await snapdom.toCanvas(scene.root, { scale: 1, dpr: 1, burst: false, cache: 'disabled' }))
  }, OPTS)

  bench('modern-screenshot 4.7.0', async () => {
    await LIBS['modern-screenshot 4.7.0'](scene.root)
  }, OPTS)

  bench('html-to-image 1.11.13', async () => {
    await LIBS['html-to-image 1.11.13'](scene.root)
  }, OPTS)

  bench('dom-to-image-more 3.10.2', async () => {
    await LIBS['dom-to-image-more 3.10.2'](scene.root)
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await LIBS['domlens.js 0.1.0'](scene.root)
  }, OPTS)
})
