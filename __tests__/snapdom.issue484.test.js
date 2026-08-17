// #484 — `<span>` with `display:block` and an authored width lost that width.
//
// Width softening (#429/#433/#434) drops the used width of content-bearing inline-sized tags and
// re-adds it as a `min-width` floor, so a wider raster font can grow the box instead of wrapping
// its text. That trick only reproduces the box when `width` is `auto` AND the box is shrink-to-fit:
//
//   - `span { display:block; width:16px }` in normal flow → `auto` STRETCHES to the container, and
//     a min-width floor cannot cap it, so the span rendered at 100% of its parent.
//   - the same span inside a flex container → flex/grid items get no floor at all (#406), so the
//     span collapsed to the width of its text.
//
// Both only showed up when the span had children/text (an empty one is not "sized by content").
// The fix keeps an author-specified width verbatim for those two shapes; auto widths keep
// softening (verified below), so #429/#434 and the grid "Timestamp demo" are untouched.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { prepareClone } from '../src/core/prepare.js'

const STYLES = `
  .i484 * { box-sizing: border-box }
  .i484 { width: 400px }
  .i484 .item { display: flex }
  .i484 .tag {
    display: block; width: 16px; height: 16px; font-size: 10px; line-height: 16px;
    color: #d95350; border: 1px solid #d95350; border-radius: 4px; text-align: center;
  }
  .i484 .autoblock { display: block }
  .i484 .grid { display: grid; grid-template-columns: max-content }
`

function svgOf(raw) {
  return decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}
function classRules(svg) {
  const css = (svg.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n')
  const rules = {}
  css.replace(/\.(c\d+)\s*\{([^}]*)\}/g, (_, n, b) => { rules[n] = b; return _ })
  return rules
}
/** Declarations of every generated class on the nth <span> of the serialized SVG. */
function spanRule(svg, nth) {
  const rules = classRules(svg)
  const matches = [...svg.matchAll(/<span[^>]*class="([^"]*)"[^>]*>/g)]
  const cls = (matches[nth] || [])[1] || ''
  return cls.split(/\s+/).filter(Boolean).map((c) => rules[c] || '').join(';')
}

/**
 * Mounts the clone offscreen with its generated CSS so its layout can be measured.
 * The mount goes in a SHADOW ROOT on purpose: cloned nodes keep their original class names, so
 * in the light DOM the fixture's own `.tag { width:16px }` rule would style them and the
 * measurement would pass no matter what snapdom emitted.
 */
async function mountClone(root) {
  const { clone, classCSS } = await prepareClone(root, { embedFonts: false })
  const host = document.createElement('div')
  host.dataset.testCloneHost = '1'
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${root.getBoundingClientRect().width}px`
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const styleEl = document.createElement('style')
  styleEl.textContent = classCSS || ''
  shadow.append(styleEl, clone)
  return shadow
}

describe('#484 span with display:block keeps its authored width', () => {
  let host, style
  beforeEach(() => {
    style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)
    host = document.createElement('div')
    host.className = 'i484'
    document.body.appendChild(host)
  })
  afterEach(() => {
    host.remove()
    style.remove()
    document.querySelectorAll('[data-test-clone-host]').forEach((n) => n.remove())
  })

  it('keeps width:16px on a blockified span in normal flow (case 1)', async () => {
    host.innerHTML = '<span class="tag">T</span>'
    const svg = svgOf(await snapdom.toRaw(host))
    expect(spanRule(svg, 0)).toMatch(/(?:^|;)\s*width:\s*16px/)
  })

  it('keeps width:16px on a blockified span inside a flex container (case 2)', async () => {
    host.innerHTML = '<div class="item"><span class="tag">T</span></div>'
    const svg = svgOf(await snapdom.toRaw(host))
    expect(spanRule(svg, 0)).toMatch(/(?:^|;)\s*width:\s*16px/)
  })

  it('renders both spans at the live width instead of 100% / shrink-to-fit', async () => {
    host.innerHTML = '<span class="tag">T</span><div class="item"><span class="tag">T</span></div>'
    const liveWidths = [...host.querySelectorAll('.tag')].map((el) => el.getBoundingClientRect().width)
    expect(liveWidths).toEqual([16, 16])

    const shadow = await mountClone(host)
    const cloneWidths = [...shadow.querySelectorAll('span')].map((el) => el.getBoundingClientRect().width)
    expect(cloneWidths.length).toBe(2)
    // pre-fix: 400px (stretched to the container) and ~8px (collapsed to the "T")
    for (const w of cloneWidths) expect(w).toBeCloseTo(16, 1)
  })

  it('still softens a blockified span whose width is auto (no hard width frozen)', async () => {
    host.innerHTML = '<span class="autoblock">a label that is wider in the raster font</span>'
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = spanRule(svg, 0)
    expect(/(?:^|;)\s*(?:width|inline-size):\s*\d/.test(rule)).toBe(false)
    expect(rule).toMatch(/min-width:\s*400px/)
  })

  it('still softens an auto-width grid item (the max-content "Timestamp" case)', async () => {
    host.innerHTML = '<div class="grid"><span>2024-09-16 timestamp</span></div>'
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = spanRule(svg, 0)
    // grid item sized by its text: no frozen width and no floor (#406) so it can grow in the raster
    expect(/(?:^|;)\s*(?:width|inline-size):\s*\d/.test(rule)).toBe(false)
    expect(/(?:min-width|min-inline-size):\s*\d/.test(rule)).toBe(false)
  })

  it('still softens an intrinsic width (max-content is content sizing, not an author width)', async () => {
    host.innerHTML = '<span style="display:block;width:max-content">2024-09-16 timestamp</span>'
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = spanRule(svg, 0)
    expect(/(?:^|;)\s*(?:width|inline-size):\s*\d/.test(rule)).toBe(false)
  })

  it('keeps an inline-styled width on a flex-item span', async () => {
    host.innerHTML = '<div class="item"><span style="display:block;width:24px">T</span></div>'
    const svg = svgOf(await snapdom.toRaw(host))
    expect(spanRule(svg, 0)).toMatch(/(?:^|;)\s*width:\s*24px/)
  })

  it('leaves real inline spans alone (width has no effect on them)', async () => {
    host.innerHTML = '<span style="width:16px">inline text</span>'
    const svg = svgOf(await snapdom.toRaw(host))
    const rule = spanRule(svg, 0)
    expect(/(?:^|;)\s*(?:width|inline-size):\s*\d/.test(rule)).toBe(false)
  })
})
