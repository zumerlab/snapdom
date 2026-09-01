// Cold vs steady, PER ELEMENT — the number a one-shot user actually experiences.
//
// The v3 audit measured ~214ms cold vs ~75ms steady on a 1500-node table and nothing pinned
// it: every other bench measures warm iterations of one element. Real apps capture a
// DIFFERENT element each time (share-this-card, export-this-row), so per-element cold with
// warm module caches (arm A) is the common real case; arm B is steady state on one element;
// arm C prices the cross-capture caches themselves. A/B is the headline ratio. The
// cross-library arms give the same fresh-element treatment to the two closest competitors,
// so the comparison is cold-vs-cold rather than our-cold-vs-their-warm.
//
// ONE OUTPUT STAGE FOR EVERYONE: every arm ends at a PNG data URL. The first version of
// this file had snapdom at toRaw (SVG url, no raster/encode) against the competitors' full
// PNG, and the 8.2Mpx encode this table produces is ~130ms — the "snapdom wins cold" read
// that came out of it was an artifact of the missing stage, not a result. The A/B/C ratios
// are stage-independent; the cross-library rows are only citable at equal stages.
//
// Run:  npx vitest bench __tests__/category.cold.benchmark.js --browser.headless --watch=false
import { bench, describe, afterEach } from 'vitest'
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

afterEach(() => { el?.remove(); el = null })

describe('Cold vs steady per element: big table (500 rows)', () => {
  bench('A · snapDOM, FRESH element each capture (per-element cold)', async () => {
    await toDataUrl(await snapdom.toPng(freshElement(), { burst: false }))
  }, { warmupIterations: 1, iterations: 6, time: 0 })

  bench('B · snapDOM, SAME element recaptured (steady state)', async () => {
    if (!el || !document.body.contains(el)) freshElement()
    await toDataUrl(await snapdom.toPng(el, { burst: false }))
  }, { warmupIterations: 2, iterations: 6, time: 0 })

  bench('C · snapDOM, fresh element + cache:disabled (true cold)', async () => {
    await toDataUrl(await snapdom.toPng(freshElement(), { burst: false, cache: 'disabled' }))
  }, { warmupIterations: 1, iterations: 6, time: 0 })

  bench('modern-screenshot, fresh element each capture', async () => {
    await LIBS['modern-screenshot 4.7.0'](freshElement())
  }, { warmupIterations: 1, iterations: 4, time: 0 })

  bench('domlens, fresh element each capture', async () => {
    await LIBS['domlens.js 0.1.0'](freshElement())
  }, { warmupIterations: 1, iterations: 4, time: 0 })
})
