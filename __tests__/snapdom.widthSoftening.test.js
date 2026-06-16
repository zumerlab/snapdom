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

  it('emits a min-width floor so the empty span does not collapse', async () => {
    host.innerHTML = '<span class="box"></span>'
    const span = host.querySelector('.box')
    const svg = svgOf(await snapdom.toRaw(span))
    const rule = ruleFor(svg, span)
    expect(rule).toMatch(/min-width:\s*20px/)
    // never a hard width that an author class width should not have been turned into either way
    expect(/(?:^|;)\s*width\s*:/.test(rule)).toBe(false)
  })

  it('keeps a background-image icon span visible (ExtJS button-icon case)', async () => {
    style.textContent += '.icon{display:inline-block;width:16px;height:16px;' +
      'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E")}'
    host.innerHTML = '<span class="icon"></span>'
    const icon = host.querySelector('.icon')
    const svg = svgOf(await snapdom.toRaw(icon))
    const rule = ruleFor(svg, icon)
    expect(rule).toMatch(/min-width:\s*16px/)
    expect(rule).toMatch(/background-image/)
  })
})

describe('#436 replaced inline <img> keeps its explicit width', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not soften width on an inline img with object-fit', async () => {
    // 1x1 transparent png
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    host.innerHTML = `<div style="width:200px;height:200px"><img style="width:100%;height:100%;object-fit:cover" src="${src}"></div>`
    const img = host.querySelector('img')
    await img.decode().catch(() => {})
    const svg = svgOf(await snapdom.toRaw(host.querySelector('div')))
    const rule = ruleFor(svg, img)
    // img is replaced → width is kept hard (200px = 100% of the 200px box), not turned into min-width
    expect(rule).toMatch(/(?:^|;)\s*width:\s*200px/)
  })
})
