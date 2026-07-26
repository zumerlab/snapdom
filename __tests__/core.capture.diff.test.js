// Differential recapture (burst v2): with auto/explicit burst engaged, a mutation scoped to
// a subtree rebuilds ONLY that subtree against the retained clone and re-serializes —
// pixel-identical to a full capture of the same DOM state, at a fraction of the cost.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

afterEach(() => { document.body.innerHTML = '' })

function buildGrid(cards = 24) {
  const container = document.createElement('div')
  container.style.cssText = 'width:800px;padding:20px;background:white;border:2px solid black;font-family:Arial;color:#333'
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px'
  for (let i = 0; i < cards; i++) {
    const card = document.createElement('div')
    card.style.cssText = `padding:10px;border-radius:8px;background:${i % 2 ? '#e0eaff' : '#f0f0f0'};box-shadow:0 2px 5px rgba(0,0,0,0.1)`
    const title = document.createElement('h3')
    title.textContent = `Card ${i}`
    title.style.cssText = 'margin:0 0 6px 0;font-size:14px'
    const text = document.createElement('p')
    text.textContent = 'Lorem ipsum dolor sit amet.'
    text.style.cssText = 'font-size:12px;margin:0'
    card.append(title, text)
    grid.appendChild(card)
  }
  container.appendChild(grid)
  document.body.appendChild(container)
  return container
}

async function engageBurst(el) {
  for (let i = 0; i < 3; i++) await snapdom(el)
  await snapdom(el) // memo hit — burst fully engaged with retained artifacts
}

describe('differential recapture', () => {
  beforeEach(() => { __diffStats.attempts = 0; __diffStats.served = 0 })

  it('serves a text mutation via the diff path, pixel-equal to a full capture', async () => {
    const el = buildGrid()
    await engageBurst(el)

    el.querySelectorAll('h3')[5].textContent = 'CHANGED 999'
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res = await snapdom(el)
    expect(__diffStats.served).toBe(served0 + 1)
    expect(decodeURIComponent(res.url.split(',')[1])).toContain('CHANGED 999')

    // Strongest possible fidelity assertion: the diff output is BYTE-IDENTICAL to a
    // fresh full-pipeline capture of the same DOM state.
    const full = await snapdom(el, { burst: false })
    expect(res.url).toBe(full.url)
  })

  it('geometry-changing mutations bail to full; box-stable ones keep the diff path, staying consistent', async () => {
    const el = buildGrid()
    await engageBurst(el)

    // Adding a node grows the card: geometry guard must route this to the FULL pipeline
    // (frozen sibling min-widths would otherwise go stale).
    const card = el.querySelectorAll('h3')[2].parentElement
    const badge = document.createElement('span')
    badge.textContent = 'NEW-BADGE'
    badge.style.cssText = 'display:inline-block;background:lime;padding:2px 6px;font-size:11px'
    card.appendChild(badge)
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res1 = await snapdom(el)
    expect(__diffStats.served).toBe(served0) // bailed on geometry drift
    expect(decodeURIComponent(res1.url.split(',')[1])).toContain('NEW-BADGE')

    // Box-stable text change AFTER the full re-retained: diff path serves again,
    // byte-identical to a fresh full capture (maps stayed consistent).
    el.querySelectorAll('p')[7].textContent = 'segunda'
    await new Promise((r) => setTimeout(r, 0))
    const res2 = await snapdom(el)
    expect(__diffStats.served).toBe(served0 + 1)
    const svg2 = decodeURIComponent(res2.url.split(',')[1])
    expect(svg2).toContain('NEW-BADGE')
    expect(svg2).toContain('segunda')

    const full = await snapdom(el, { burst: false })
    expect(res2.url).toBe(full.url)
  })

  it('bails to full (still correct) when the dirty subtree contains heavy content', async () => {
    const el = buildGrid(8)
    const card = el.querySelectorAll('h3')[1].parentElement
    const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svgIcon.setAttribute('width', '12')
    svgIcon.setAttribute('height', '12')
    svgIcon.innerHTML = '<rect width="12" height="12" fill="teal"/>'
    card.appendChild(svgIcon)
    await engageBurst(el)

    // Attribute mutation ON the card: the dirty root is the card itself, whose subtree
    // contains an <svg> (defs hoisting machinery) — the fast path must decline.
    card.style.background = 'gold'
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res = await snapdom(el)
    expect(__diffStats.served).toBe(served0) // bailed — no diff serve
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('rgb(255, 215, 0)')
  })
})
