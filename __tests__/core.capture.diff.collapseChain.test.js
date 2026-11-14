// The differential recapture against #426: the full pipeline zeroes, in the clone, every
// margin that collapses through the capture root's top or bottom edge. A rebuilt subtree
// carries no such zero, and a retained one keeps its old zero, so the diff may serve a
// frame only when that set of zeroes cannot have moved. Each case compares the pixels of
// the burst frame with a `{ burst: false }` capture of the same DOM state and pins whether
// the differential path served it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

const OPTS = { burst: true, dpr: 1, scale: 1, embedFonts: false, compress: false }

afterEach(() => { document.body.innerHTML = '' })
beforeEach(() => { __diffStats.attempts = 0; __diffStats.served = 0; __diffStats.reconciled = 0 })

/** Builds `<div root>` from an HTML string; `[data-k]` elements come back by key. */
function mount(rootCss, html) {
  const root = document.createElement('div')
  root.style.cssText = `width:240px;background:#fff;font:14px/20px Arial,sans-serif;${rootCss}`
  root.innerHTML = html
  document.body.appendChild(root)
  const k = {}
  for (const el of root.querySelectorAll('[data-k]')) k[el.dataset.k] = el
  return { root, k }
}

async function pixels(result) {
  const canvas = await result.toCanvas({ dpr: 1, scale: 1 })
  return {
    width: canvas.width,
    height: canvas.height,
    data: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data,
  }
}

/** Primes burst, mutates, captures through burst and through the full pipeline; returns
 *  whether the diff served and how many pixels differ. */
async function frame(root, mutate) {
  for (let i = 0; i < 3; i++) await snapdom(root, OPTS)
  const served = __diffStats.served
  const attempts = __diffStats.attempts
  const reconciled = __diffStats.reconciled
  mutate()
  await new Promise((r) => setTimeout(r, 0))
  const actual = await snapdom(root, OPTS)
  const diffServed = __diffStats.served - served
  const diffAttempted = __diffStats.attempts - attempts
  const diffReconciled = __diffStats.reconciled - reconciled
  const oracle = await snapdom(root, { ...OPTS, burst: false })
  const a = await pixels(actual)
  const b = await pixels(oracle)
  let differing = 0
  if (a.width === b.width && a.height === b.height) {
    for (let i = 0; i < a.data.length; i += 4) {
      if (Math.abs(a.data[i] - b.data[i]) > 8 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 ||
          Math.abs(a.data[i + 2] - b.data[i + 2]) > 8 || Math.abs(a.data[i + 3] - b.data[i + 3]) > 8) differing++
    }
  } else differing = -1
  return { served: diffServed, attempted: diffAttempted, reconciled: diffReconciled, differing, size: [a.width, a.height, b.width, b.height] }
}

const BAR = 'height:10px;'

describe('diff vs the root margin-collapse chain (#426)', () => {
  it('a node entering the flow ahead of a zeroed margin (top edge, depth 2) bails', async () => {
    const { root, k } = mount('', `<div data-k="a">
      <div data-k="p" style="position:absolute;${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a node entering the flow after a zeroed margin (bottom edge) bails', async () => {
    const { root, k } = mount('', `<div style="${BAR}background:#0a0"></div><div data-k="a">
      <div style="${BAR}margin-bottom:20px;background:#00c"></div>
      <div data-k="p" style="position:absolute;${BAR}width:60px;margin-bottom:12px;background:#d00"></div></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a node entering the flow on a chain three levels deep bails', async () => {
    const { root, k } = mount('', `<div><div><div>
      <div data-k="p" style="position:absolute;${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div></div></div></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a chain node whose own margin changes is rebuilt with its zero, served', async () => {
    const { root, k } = mount('', `<div><div data-k="b" style="${BAR}margin-top:20px;background:#00c"></div>
      <div style="${BAR}background:#0a0"></div></div>`)
    const r = await frame(root, () => { k.b.style.marginTop = '30px' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  // The usual shape: the first and last paragraphs of an unpadded root are both zeroed.
  it('a text edit in the first paragraph of an unpadded root keeps both zeroes, served', async () => {
    const { root, k } = mount('', '<section><p data-k="p" style="background:#fc9">Alpha</p></section>')
    const r = await frame(root, () => { k.p.textContent = 'Updated' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  it('a margin appearing on a chain node bails', async () => {
    const { root, k } = mount('', `<div><div data-k="b" style="${BAR}background:#00c"></div>
      <div style="${BAR}background:#0a0"></div></div>`)
    const r = await frame(root, () => { k.b.style.marginTop = '20px' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a zeroed node leaving the flow bails', async () => {
    const { root, k } = mount('', `<div>
      <div data-k="p" style="${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div></div>`)
    const r = await frame(root, () => { k.p.style.position = 'absolute' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a sibling turning inline ends the bottom chain above a zeroed margin and bails', async () => {
    const { root, k } = mount('', `<div style="${BAR}background:#0a0"></div><div>
      <div style="${BAR}margin-bottom:20px;background:#00c"></div>
      <span data-k="p" style="position:absolute;background:#d00">x</span></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  // The reconcile pass re-inlines a box whose geometry drifted, and an authored inline
  // style with a context-dependent value (here `auto`) is rewritten from the computed one,
  // margin included. A zeroed chain node that grows must keep its zero.
  it('a zeroed chain node reflowed by a deeper edit keeps its zero, served', async () => {
    const { root, k } = mount('', `<div><div style="margin:20px auto 0;width:200px;background:#00c;color:#fff">
      <div data-k="d">one</div></div><div style="${BAR}background:#0a0"></div></div>`)
    const r = await frame(root, () => { k.d.innerHTML = 'one<br>two<br>three' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  it('an edit off the chain under an open edge is served', async () => {
    const { root, k } = mount('', `<div><div style="${BAR}margin-top:20px;background:#00c"></div>
      <div data-k="d" style="color:#000">before</div>
      <div style="${BAR}margin-bottom:20px;background:#0a0"></div></div>`)
    const r = await frame(root, () => { k.d.textContent = 'after, longer' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })
})

describe('diff on direct children of the capture root', () => {
  it('an absolutely positioned direct child is served', async () => {
    const { root, k } = mount('position:relative', `<div data-k="m" style="position:absolute;left:0;top:0;width:16px;height:16px;background:#d00"></div>
      <span data-k="l" style="position:absolute;left:24px;top:0;font:12px/16px Arial">Capture 1</span>
      <div style="${BAR}margin-top:20px;background:#00c"></div>`)
    const r = await frame(root, () => { k.m.style.backgroundColor = '#0a0'; k.l.textContent = 'Capture 2' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  it('the first in-flow direct child under an open edge bails', async () => {
    const { root, k } = mount('', `<div data-k="b" style="margin-top:20px;background:#00c;color:#fff">before</div>
      <div style="${BAR}background:#0a0"></div>`)
    const r = await frame(root, () => { k.b.textContent = 'after' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('an in-flow direct child bails even under a padded root', async () => {
    const { root, k } = mount('padding:8px 0', `<div data-k="b" style="margin-top:20px;background:#00c;color:#fff">before</div>
      <div style="${BAR}margin-bottom:20px;background:#0a0"></div>`)
    const r = await frame(root, () => { k.b.textContent = 'after' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  // The root shrinks to fit, so the direct child that widens it moves the centred sibling,
  // whose own width never changes and which the reconcile therefore never re-reads.
  it('an in-flow direct child that resizes a shrink-to-fit root bails', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'display:inline-block;background:#fff;padding:4px'
    root.innerHTML = '<div data-k="a" style="width:100px;height:20px;background:#0a0"></div><div style="width:60px;height:20px;margin:0 auto;background:#00c"></div>'
    document.body.appendChild(root)
    const r = await frame(root, () => { root.firstElementChild.style.width = '300px' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a direct child entering the flow ahead of a zeroed margin bails', async () => {
    const { root, k } = mount('height:80px', `<div data-k="p" style="position:absolute;${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a direct child entering the flow bails even under a padded root', async () => {
    const { root, k } = mount('padding:6px 0', `<div data-k="p" style="position:absolute;${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div>`)
    const r = await frame(root, () => { k.p.style.position = 'static' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  it('a zeroed direct child leaving the flow bails', async () => {
    const { root, k } = mount('height:80px', `<div data-k="p" style="${BAR}width:60px;margin-top:12px;background:#d00"></div>
      <div style="${BAR}margin-top:20px;background:#00c"></div>`)
    const r = await frame(root, () => { k.p.style.position = 'absolute' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })
})

describe('diff when the retained frame cannot be patched', () => {
  // Re-read when its size changes, a root whose inline style holds a context-dependent
  // value gets back the margin prepareClone took off it.
  it('a root whose inline style the re-read would rewrite bails', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'margin:1em 0;padding:1px 0;width:200px;background:#fff;font:14px/20px Arial,sans-serif'
    root.innerHTML = '<div style="background:#00c;color:#fff"><span data-k="g">one</span></div>'
    document.body.appendChild(root)
    const r = await frame(root, () => { root.querySelector('[data-k]').innerHTML = 'one<br>two' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(0)
  })

  // The sibling narrows the container, the query starts to match, and the box it restyles
  // has no record of its own and no geometry that moved.
  it('a document with a container query bails', async () => {
    const sheet = document.createElement('style')
    sheet.textContent = '.cq-row{display:flex;height:40px}.cq-sib{flex:none;width:100px;background:#0a0}' +
      '.cq-cont{flex:1 1 0;min-width:0;container-type:inline-size;height:40px}.cq-w{width:150px}' +
      '.cq-s{width:120px;height:20px;background:#00f}@container (max-width:200px){.cq-s{background:#f00}}'
    document.head.appendChild(sheet)
    try {
      const root = document.createElement('div')
      root.style.cssText = 'width:400px;background:#fff'
      root.innerHTML = '<div class="cq-row"><div class="cq-sib"></div><div class="cq-cont"><div class="cq-w"><div class="cq-s"></div></div></div></div>'
      document.body.appendChild(root)
      const r = await frame(root, () => { root.querySelector('.cq-sib').style.width = '250px' })
      expect(getComputedStyle(root.querySelector('.cq-s')).backgroundColor).toBe('rgb(255, 0, 0)')
      expect(r.differing).toBe(0)
      expect(r.served).toBe(0)
    } finally {
      sheet.remove()
    }
  })
})

describe('diff reconcile on softened boxes', () => {
  // Every engine reports `auto` as "0px" on a table part, and the key froze its used width
  // as a min-width floor: compared as written, every row and cell drifted on every frame,
  // for a floor that does not apply to them.
  it('an edit that moves no box re-reads none of a table, served', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      `<tr><td style="border:1px solid #888;padding:2px 4px">#${i}</td><td style="border:1px solid #888;padding:2px 4px;background:#cde"><span${i === 2 ? ' data-k="s"' : ''}>v${i}</span></td></tr>`).join('')
    const { root, k } = mount('padding:4px', `<table style="border-collapse:collapse">${rows}</table>`)
    const r = await frame(root, () => { k.s.style.color = '#c00' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
    expect(r.reconciled).toBe(0)
  })

  // On a box that shrinks to fit the floor paints: a stale one keeps it at its old width.
  // These keep the comparison as written, and so are re-read on every frame.
  for (const [kind, css] of [['an inline-block', 'display:inline-block'], ['a float', 'float:left']]) {
    it(`a text edit that narrows ${kind} refreshes its floor, served`, async () => {
      const { root, k } = mount('height:60px', `<div><span style="${css};background:#fc9;padding:4px">
        <b data-k="s">a much longer value</b></span></div>`)
      const r = await frame(root, () => { k.s.textContent = 'v2' })
      expect(r.attempted).toBe(1)
      expect(r.differing).toBe(0)
      expect(r.served).toBe(1)
    })
  }

  // An absolutely positioned box is compared as written, so it is re-read on every frame.
  it('a text edit that narrows an absolutely positioned box refreshes its floor, served', async () => {
    const { root, k } = mount('position:relative;height:60px', `<span style="position:absolute;left:8px;top:8px;background:#fc9;padding:4px">
      <b data-k="s">a much longer value</b></span>`)
    const r = await frame(root, () => { k.s.textContent = 'v2' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  // An absolutely positioned box with no insets sits where the flow left it, and its key
  // freezes that place as `left`/`right`. Text growing before it moves it without changing
  // its size.
  it('text growing before an absolutely positioned box moves it, served', async () => {
    const { root, k } = mount('', '<div><span data-k="t">ab</span><span style="position:absolute;background:#e33">badge</span></div>')
    const r = await frame(root, () => { k.t.textContent = 'ab cd ef gh' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })

  // The key of a grid container freezes its used tracks, and only a re-read refreshes them.
  it('text arriving in an empty grid item moves the tracks of its container, served', async () => {
    const { root, k } = mount('', '<div><span style="display:grid;height:30px"><div data-k="t"></div><p style="margin:0;background:#fc9">alpha</p></span><p style="margin:0">after</p></div>')
    const r = await frame(root, () => { k.t.textContent = 'lorem ipsum dolor 85' })
    expect(r.attempted).toBe(1)
    expect(r.differing).toBe(0)
    expect(r.served).toBe(1)
  })
})
