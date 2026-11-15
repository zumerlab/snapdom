import { describe, it, expect } from 'vitest'
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
