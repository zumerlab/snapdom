import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

const color = (i) => [(i * 37) % 256, (i * 91 + 40) % 256, (i * 53 + 90) % 256]

function scroller(style, count, itemStyle) {
  host = document.createElement('div')
  host.style.cssText = `${style};overflow:hidden;box-sizing:border-box;background:rgb(0,0,0)`
  host.innerHTML = Array.from({ length: count }, (_, i) =>
    `<div style="${itemStyle(i)};background:rgb(${color(i)})"></div>`).join('')
  document.body.appendChild(host)
  return host
}

// Every item whose center is visible must paint its own color at its live position.
async function expectItemsWhereThePageHasThem(root) {
  const canvas = await snapdom.toCanvas(root, { dpr: 1, embedFonts: false, burst: false })
  const ctx = canvas.getContext('2d')
  const box = root.getBoundingClientRect()
  let checked = 0
  for (const [i, item] of [...root.children].entries()) {
    const r = item.getBoundingClientRect()
    const x = Math.round(r.left - box.left + r.width / 2)
    const y = Math.round(r.top - box.top + r.height / 2)
    if (x < 0 || y < 0 || x >= box.width || y >= box.height) continue
    expect(Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3), `item ${i}`).toEqual(color(i))
    checked++
  }
  expect(checked).toBeGreaterThan(3)
}

describe('scrolled grid and flex containers keep their layout', () => {
  it('lays a scrolled auto-fill grid out in columns, scrolled', async () => {
    const root = scroller('width:600px;height:300px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;align-content:start;padding:24px', 30, () => 'height:100px')
    root.scrollTop = 60
    await expectItemsWhereThePageHasThem(root)
  })

  it('keeps grid placement on the items', async () => {
    const root = scroller('width:600px;height:300px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px', 14,
      (i) => i === 0 ? 'height:80px;grid-column:span 2' : 'height:80px')
    root.scrollTop = 50
    await expectItemsWhereThePageHasThem(root)
  })

  it('wraps a scrolled flex container the same way', async () => {
    const root = scroller('width:600px;height:300px;display:flex;flex-wrap:wrap;gap:10px;padding:20px', 20, () => 'width:120px;height:90px')
    root.scrollTop = 70
    await expectItemsWhereThePageHasThem(root)
  })

  it('scrolls a flex row horizontally', async () => {
    const root = scroller('width:400px;height:120px;display:flex;gap:8px;padding:10px;align-items:center', 12, () => 'flex:0 0 90px;height:60px')
    root.scrollLeft = 150
    await expectItemsWhereThePageHasThem(root)
  })
})
