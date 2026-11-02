import { describe, it, expect, afterEach } from 'vitest'
import { scanAuthorStyles, ALWAYS_PROPS } from '../src/modules/styleScan.js'
import { rewriteShadowCSS } from '../src/utils/clone.helpers.js'
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
    expect(svg).toContain('rgb(200, 10, 10)')
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

// Tailwind serializes `md:after:h-0.5` as `.md\:after\:h-0\.5::after`: the escaped `\:after`
// inside the class name is not a pseudo-element (math280h/diagrams#146: one bad part in the
// joined SVG geometry gate threw per SVG element, and the pseudo gates fell to null).
describe('escaped pseudo tokens in class names', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  const scanWith = (css) => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = css
    document.head.appendChild(style)
    return scanAuthorStyles(document)
  }

  it('keeps the svg geometry gate and the pseudo gates usable', () => {
    const { svgGeometrySel, pseudoGates } = scanWith(String.raw`
      .md\:after\:h-0\.5::after { height: 2px; }
      .hover\:before\:x::before { content: ''; }
      .group-data-horizontal\/tabs\:after\:h-0\.5:after { height: 1px; }
      .dark\:first-letter\:big::first-letter { font-size: 2em; }
      circle { r: 5px; }
    `)
    document.body.innerHTML = '<svg><circle cx="5" cy="5"></circle><rect></rect></svg>'
    const circle = document.querySelector('circle')
    expect(typeof svgGeometrySel).toBe('string')
    expect(() => circle.matches(svgGeometrySel)).not.toThrow()
    expect(circle.matches(svgGeometrySel)).toBe(true)
    expect(document.querySelector('rect').matches(svgGeometrySel)).toBe(false)

    expect(typeof pseudoGates.after).toBe('string')
    expect(typeof pseudoGates.before).toBe('string')
    expect(typeof pseudoGates.firstLetter).toBe('string')
    const after = document.createElement('div')
    after.className = 'md:after:h-0.5'
    expect(after.matches(pseudoGates.after)).toBe(true)
    expect(after.matches(pseudoGates.before)).toBe(false)
    const legacy = document.createElement('div')
    legacy.className = 'group-data-horizontal/tabs:after:h-0.5'
    expect(legacy.matches(pseudoGates.after)).toBe(true)
    const before = document.createElement('div')
    before.className = 'hover:before:x'
    expect(before.matches(pseudoGates.before)).toBe(true)
    expect(before.matches(pseudoGates.after)).toBe(false)
    const letter = document.createElement('p')
    letter.className = 'dark:first-letter:big'
    expect(letter.matches(pseudoGates.firstLetter)).toBe(true)
  })

  it('still strips real pseudo-elements, double- and single-colon', () => {
    const { pseudoGates } = scanWith(`
      .zz-a::after { content: 'a'; }
      .zz-b:before { content: 'b'; }
      li::marker { color: red; }
      p::first-letter { color: blue; }
    `)
    for (const kind of ['after', 'before', 'marker', 'firstLetter']) {
      expect(typeof pseudoGates[kind]).toBe('string')
      expect(pseudoGates[kind]).not.toMatch(/:(?:before|after|marker|first-letter)/)
    }
    const a = document.createElement('div')
    a.className = 'zz-a'
    expect(a.matches(pseudoGates.after)).toBe(true)
    const b = document.createElement('div')
    b.className = 'zz-b'
    expect(b.matches(pseudoGates.before)).toBe(true)
    expect(document.createElement('li').matches(pseudoGates.marker)).toBe(true)
    expect(document.createElement('p').matches(pseudoGates.firstLetter)).toBe(true)
    expect(document.createElement('span').matches(pseudoGates.firstLetter)).toBe(false)
  })

  it('shadow scoping drops a trailing real pseudo rule and leaves an escaped class alone', () => {
    const scope = '[data-sd="s9"]'
    expect(rewriteShadowCSS('.k::after{color:red}', scope, 's9')).toContain(':not(*){')
    expect(rewriteShadowCSS('.k:after{color:red}', scope, 's9')).toContain(':not(*){')
    const kept = rewriteShadowCSS(String.raw`.md\:after{color:red}`, scope, 's9')
    expect(kept).not.toContain(':not(*)')
    expect(kept).toContain(String.raw`:where([data-sd="s9"] .md\:after:not([data-sd-slotted~="s9"])){`)
  })
})
