import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { shadowTreeScenario } from '../docs/compare/live/harness.js'

// The ::after bullet of the shadow scene is coloured by depth: rgb(80,0,0), rgb(160,0,0), rgb(240,0,0).
// A pseudo share across shadow roots paints every bullet with the first root's colour.
const count = async (opts, pick = (r) => r) => {
  const { root, cleanup } = shadowTreeScenario()
  try {
    const canvas = await (await snapdom(pick(root), { burst: false, ...opts })).toCanvas()
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const n = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > 12 || d[i + 2] > 12 || d[i + 3] < 250) continue
      if (d[i] > 70 && d[i] < 90) n[0]++
      else if (d[i] > 150 && d[i] < 170) n[1]++
      else if (d[i] > 230) n[2]++
    }
    return n
  } finally { cleanup() }
}

describe('control', () => {
  // Captured alone, a depth 2 host is the first of its kind read: its bullet and its child's must register.
  it('a depth 2 host alone paints depth 2', async () => {
    const n = await count({}, (r) => r.firstElementChild.firstElementChild)
    console.log('control pixels by depth', JSON.stringify(n))
    expect(n[1]).toBeGreaterThan(0)
  })
})

describe('shadow scene bullets keep their per-depth colour', () => {
  it('paints all three depths', async () => {
    const n = await count({})
    console.log('bullet pixels by depth', JSON.stringify(n))
    expect(n[0]).toBeGreaterThan(0)
    expect(n[1]).toBeGreaterThan(0)
    expect(n[2]).toBeGreaterThan(0)
  })
})

// Roots that hold the same CSS text share reads between them (and inside one root). These are
// the ways two nodes of one identity can still differ there.
describe('shadow content shares only what cannot differ', () => {
  let stage
  const hosts = (css, inner, n = 2, hostStyle = '') => {
    stage = document.createElement('div')
    stage.style.cssText = 'position:absolute;left:0;top:0;display:grid;grid-template-columns:100px 300px;align-items:start;background:#fff'
    for (let i = 0; i < n; i++) {
      const host = document.createElement('div')
      if (hostStyle) host.style.cssText = hostStyle
      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML = `<style>${css}</style>${inner}`
      stage.appendChild(host)
    }
    document.body.appendChild(stage)
    return stage
  }
  const pixels = async (el) => {
    const canvas = await (await snapdom(el, { burst: false, scale: 1, dpr: 1 })).toCanvas()
    const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    return (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)).join(',')
  }
  const BOX = '.b{height:20px;background:rgb(0,0,255)}'
  afterEach(() => stage?.remove())

  it('a structural rule in the shadow sheet', async () => {
    const at = await pixels(hosts(BOX + '.b:nth-child(odd){background:rgb(255,0,0)}', '<div class="b"></div><div class="b"></div><div class="b"></div>'))
    // Children 2, 3, 4 of the root (the <style> is the first): blue, red, blue.
    expect([at(10, 10), at(10, 30), at(10, 50)]).toEqual(['0,0,255', '255,0,0', '0,0,255'])
    expect([at(110, 10), at(110, 30), at(110, 50)]).toEqual(['0,0,255', '255,0,0', '0,0,255'])
  })

  it('a percentage padding under hosts of two widths', async () => {
    const at = await pixels(hosts('.p{padding-left:10%;background:rgb(0,0,255)}.i{height:20px;background:rgb(255,0,0)}', '<div class="p"><div class="i"></div></div>'))
    // 10% of 100px, then 10% of 300px.
    expect([at(5, 10), at(15, 10)]).toEqual(['0,0,255', '255,0,0'])
    expect([at(100 + 25, 10), at(100 + 35, 10)]).toEqual(['0,0,255', '255,0,0'])
  })

  it('a focused node inside one of the roots', async () => {
    const el = hosts(BOX + '.b:focus{background:rgb(255,0,0);outline:none}', '<div class="b" tabindex="0"></div>')
    el.lastElementChild.shadowRoot.querySelector('.b').focus()
    const at = await pixels(el)
    expect([at(10, 10), at(110, 10)]).toEqual(['0,0,255', '255,0,0'])
  })

  it('control: two plain roots of one group paint alike', async () => {
    const at = await pixels(hosts(BOX, '<div class="b"></div>'))
    expect([at(10, 10), at(110, 10)]).toEqual(['0,0,255', '0,0,255'])
  })
})
