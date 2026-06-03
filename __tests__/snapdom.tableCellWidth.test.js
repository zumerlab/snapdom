// #429 — table cells get their used width from the table layout algorithm. snapdom used to
// freeze that fractional used width (e.g. width:113.484px) as an explicit CSS width on each
// <td>, which pins the auto-sized cell; at dpr=2 / under different font metrics the content no
// longer fits the frozen width and the text wraps to a new line. The fix: don't emit width on
// auto-sized table cells, so the cloned table sizes them just like the live one.
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

describe('#429 table cell width is not frozen', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not emit an explicit width on auto-sized <td>', async () => {
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
      // no inline width frozen on the tag
      const inline = (tag.match(/style="([^"]*)"/) || [])[1] || ''
      expect(/(?:^|;)\s*(min-|max-)?(width|inline-size)\s*:/.test(inline)).toBe(false)
      // no width in the generated class either
      const cls = (tag.match(/class="([^"]*)"/) || [])[1] || ''
      for (const c of cls.split(/\s+/).filter(Boolean)) {
        const body = rules[c] || ''
        expect(/(?:^|;)\s*(min-|max-)?(width|inline-size)\s*:/.test(body)).toBe(false)
      }
    }
  })
})
