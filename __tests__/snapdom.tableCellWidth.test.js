// #429 — table cells get their used width from the table layout algorithm. snapdom used to
// freeze that fractional used width (e.g. width:113.484px) as an explicit CSS width on each
// <td>, which pins the auto-sized cell; at dpr=2 / under different font metrics the content no
// longer fits the frozen width and the text wraps to a new line. The fix: don't emit a hard
// `width` (or `max-width`) on table cells. We DO emit a `min-width` floor so author/used widths
// don't collapse (#434); a floor lets the cell grow to fit a wider raster font without wrapping.
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
// A *hard* width caps the cell and re-causes the #429 wrap: `width`, `max-width`, and their
// logical twins `inline-size` / `max-inline-size`. `min-width` (a growable floor) is allowed.
const HARD_WIDTH = /(?:^|;)\s*(max-)?(width|inline-size)\s*:/

describe('#429 table cell width is not frozen', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not emit a hard width on auto-sized <td>', async () => {
    host.innerHTML = `
      <table><tbody>
        <tr><td>Case 1:</td><td>some longer cell content 2024-09-16</td></tr>
        <tr><td>Case 2:</td><td>another cell value here</td></tr>
      </tbody></table>`
    const raw = await snapdom.toRaw(host.querySelector('table'))
    const svg = svgOf(raw)
    const rules = classRules(svg)
    const tds = svg.match(/<td[^>]*>/g) || []
    expect(tds.length).toBe(4)
    for (const tag of tds) {
      // no hard width frozen inline on the tag
      const inline = (tag.match(/style="([^"]*)"/) || [])[1] || ''
      expect(HARD_WIDTH.test(inline)).toBe(false)
      // nor in the generated class
      const cls = (tag.match(/class="([^"]*)"/) || [])[1] || ''
      for (const c of cls.split(/\s+/).filter(Boolean)) {
        const body = rules[c] || ''
        expect(HARD_WIDTH.test(body)).toBe(false)
      }
    }
  })
})

// #434 — v2.12.8 stripped *all* width from the table box tree, so a table sized with CSS
// (`.table-row { width: 100% }`) and a cell sized by a class (`.label { width: 100px }`)
// collapsed to content width and the layout broke. A floor (`min-width`) preserves both.
describe('#434 explicit table / cell widths survive as a floor', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div')
    host.style.width = '600px'
    document.body.appendChild(host)
    style = document.createElement('style')
    style.textContent = '.t434{width:100%;border-collapse:collapse}.t434 .label{width:100px}.t434 td{border:1px solid #000}'
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('keeps the table width and the labelled cell width as min-width', async () => {
    host.innerHTML = `
      <table class="t434"><tbody>
        <tr><td class="label">note1:</td><td>test</td></tr>
      </tbody></table>`
    const table = host.querySelector('table')
    const label = host.querySelector('td.label')
    const raw = await snapdom.toRaw(table)
    const svg = svgOf(raw)
    const rules = classRules(svg)

    const bodyOf = (el) => {
      const tag = (svg.match(new RegExp(`<${el.tagName.toLowerCase()}[^>]*class="([^"]*)"[^>]*>`)) || [])[1] || ''
      return tag.split(/\s+/).filter(Boolean).map(c => rules[c] || '').join(';')
    }
    // table keeps its 600px (100% of the 600px host) as a floor, not as a hard cap
    expect(bodyOf(table)).toMatch(/min-width:\s*600px/)
    expect(HARD_WIDTH.test(bodyOf(table))).toBe(false)
    // the labelled cell keeps its 100px floor
    expect(bodyOf(label)).toMatch(/min-width:\s*100px/)
  })
})
