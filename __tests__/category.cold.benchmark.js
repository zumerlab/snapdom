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
// Run:  npx vitest bench __tests__/category.cold.benchmark.js --browser.headless --watch=false
import { bench, describe, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { LIBS, bigTableHTML } from './category.libs.js'

const HTML = bigTableHTML(500)
let el = null

function freshElement() {
  el?.remove()
  el = document.createElement('div')
  el.style.cssText = 'width:640px;font-family:Arial,sans-serif;font-size:13px'
  el.innerHTML = HTML
  document.body.appendChild(el)
  return el
}

afterEach(() => { el?.remove(); el = null })

describe('Cold vs steady per element: big table (500 rows)', () => {
  bench('A · snapDOM, FRESH element each capture (per-element cold)', async () => {
    await snapdom.toRaw(freshElement(), { burst: false })
  }, { warmupIterations: 1, iterations: 6, time: 0 })

  bench('B · snapDOM, SAME element recaptured (steady state)', async () => {
    if (!el || !document.body.contains(el)) freshElement()
    await snapdom.toRaw(el, { burst: false })
  }, { warmupIterations: 2, iterations: 6, time: 0 })

  bench('C · snapDOM, fresh element + cache:disabled (true cold)', async () => {
    await snapdom.toRaw(freshElement(), { burst: false, cache: 'disabled' })
  }, { warmupIterations: 1, iterations: 6, time: 0 })

  bench('modern-screenshot, fresh element each capture', async () => {
    await LIBS['modern-screenshot 4.7.0'](freshElement())
  }, { warmupIterations: 1, iterations: 4, time: 0 })

  bench('domlens, fresh element each capture', async () => {
    await LIBS['domlens.js 0.1.0'](freshElement())
  }, { warmupIterations: 1, iterations: 4, time: 0 })
})
