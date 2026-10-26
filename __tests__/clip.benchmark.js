// `clip: 'viewport'` vs full-page capture on a long page.
// The claim under test: viewport capture must be FASTER than full page, because offscreen
// subtrees are pruned before styling/inlining and the raster area is viewport-sized.
// Run: `npm run test:benchmark` (or target this file).
// NOTE: burst:false pins these benches to the cold pipeline — the memo would
// otherwise memoize the repeated iterations and measure the cache hit instead.
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
    await snapdom.toRaw(document.body, { cache: 'disabled', burst: false })
  }, benchOpts)

  bench("clip: 'viewport' (toRaw)", async () => {
    setupPage()
    await snapdom.toRaw(document.body, { cache: 'disabled', burst: false, clip: 'viewport' })
  }, benchOpts)

  bench('full page (toCanvas)', async () => {
    setupPage()
    await snapdom.toCanvas(document.body, { cache: 'disabled', burst: false })
  }, benchOpts)

  bench("clip: 'viewport' (toCanvas)", async () => {
    setupPage()
    await snapdom.toCanvas(document.body, { cache: 'disabled', burst: false, clip: 'viewport' })
  }, benchOpts)
})

// #549: a 100x40 clip inside the middle one of 800 cards. From body, the culled cards fold
// into one spacer per run; from the card, nothing is culled. The two should stay close.
let cards
function setupCards() {
  page?.remove()
  if (cards && document.body.contains(cards)) return cards.children[400]
  cards = document.createElement('main')
  cards.innerHTML = Array.from({ length: 800 }, (_, i) =>
    `<section style="margin:8px;padding:8px;border:1px solid #ccc"><h2>Card ${i}</h2><p>Some text</p><ul><li>a</li><li>b</li></ul></section>`).join('')
  document.body.appendChild(cards)
  return cards.children[400]
}
function cardClip(card) {
  const r = card.getBoundingClientRect()
  return { x: r.left + scrollX + 10, y: r.top + scrollY + 10, width: 100, height: 40 }
}

describe('clip: a region inside one of 800 cards', () => {
  bench('from document.body (toRaw)', async () => {
    const card = setupCards()
    await snapdom.toRaw(document.body, { cache: 'disabled', burst: false, clip: cardClip(card) })
  }, benchOpts)

  bench('from the card (toRaw)', async () => {
    const card = setupCards()
    await snapdom.toRaw(card, { cache: 'disabled', burst: false, clip: cardClip(card) })
  }, benchOpts)
})
