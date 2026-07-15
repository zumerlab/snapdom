// `clip: 'viewport'` vs full-page capture on a long page.
// The claim under test: viewport capture must be FASTER than full page, because offscreen
// subtrees are pruned before styling/inlining and the raster area is viewport-sized.
// Run: `npm run test:benchmark` (or target this file).
import { bench, describe } from 'vitest'
import { snapdom } from '../src/index.js'

let page
function setupPage() {
  if (page && document.body.contains(page)) return
  page = document.createElement('div')
  page.style.cssText = 'width:800px;margin:0;font-family:system-ui;font-size:14px;color:#222'
  let html = ''
  for (let s = 0; s < 60; s++) {
    html += `<section style="padding:16px;border-bottom:1px solid #ddd"><h2>Section ${s}</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">`
    for (let i = 0; i < 24; i++) {
      html += `<div style="background:#f1f5f9;border-radius:6px;padding:8px;box-shadow:0 1px 2px rgba(0,0,0,.2)"><b>Card ${s}-${i}</b><p style="margin:4px 0 0">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></div>`
    }
    html += '</div></section>'
  }
  page.innerHTML = html
  document.body.appendChild(page)
}

const benchOpts = { time: 3000, warmupIterations: 2 }

describe('clip: long page (~60 sections, ~1500 cards)', () => {
  bench('full page (toRaw)', async () => {
    setupPage()
    await snapdom.toRaw(document.body, { cache: 'disabled' })
  }, benchOpts)

  bench("clip: 'viewport' (toRaw)", async () => {
    setupPage()
    await snapdom.toRaw(document.body, { cache: 'disabled', clip: 'viewport' })
  }, benchOpts)

  bench('full page (toCanvas)', async () => {
    setupPage()
    await snapdom.toCanvas(document.body, { cache: 'disabled' })
  }, benchOpts)

  bench("clip: 'viewport' (toCanvas)", async () => {
    setupPage()
    await snapdom.toCanvas(document.body, { cache: 'disabled', clip: 'viewport' })
  }, benchOpts)
})
