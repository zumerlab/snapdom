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

  it('geometry-changing mutations serve via diff too — reflowed neighbors get reconciled, byte-equal to full', async () => {
    const el = buildGrid()
    await engageBurst(el)

    // Adding a node grows the card and reflows the grid: the geometry-reconcile pass must
    // refresh drifted sibling boxes so the diff output still byte-matches a full capture.
    const card = el.querySelectorAll('h3')[2].parentElement
    const badge = document.createElement('span')
    badge.textContent = 'NEW-BADGE'
    badge.style.cssText = 'display:inline-block;background:lime;padding:2px 6px;font-size:11px'
    card.appendChild(badge)
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res1 = await snapdom(el)
    expect(__diffStats.served).toBe(served0 + 1)
    expect(decodeURIComponent(res1.url.split(',')[1])).toContain('NEW-BADGE')
    const full1 = await snapdom(el, { burst: false })
    expect(res1.url).toBe(full1.url)

    // Sequential diff on ANOTHER subtree stays consistent after the reconcile.
    el.querySelectorAll('p')[7].textContent = 'segunda'
    await new Promise((r) => setTimeout(r, 0))
    const res2 = await snapdom(el)
    const svg2 = decodeURIComponent(res2.url.split(',')[1])
    expect(svg2).toContain('NEW-BADGE')
    expect(svg2).toContain('segunda')

    const full2 = await snapdom(el, { burst: false })
    expect(res2.url).toBe(full2.url)
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

  // The frozen width in a style key is rounded UP to the next 1/16px (see getStyleKey), so
  // comparing it against a raw getComputedStyle value calls every fractional box "drifted".
  // A 3-column flex grid whose track width does not land on a whole pixel used to reconcile
  // 279 of 282 retained nodes on EVERY differential frame.
  it('a fractionally-sized layout does not reconcile every node on every frame', async () => {
    const host = document.createElement('div')
    // 640 - 2*10 gap = 620 / 3 = 206.666… — deliberately not 1/16-aligned
    host.style.cssText = 'width:640px;display:flex;gap:10px;font:13px Arial'
    for (let i = 0; i < 3; i++) {
      const col = document.createElement('div')
      col.style.cssText = 'flex:1;background:#eef'
      for (let r = 0; r < 12; r++) {
        const p = document.createElement('p')
        p.style.cssText = 'margin:2px;font:12px Arial'
        p.textContent = `fila ${r} col ${i}`
        col.appendChild(p)
      }
      host.appendChild(col)
    }
    document.body.appendChild(host)
    expect(getComputedStyle(host.children[0]).width).toContain('.') // precondition: fractional

    await engageBurst(host)
    host.querySelector('p').textContent = 'mutado'
    await new Promise((r) => setTimeout(r, 0))

    __diffStats.reconciled = 0
    const served0 = __diffStats.served
    await snapdom(host)
    expect(__diffStats.served).toBe(served0 + 1) // the diff path really ran
    expect(__diffStats.reconciled).toBe(0)       // …without declaring the whole tree drifted
  })

  // backdrop-filter is pre-composed by emulateBackdropFilters (the svg rasterizer cannot be
  // trusted with it, #457). A differential frame must not lose that composition. Metric:
  // sharp stripe transitions inside the frosted card — the blur erases them, so the
  // no-backdrop control reads 24 and the frosted one reads 0 on BOTH paths.
  it('a frosted card survives a differential frame', async () => {
    const build = (withBackdrop) => {
      const el = document.createElement('div')
      el.style.cssText = 'width:400px;padding:20px;font-family:Arial;' +
        'background:repeating-linear-gradient(90deg,#000 0 8px,#fff 8px 16px)'
      const inner = document.createElement('div')
      inner.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px'
      for (let i = 0; i < 4; i++) {
        const card = document.createElement('div')
        card.className = 'card' + i
        card.style.cssText = 'padding:10px;height:60px;background:rgba(255,255,255,0.2);' +
          (withBackdrop && i === 1 ? 'backdrop-filter:blur(8px);' : '')
        const h = document.createElement('h3')
        h.textContent = `Card ${i}`
        h.style.cssText = 'margin:0;font-size:14px'
        card.appendChild(h)
        inner.appendChild(card)
      }
      el.appendChild(inner)
      document.body.appendChild(el)
      return el
    }
    const edges = async (res, el) => {
      const c = await res.toCanvas()
      const rootR = el.getBoundingClientRect()
      const cardR = el.querySelector('.card1').getBoundingClientRect()
      const y = Math.round(cardR.top - rootR.top + cardR.height / 2)
      const x0 = Math.round(cardR.left - rootR.left) + 2
      const x1 = Math.round(cardR.right - rootR.left) - 2
      const row = c.getContext('2d').getImageData(0, y, c.width, 1).data
      let n = 0
      for (let x = x0 + 1; x < x1; x++) if (Math.abs(row[x * 4] - row[(x - 1) * 4]) > 120) n++
      return n
    }

    const OPTS = { dpr: 1, scale: 1 }
    const measured = {}
    for (const withBackdrop of [true, false]) {
      const el = build(withBackdrop)
      for (let i = 0; i < 4; i++) await snapdom(el, OPTS)
      const served0 = __diffStats.served
      el.querySelector('.card1 h3').textContent = 'CHANGED'
      await new Promise((r) => setTimeout(r, 0))
      const diffRes = await snapdom(el, OPTS)
      // The whole test is vacuous unless the fast path actually ran.
      expect(__diffStats.served).toBe(served0 + 1)
      measured[withBackdrop ? 'frosted' : 'plain'] = {
        diff: await edges(diffRes, el),
        full: await edges(await snapdom(el, { ...OPTS, burst: false }), el),
      }
      el.remove()
    }
    // The metric can tell the two apart: blur erases the stripes.
    expect(measured.plain.full).toBeGreaterThan(10)
    expect(measured.frosted.full).toBeLessThan(measured.plain.full)
    // …and the diff path agrees with the full pipeline in both cases.
    expect(measured.plain.diff).toBe(measured.plain.full)
    expect(measured.frosted.diff).toBe(measured.frosted.full)
  })

  // The fast path rebuilds ONE subtree, so any rule whose match depends on siblings or
  // descendants (+ ~ :has(), counters) can change styles OUTSIDE that subtree — the probe
  // that detects them scanned document.styleSheets but its adoptedStyleSheets arm had no
  // test, and that is where design systems keep their CSS.
  it('bails when a relational selector lives in an adopted stylesheet', async () => {
    const build = () => {
      const c = document.createElement('div')
      c.style.cssText = 'width:400px;font-family:Arial'
      for (let i = 0; i < 6; i++) {
        const card = document.createElement('div')
        card.className = 'zc'
        card.style.cssText = 'padding:6px;background:#eef'
        const h = document.createElement('h3')
        h.textContent = 'Card ' + i
        h.style.cssText = 'margin:0;font-size:13px'
        card.appendChild(h)
        c.appendChild(card)
      }
      document.body.appendChild(c)
      return c
    }
    const mutateAndCount = async (el, text) => {
      const before = __diffStats.served
      el.querySelectorAll('h3')[3].textContent = text
      await new Promise((r) => setTimeout(r, 0))
      await snapdom(el)
      return __diffStats.served - before
    }

    // Control: identical scene, no relational rule — proves the fast path IS reachable here,
    // so a 0 below means the guard fired and not that the scene simply never qualified.
    let el = build()
    await engageBurst(el)
    expect(await mutateAndCount(el, 'X')).toBe(1)
    el.remove()

    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.zc:has(h3) { outline: 1px solid transparent }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    try {
      el = build()
      await engageBurst(el)
      expect(await mutateAndCount(el, 'Y')).toBe(0)
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
      el.remove()
    }
  })
})
