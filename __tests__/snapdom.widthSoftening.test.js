// Width handling in getStyleKey. snapdom never freezes a content/algorithm width as a hard
// `width` (it wraps text / pins tables in the raster, #429). But it must not collapse boxes
// whose size comes from a CSS *class* rather than text content. The fixes verified here:
//
//  - #433: an inline-block <span> sized by a class (no text) kept its size via the logical
//          `inline-size` in 2.12.2; the #429 fix added `inline-size` to the strip list, so the
//          span (and ExtJS button-icon spans carrying a background-image) collapsed to 0 width.
//          A `min-width` floor restores the size.
//  - #436: a replaced inline <img> honors an explicit width; it must keep it (not be softened),
//          otherwise an object-fit image renders empty.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

function svgOf(raw) {
  return decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}
function classRules(svg) {
  const css = (svg.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const rules = {}
  css.replace(/\.(c\d+)\s*\{([^}]*)\}/g, (_, n, b) => { rules[n] = b; return _ })
  return rules
}
function ruleFor(svg, el) {
  const rules = classRules(svg)
  const m = svg.match(new RegExp(`<${el.tagName.toLowerCase()}\\b[^>]*class="([^"]*)"[^>]*>`))
  const cls = (m || [])[1] || ''
  return cls.split(/\s+/).filter(Boolean).map(c => rules[c] || '').join(';')
}

describe('#433 inline-block span sized by a class keeps its width', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host)
    style = document.createElement('style')
    style.textContent = '.box{display:inline-block;width:20px;height:20px;background:red}'
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('keeps the width on an empty class-sized span so it does not collapse', async () => {
    host.innerHTML = '<span class="box"></span>'
    const span = host.querySelector('.box')
    const svg = svgOf(await snapdom.toRaw(span))
    const rule = ruleFor(svg, span)
    // empty box is sized by the class, not content → width is kept verbatim
    expect(rule).toMatch(/(?:^|;)\s*width:\s*20px/)
  })

  it('keeps a background-image icon span visible (ExtJS button-icon case)', async () => {
    style.textContent += '.icon{display:inline-block;width:16px;height:16px;' +
      'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E")}'
    host.innerHTML = '<span class="icon"></span>'
    const icon = host.querySelector('.icon')
    const svg = svgOf(await snapdom.toRaw(icon))
    const rule = ruleFor(svg, icon)
    expect(rule).toMatch(/(?:^|;)\s*width:\s*16px/)
    expect(rule).toMatch(/background-image/)
  })

  it('softens width on a class-sized span that DOES have text content', async () => {
    style.textContent += '.tag{display:inline-block;width:200px;height:20px}'
    host.innerHTML = '<span class="tag">a label that is wider in the raster font</span>'
    const span = host.querySelector('.tag')
    const svg = svgOf(await snapdom.toRaw(span))
    const rule = ruleFor(svg, span)
    // content-sized → no hard width (would wrap), but a min-width floor keeps the size
    expect(/(?:^|;)\s*width:\s*200px/.test(rule)).toBe(false)
    expect(rule).toMatch(/min-width:\s*200px/)
  })
})

// #406 — flex/grid items get min-width:0 (styles.js) so they can shrink. The width-softening
// must not clobber that, and must not collapse an empty flex item sized by a class.
describe('#406 min-width:0 on flex items survives width softening', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div'); host.style.display = 'flex'; document.body.appendChild(host)
    style = document.createElement('style')
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('keeps width on an empty flex-item box so it does not collapse', async () => {
    style.textContent = '.fbox{width:40px;height:20px;background:teal}'
    host.innerHTML = '<span class="fbox"></span>'
    const box = host.querySelector('.fbox')
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = ruleFor(svg, box)
    expect(rule).toMatch(/(?:^|;)\s*width:\s*40px/) // empty box keeps its size
  })

  it('does NOT add a min-width floor to a flex-item span with text (stays shrinkable)', async () => {
    style.textContent = '.ftext{height:20px}'
    host.innerHTML = '<span class="ftext">some shrinkable flex text content</span>'
    const span = host.querySelector('.ftext')
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = ruleFor(svg, span)
    // a flex item must keep its natural ability to shrink — no synthesized numeric min-width floor
    expect(/(?:min-width|min-inline-size):\s*\d/.test(rule)).toBe(false)
    // and the content width is not frozen as a hard width either
    expect(/(?:^|;)\s*(?:width|inline-size):\s*\d/.test(rule)).toBe(false)
  })
})

// #454 — a span whose only content is out-of-flow (abspos svg) is sized by CSS, not content.
// KaTeX's `.hide-tail` (width:100%, authored min-width, position:absolute svg inside) lost its
// width: softening dropped it and the authored min-width suppressed the floor, so the sqrt
// tail collapsed to min-width and overlapped the radicand.
describe('#454 span with only out-of-flow content keeps its width', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host)
    style = document.createElement('style')
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('keeps the width when the only child is position:absolute (KaTeX hide-tail)', async () => {
    style.textContent = `
      .ktx-box { display:inline-block; width:60px; height:20px; position:relative }
      .ktx-tail { display:inline-block; width:100%; height:100%; position:relative; overflow:hidden }
      .ktx-tail svg { display:block; position:absolute; width:100%; height:100% }`
    host.innerHTML = '<span class="ktx-box"><span class="ktx-tail" style="min-width:11px">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400000 1296" preserveAspectRatio="xMinYMin slice"><rect width="400000" height="1296"/></svg>' +
      '</span></span>'
    const svg = svgOf(await snapdom.toRaw(host.querySelector('.ktx-box')))
    const rules = classRules(svg)
    const m = svg.match(/<span[^>]*class="([^"]*ktx-tail[^"]*)"/)
    const rule = ((m || [])[1] || '').split(/\s+/).map(c => rules[c] || '').join(';')
    // not sized by content (abspos child) → the 100%-resolved width is kept verbatim
    expect(rule).toMatch(/(?:^|;)\s*width:\s*60px/)
  })

  it('still softens when there is in-flow content next to an abspos child', async () => {
    style.textContent = `
      .mix { display:inline-block; width:200px }
      .mix i { position:absolute }`
    host.innerHTML = '<span class="mix">label text<i>x</i></span>'
    const span = host.querySelector('.mix')
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = ruleFor(svg, span)
    expect(/(?:^|;)\s*width:\s*200px/.test(rule)).toBe(false)
    expect(rule).toMatch(/min-width:\s*200px/)
  })
})

describe('#436 replaced inline <img> keeps its explicit width', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not soften width on an inline img with object-fit', async () => {
    // 1x1 transparent png
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
    host.innerHTML = `<div style="width:200px;height:200px"><img style="width:100%;height:100%;object-fit:cover" src="${src}"></div>`
    const img = host.querySelector('img')
    await img.decode().catch(() => {})
    const svg = svgOf(await snapdom.toRaw(host.querySelector('div')))
    const rule = ruleFor(svg, img)
    // img is replaced → width is kept hard (200px = 100% of the 200px box), not turned into min-width
    expect(rule).toMatch(/(?:^|;)\s*width:\s*200px/)
  })
})
