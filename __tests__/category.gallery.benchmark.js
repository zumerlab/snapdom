// Photo gallery — one 3000x1400 hero and eight 1500x1000 thumbnails shown at 960x360 and
// ~232x130: a product page, a media card. 16 Mpx of sources for 0.6 Mpx of output, which is
// what prices image inlining and downsampling. The photos are canvas-generated once and
// served as same-origin blob: URLs (harness.js galleryScenario), so every library fetches them
// the way it fetches an HTTP image; nothing binary ships with the repo.
//
// Steady state, like the other scene rows: the same mounted element, memo pinned off. SnapDOM's
// compress pass downsamples each source to the resolution the output can show (4 MB of payload
// instead of 26 MB) and memoizes the result per image, so the steady number is the memoized
// pipeline plus the raster of the small payload; competitors embed the sources whole and pay
// the raster of 26 MB instead. The cold number for this scene lives in the real-page script
// (scripts/realpage-bench.mjs).
//
// ONE OUTPUT STAGE, as everywhere in this category: PNG data URL, defaults, scale 1, dpr 1.
//
// Run:  npx vitest bench __tests__/category.gallery.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, galleryScenario, toDataUrl } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(async () => { scene = await galleryScenario() })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 2, iterations: 6, time: 0 }

describe('Photo gallery: 9 photos, 16 Mpx of sources, 960px wide', () => {
  bench('snapDOM (burst:false)', async () => {
    await toDataUrl(await snapdom.toCanvas(scene.root, { scale: 1, dpr: 1, burst: false }))
  }, OPTS)

  bench('domlens.js 0.1.0', async () => {
    await LIBS['domlens.js 0.1.0'](scene.root)
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

  bench('html2canvas 1.4.1', async () => {
    await LIBS['html2canvas 1.4.1'](scene.root)
  }, OPTS)
})
