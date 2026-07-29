import { describe, it, expect, afterEach } from 'vitest'
import { scanAuthorStyles, ALWAYS_PROPS } from '../src/modules/styleScan.js'
import { snapdom } from '../src/api/snapdom.js'

const computePropertyUniverse = (doc) => scanAuthorStyles(doc).universe

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

describe('pseudo selector gates', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  const gatesWith = (css) => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = css
    document.head.appendChild(style)
    return scanAuthorStyles(document).pseudoGates
  }

  it('collects plain, functional-pseudo and bare selectors without breaking on inner commas', () => {
    const gates = gatesWith(`
      .zz-x::before { content: 'a'; }
      :is(h1, h2)::after { content: 'b'; }
      ::before { box-sizing: border-box; }
    `)
    const x = document.createElement('div')
    x.className = 'zz-x'
    expect(x.matches(gates.before)).toBe(true) // plain selector collected
    expect(document.createElement('span').matches(gates.before)).toBe(true) // bare ::before → *
    const h2 = document.createElement('h2')
    expect(h2.matches(gates.after)).toBe(true) // :is(h1, h2) kept intact
    expect(document.createElement('p').matches(gates.after)).toBe(false)
  })

  it('always gates q in for before/after (UA open/close-quote has no author rule)', () => {
    const gates = gatesWith('.zz-none { color: red; }')
    expect(document.createElement('q').matches(gates.before)).toBe(true)
    expect(document.createElement('q').matches(gates.after)).toBe(true)
  })

  it('a pseudo rule added in the same tick as the capture is not dropped', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = '.zz-fresh::after { content: "!"; color: rgb(200, 10, 10); }'
    document.head.appendChild(style)
    const el = document.createElement('div')
    el.className = 'zz-fresh'
    el.textContent = 'hola'
    document.body.appendChild(el)
    // No await between injection and capture: the epoch flush must handle it.
    const res = await snapdom(el, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('data-snapdom-pseudo')
    expect(svg).toContain('!')
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
