// #520: flex items with min-width:auto stop shrinking at their content. When the flex
// container already overflows on the live page, the #406 `min-width:0` let the clone squeeze
// the items into the box. The floor is pinned to the live used width only in that case.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

function svgOf(raw) {
  return decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}
function ruleForNth(svg, cls, n) {
  const css = (svg.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const rules = {}
  css.replace(/\.(c\d+)\s*\{([^}]*)\}/g, (_, k, b) => { rules[k] = b; return _ })
  const tags = [...svg.matchAll(new RegExp(`<span\\b[^>]*class="([^"]*\\b${cls}\\b[^"]*)"`, 'g'))]
  const list = ((tags[n] || [])[1] || '').split(/\s+/)
  return list.map(c => rules[c] || '').join(';')
}
function minWidthOf(rule) {
  const m = rule.match(/(?:^|;)\s*min-width:\s*([\d.]+)px/)
  return m ? parseFloat(m[1]) : null
}

describe('#520 overflowing flex items keep their live width', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host)
    style = document.createElement('style'); document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  it('pins min-width to the live width when the flex container overflows', async () => {
    style.textContent = '.t520{display:flex;width:10em;font:16px monospace}.t520 span{border:1px solid}'
    host.innerHTML = '<div class="t520">' + Array.from({ length: 10 }, (_, i) => `<span class="it">${i}</span>`).join('') +
      '<span class="it">012345678901234567890123456789</span></div>'
    const root = host.querySelector('.t520')
    expect(root.scrollWidth).toBeGreaterThan(root.clientWidth)
    const items = [...root.children]
    const svg = svgOf(await snapdom.toRaw(root))
    items.forEach((el, i) => {
      const live = parseFloat(getComputedStyle(el).width)
      const mw = minWidthOf(ruleForNth(svg, 'it', i))
      expect(mw).not.toBeNull()
      expect(Math.abs(mw - live)).toBeLessThan(0.01)
    })
  })

  it('keeps flex items shrinkable (no numeric floor) when the container does not overflow', async () => {
    style.textContent = '.f520{display:flex;width:40em;font:16px monospace}'
    host.innerHTML = '<div class="f520"><span class="it">a</span><span class="it">b</span></div>'
    const root = host.querySelector('.f520')
    const svg = svgOf(await snapdom.toRaw(root))
    for (let i = 0; i < 2; i++) {
      const mw = minWidthOf(ruleForNth(svg, 'it', i))
      expect(mw === null || mw === 0).toBe(true)
    }
  })
})
