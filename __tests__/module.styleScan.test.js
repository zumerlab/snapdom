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

  // The counter test reads the declaration list, where it used to ask the four named
  // properties of every rule. Each case is a way a rule can set a counter.
  it.each([
    ['counter-reset', '.zz-leak { counter-reset: n }'],
    ['counter-increment', '.zz-leak { counter-increment: n }'],
    ['counter-set', '.zz-leak { counter-set: n 2 }'],
    ['a counter() in content', '.zz-leak::before { content: counter(n) ". " }'],
    ['all, which Chromium lists unexpanded', '.zz-leak { all: inherit }'],
    ['a counter inside @media', '@media (min-width: 1px) { .zz-leak { counter-increment: n } }'],
  ])('flags a document whose rules count through %s', (_, css) => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = '.zz-plain { color: red; content: "x" }'
    document.head.appendChild(style)
    expect(scanAuthorStyles(document).leaksAcrossSubtrees).toBe(false)
    style.textContent += css
    expect(scanAuthorStyles(document).leaksAcrossSubtrees).toBe(true)
  })

  it('answers unreliable past the rule budget without walking a rule', () => {
    // Two icon-font sheets (30,753 top-level rules) made every scan of the d3 demo walk 20,000
    // rules before giving up. The top-level count alone already says so.
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = Array.from({ length: 20001 }, (_, i) => `.zz-b${i}{color:red}`).join('')
    document.head.appendChild(style)
    const original = CSSStyleDeclaration.prototype.getPropertyPriority
    let reads = 0
    CSSStyleDeclaration.prototype.getPropertyPriority = function (...args) { reads++; return original.apply(this, args) }
    try {
      expect(scanAuthorStyles(document).universe).toBeNull()
    } finally {
      CSSStyleDeclaration.prototype.getPropertyPriority = original
    }
    expect(reads).toBe(0)
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
      ::before { content: ''; }
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

  // Most CSS frameworks reset every ::before and ::after, Tailwind's preflight with
  // `border: 0 solid` too. Such a rule gives no pseudo content, yet it put every element of
  // the page through two probes.
  it.each([
    ['box-sizing', '*, ::before, ::after { box-sizing: border-box; }'],
    ["Tailwind 4's preflight", '*, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }'],
    ["Tailwind 3's preflight", "*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e5e7eb; } ::before, ::after { --tw-content: ''; }"],
  ])('leaves out a %s reset, which gives no pseudo content', (_, css) => {
    const gates = gatesWith(css)
    const div = document.createElement('div')
    expect(div.matches(gates.before)).toBe(false)
    expect(div.matches(gates.after)).toBe(false)
    expect(document.createElement('q').matches(gates.before)).toBe(true)
  })

  // Declarations inside a nested group rule, or after a nested rule, have no selector of
  // their own, so the pseudo rule around them gates.
  it.each([
    ['content', "content: ''"],
    ['all', 'all: unset'],
    ['an animation', 'animation: zz-spin 1s'],
    ['a transition', 'transition: opacity 1s'],
    ['content in a nested @media', "@media (min-width: 1px) { content: '' }"],
    ['content after a nested rule', "@media print { color: red } content: ''"],
  ])('keeps a ::before rule that sets %s, after the reset too', (_, decl) => {
    const gates = gatesWith(`*, ::before, ::after { box-sizing: border-box; border: 0 solid; } .zz-g::before { ${decl} }`)
    const el = document.createElement('div')
    el.className = 'zz-g'
    expect(el.matches(gates.before)).toBe(true)
    expect(document.createElement('div').matches(gates.before)).toBe(false)
  })

  it('captures ::before/::after content set in nested CSS', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = `
      .zz-na::before { color: rgb(1, 2, 3); @media (min-width: 1px) { content: "AAA" } }
      .zz-nb::after { @media (min-width: 1px) { content: "BBB" } }
      .zz-nc::before { @media print { color: black } content: "CCC" }
      .zz-nd::before { font-weight: 700; @supports (display: block) { content: "DDD" } }`
    document.head.appendChild(style)
    document.body.innerHTML = '<div id="zz-root"><div class="zz-na">a</div><div class="zz-nb">b</div><div class="zz-nc">c</div><div class="zz-nd">d</div></div>'
    const res = await snapdom(document.getElementById('zz-root'), { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    for (const text of ['AAA', 'BBB', 'CCC', 'DDD']) expect(svg).toContain(text)
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

describe('scroll gate', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  const gateWith = (css) => {
    const style = document.createElement('style')
    style.setAttribute('data-scan-test', '')
    style.textContent = css
    document.head.appendChild(style)
    return scanAuthorStyles(document).scrollGate
  }
  const el = (html) => {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host.firstElementChild
  }

  it('keeps the UA scrollers and the elements an overflow rule reaches, and nothing else', () => {
    const gate = gateWith('.zz-pane { overflow: auto } .zz-y { overflow-y: scroll } .zz-reset { all: inherit } .zz-color { color: red }')
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<dialog></dialog>', '<div popover></div>',
      '<div style="overflow-x: hidden"></div>', '<div style="all: inherit"></div>', '<div class="zz-pane"></div>',
      '<div class="zz-y"></div>', '<div class="zz-reset"></div>']) {
      expect(el(html).matches(gate), html).toBe(true)
    }
    for (const html of ['<div class="zz-color"></div>', '<p></p>', '<span style="color: red"></span>']) {
      expect(el(html).matches(gate), html).toBe(false)
    }
    const svg = el('<svg><foreignObject></foreignObject></svg>')
    expect(svg.matches(gate)).toBe(false) // an inline <svg> scrolls in no engine
    expect(svg.firstElementChild.matches(gate)).toBe(true) // foreignObject does in Chromium
  })

  it('resolves nesting, inside @media too, and keeps a pseudo rule\'s originating element', () => {
    const gate = gateWith('.zz-p { & .zz-c { overflow: hidden } } @media (min-width: 1px) { .zz-m { overflow: clip } } .zz-x::before { overflow: auto }')
    expect(el('<div class="zz-p"><div class="zz-c"></div></div>').firstElementChild.matches(gate)).toBe(true)
    expect(el('<div class="zz-m"></div>').matches(gate)).toBe(true)
    expect(el('<div class="zz-x"></div>').matches(gate)).toBe(true)
  })

  it('gives the gate up when an overflow declaration has no selector to match', () => {
    const sheets = ['@keyframes zz-k { to { overflow: hidden } }', '.zz-n { @media (min-width: 1px) { overflow: auto } }']
    // Firefox 141 has no @scope and drops the rule, which leaves nothing to give the gate up for.
    if (typeof CSSScopeRule !== 'undefined') sheets.push('@scope (.zz-s) { .zz-in { overflow: auto } }')
    for (const css of sheets) {
      document.head.querySelectorAll('style[data-scan-test]').forEach((s) => s.remove())
      expect(gateWith(css), css).toBe(null)
      // Only the gate: the rest of the scan stays usable.
      expect(scanAuthorStyles(document).universe, css).not.toBe(null)
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
      .md\:after\:h-0\.5::after { content: var(--tw-content); height: 2px; }
      .hover\:before\:x::before { content: ''; }
      .group-data-horizontal\/tabs\:after\:h-0\.5:after { content: var(--tw-content); height: 1px; }
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

// A linked sheet is serialized once per rule where sibling-index() can appear, and the same
// text decides whether its declarations are asked for a priority.
describe('priorities of a linked sheet', () => {
  it('finds !important declarations and leaves the others out', async () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = URL.createObjectURL(new Blob(['.sd-imp{outline-width:3px !important;outline-style:solid}.sd-plain{outline-offset:2px}'], { type: 'text/css' }))
    await new Promise(resolve => { link.onload = resolve; document.head.appendChild(link) })
    const { importantProps } = scanAuthorStyles(document)
    URL.revokeObjectURL(link.href)
    link.remove()
    expect(importantProps.has('outline-width')).toBe(true)
    expect(importantProps.has('outline-style')).toBe(false)
    expect(importantProps.has('outline-offset')).toBe(false)
  })
})
