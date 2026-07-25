import { describe, it, expect, afterEach } from 'vitest'
import { computePropertyUniverse, ALWAYS_PROPS } from '../src/modules/styleScan.js'
import { snapdom } from '../src/api/snapdom.js'

describe('computePropertyUniverse', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  it('includes the always-list and props from style rules, nested at-rules and keyframes', () => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = `
      .zz-a { column-count: 2; }
      @media (min-width: 1px) { .zz-b { caret-color: red; } }
      @keyframes zz-k { from { stroke-dashoffset: 10px; } }
    `
    document.head.appendChild(style)
    const u = computePropertyUniverse(document)
    expect(u).not.toBeNull()
    expect(u.has('display')).toBe(true) // ALWAYS
    expect(u.has('column-count')).toBe(true) // plain rule
    expect(u.has('caret-color')).toBe(true) // nested @media
    expect(u.has('stroke-dashoffset')).toBe(true) // @keyframes
    for (const p of ALWAYS_PROPS) expect(u.has(p)).toBe(true)
  })

  it('includes WAAPI keyframe props (kebab-cased)', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const anim = el.animate([{ columnRuleColor: 'red' }, { columnRuleColor: 'blue' }], { duration: 60000 })
    try {
      const u = computePropertyUniverse(document)
      expect(u).not.toBeNull()
      expect(u.has('column-rule-color')).toBe(true)
    } finally {
      anim.cancel()
    }
  })
})

describe('pruned snapshots keep fidelity', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  it('captures a rule-set property outside the always-list', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = '.zz-cols { column-count: 3; width: 200px; }'
    document.head.appendChild(style)
    const el = document.createElement('div')
    el.className = 'zz-cols'
    el.textContent = 'a b c d e f g h i j k l m n o p q r s t'
    document.body.appendChild(el)

    const res = await snapdom(el, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('column-count')
  })

  it('captures an inline-style property no stylesheet mentions', async () => {
    const el = document.createElement('div')
    el.style.columnCount = '2'
    el.style.width = '200px'
    el.textContent = 'uno dos tres cuatro cinco seis siete ocho'
    document.body.appendChild(el)

    const res = await snapdom(el, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('column-count')
  })
})
