// Cold vs steady, PER ELEMENT — the number a one-shot user actually experiences.
//
// The v3 audit measured ~214ms cold vs ~75ms steady on a 1500-node table and nothing pinned
// it: every other bench measures warm iterations of one element. Real apps capture a
// DIFFERENT element each time (share-this-card, export-this-row), so per-element cold with
// warm module caches (arm A) is the common real case; arm B is steady state on one element.
// A/B is the headline ratio. The cross-library arms give the same fresh-element treatment to
// the two closest competitors, so the comparison is cold-vs-cold rather than
// our-cold-vs-their-warm.
//
// There used to be an arm C, fresh element + `cache: 'disabled'`. It measured the same as
// arm A (216 vs 219 ms): the per-node caches are WeakMaps keyed by node, so a fresh element
// misses them by construction, and wiping them changes nothing. `cache: 'disabled'` is not a
// mode — it is the escape hatch that empties every persistent cache — and on this scene it
// priced nothing, so the row was noise in a table meant to be read across libraries.
//
// ONE OUTPUT STAGE FOR EVERYONE: every arm ends at a PNG data URL. The first version of
// this file had snapdom at toRaw (SVG url, no raster/encode) against the competitors' full
// PNG, and the 8.2Mpx encode this table produces is ~130ms — the "snapdom wins cold" read
// that came out of it was an artifact of the missing stage, not a result. Ratios depend on
// the output stage; these rows all include rasterization and PNG encoding.
//
// Run:  npx vitest bench __tests__/category.cold.benchmark.js --browser.headless --watch=false
import { bench, describe } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, bigTableHTML, toDataUrl } from './category.libs.js'

const LIBS = await loadLibs()

const HTML = bigTableHTML(500)
let el = null
let salt = 0

function freshElement() {
  el?.remove()
  el = document.createElement('div')
  el.style.cssText = 'width:640px;font-family:Arial,sans-serif;font-size:13px'
  // Unique content per element: identical captures produce identical data URLs, and the
  // browser then serves the svg decode, the foreignObject raster and the PNG decode from
  // its image cache — stages a real capture (of a real, unique element) always pays. The
  // marker row keeps every arm honest without changing the scene's shape.
  el.innerHTML = `<div style="height:14px;font-size:11px">capture #${salt++}</div>` + HTML
  document.body.appendChild(el)
  return el
}

// Vitest bench does not run its afterEach hooks. Task teardown also prevents the
// steady arm from inheriting the last element mounted by the preceding cold arm.
const cleanup = () => { el?.remove(); el = null }
const freshOpts = { warmupIterations: 1, iterations: 6, time: 0, teardown: cleanup }

describe('Fresh mount + capture vs steady capture: big table (500 rows)', () => {
  bench('A · snapDOM, mount + capture a FRESH element', async () => {
    await toDataUrl(await snapdom.toCanvas(freshElement(), { dpr: 1, burst: false }))
  }, freshOpts)

  bench('B · snapDOM, SAME element recaptured (steady state)', async () => {
    await toDataUrl(await snapdom.toCanvas(el, { dpr: 1, burst: false }))
  }, { ...freshOpts, warmupIterations: 2, setup: freshElement })

  bench('modern-screenshot, mount + capture a fresh element', async () => {
    await LIBS['modern-screenshot 4.7.0'](freshElement())
  }, { ...freshOpts, iterations: 4 })

  bench('domlens, mount + capture a fresh element', async () => {
    await LIBS['domlens.js 0.1.0'](freshElement())
  }, { ...freshOpts, iterations: 4 })
})
