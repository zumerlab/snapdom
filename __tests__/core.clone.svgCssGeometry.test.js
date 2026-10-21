// #535: SVG shapes get no style snapshot (NO_DEFAULTS_TAGS, kept so LeaderLine's attributes
// are never overwritten by tag defaults, #201), and the clone pass copied only paint props.
// Geometry, transforms and vector-effect set by a stylesheet rule were lost: a circle sized
// with `circle { r: 20px }` vanished and a `vector-effect: non-scaling-stroke` line came out
// one viewBox unit thick.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { scanAuthorStyles } from '../src/modules/styleScan.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, css = '') {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  const root = document.createElement('div')
  root.style.cssText = 'width:400px;background:#fff;line-height:0'
  root.innerHTML = html
  document.body.appendChild(root)
  mounted.push(root, style)
  return root
}

const OPTS = { embedFonts: false, dpr: 1, scale: 1 }
const px = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data]
const isRed = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60 && p[3] > 200
const isWhite = (p) => p[0] > 230 && p[1] > 230 && p[2] > 230
const dark = (p) => p[3] > 200 && p[0] < 100

async function capture(root) {
  const canvas = await snapdom.toCanvas(root, OPTS)
  return canvas.getContext('2d', { willReadFrequently: true })
}

/** Rows of `x` where the pixel is dark, i.e. the thickness of a horizontal line there. */
function thickness(ctx, x, h) {
  let n = 0
  for (let y = 0; y < h; y++) if (dark(px(ctx, x, y))) n++
  return n
}

const supportsD = typeof CSS !== 'undefined' && CSS.supports('d', 'path("M0 0")')

describe('SVG geometry set by stylesheet rules (#535)', () => {
  it('the issue: CSS r and CSS vector-effect', async () => {
    const root = mount(`
      <svg width="400" height="100">
        <g class="css-r"><circle cx="50" cy="50" fill="red"/></g>
        <circle cx="150" cy="50" r="20" fill="red"/>
      </svg>
      <svg class="grid css-ve" viewBox="0 0 10 10" preserveAspectRatio="none" width="200" height="100"><path d="M0,5 L10,5"/></svg><svg class="grid" viewBox="0 0 10 10" preserveAspectRatio="none" width="200" height="100"><path d="M0,5 L10,5" vector-effect="non-scaling-stroke"/></svg>`,
    '.css-r circle { r: 20px } .css-ve path { vector-effect: non-scaling-stroke } svg.grid { stroke: black; stroke-width: 1px; fill: none }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 50, 50)), 'CSS-sized circle').toBe(true)
    expect(isRed(px(ctx, 65, 50))).toBe(true)
    expect(isRed(px(ctx, 150, 50)), 'attribute circle').toBe(true)
    const live = thickness(ctx, 300, 200)
    expect(thickness(ctx, 100, 200), 'CSS vector-effect line').toBeLessThanOrEqual(Math.max(2, live))
    expect(live).toBeLessThanOrEqual(2)
  })

  it('cx/cy, ellipse rx/ry and rect x/y/width/height from a rule', async () => {
    const root = mount(`<svg width="400" height="100">
        <circle class="c" r="10" fill="red"/>
        <ellipse class="e" cx="150" cy="50" fill="red"/>
        <rect class="r" fill="red"/>
      </svg>`,
    '.c { cx: 50px; cy: 50px } .e { rx: 30px; ry: 10px } .r { x: 250px; y: 20px; width: 100px; height: 60px }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 50, 50))).toBe(true)
    expect(isWhite(px(ctx, 5, 5)), 'circle not at the origin').toBe(true)
    expect(isRed(px(ctx, 175, 50))).toBe(true)
    expect(isRed(px(ctx, 340, 70))).toBe(true)
  })

  it('a rule overriding an attribute, including down to zero', async () => {
    const root = mount(`<svg width="400" height="100">
        <circle class="big" cx="50" cy="50" r="5" fill="red"/>
        <circle class="gone" cx="150" cy="50" r="30" fill="red"/>
      </svg>`,
    '.big { r: 30px } .gone { r: 0 }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 75, 50))).toBe(true)
    expect(isWhite(px(ctx, 150, 50))).toBe(true)
  })

  it('transform and translate from a rule, with the attribute transform as reference', async () => {
    const root = mount(`<svg width="400" height="100">
        <g class="moved"><rect width="20" height="20" fill="red"/></g>
        <rect class="shift" width="20" height="20" fill="red"/>
        <g transform="translate(300 40)"><rect width="20" height="20" fill="red"/></g>
      </svg>`,
    '.moved { transform: translate(100px, 40px) } .shift { translate: 200px 40px }')
    const ctx = await capture(root)
    expect(isWhite(px(ctx, 10, 10)), 'nothing left at the origin').toBe(true)
    expect(isRed(px(ctx, 110, 50))).toBe(true)
    expect(isRed(px(ctx, 210, 50))).toBe(true)
    expect(isRed(px(ctx, 310, 50))).toBe(true)
  })

  it('transform-box and transform-origin next to a rule transform', async () => {
    // A 60x20 bar rotated a quarter turn about its own center stands 20 wide and 60 tall.
    const root = mount('<svg width="400" height="100"><rect class="spin" x="100" y="20" width="60" height="20" fill="red"/></svg>',
      '.spin { transform: rotate(90deg); transform-box: fill-box; transform-origin: center }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 130, 5))).toBe(true)
    expect(isRed(px(ctx, 130, 55))).toBe(true)
    expect(isWhite(px(ctx, 105, 30))).toBe(true)
  })

  it('a WAAPI animation of r', async () => {
    const root = mount('<svg width="400" height="100"><circle cx="50" cy="50" r="2" fill="red"/></svg>')
    const anim = root.querySelector('circle').animate([{ r: '30px' }, { r: '30px' }], { duration: 60000 })
    try {
      const ctx = await capture(root)
      expect(isRed(px(ctx, 75, 50))).toBe(true)
    } finally { anim.cancel() }
  })

  it('a @keyframes animation of r, reached through the rule that names it', async () => {
    const root = mount('<svg width="400" height="100"><circle class="grow" cx="50" cy="50" r="2" fill="red"/></svg>',
      '@keyframes zz-grow { from { r: 30px } to { r: 30px } } .grow { animation: zz-grow 60s linear infinite }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 75, 50))).toBe(true)
  })

  it('a nested rule, whose & resolves against its parent', async () => {
    const root = mount('<div class="zz-nest"><svg width="400" height="100"><circle cx="50" cy="50" fill="red"/></svg></div>',
      '.zz-nest { & circle { r: 20px } }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 65, 50))).toBe(true)
  })

  it.skipIf(!supportsD)('d: path() from a rule', async () => {
    const root = mount('<svg width="400" height="100"><path class="p" fill="red"/></svg>',
      '.p { d: path("M200 20 L260 20 L260 80 L200 80 Z") }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 230, 50))).toBe(true)
  })
})

describe('attribute-driven SVG stays as it was', () => {
  it('writes no geometry onto shapes whose attributes drive them, even when the page declares those props', async () => {
    // A LeaderLine-like tree (#201): defs, use, mask, marker, all geometry in attributes, on a
    // page whose CSS names the same properties for other elements.
    const root = mount(`<svg id="ll" width="300" height="100" viewBox="0 0 300 100">
        <defs>
          <path id="ll-path" d="M10 50 L290 50"/>
          <mask id="ll-mask" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="300" height="100" fill="#fff"/><circle cx="150" cy="50" r="6" fill="#000"/></mask>
          <marker id="ll-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4"><path d="M0 0 L8 4 L0 8 Z" fill="red"/></marker>
        </defs>
        <g transform="translate(0 0)"><use href="#ll-path" x="0" y="0" stroke="red" stroke-width="6" mask="url(#ll-mask)" marker-end="url(#ll-arrow)"/></g>
        <rect x="20" y="70" width="40" height="20" rx="4" fill="red"/>
      </svg>`,
    '.other { r: 3px; d: path("M0 0"); x: 1px; width: 10px; transform: rotate(3deg); vector-effect: non-scaling-stroke }')
    const result = await snapdom(root, OPTS)
    const svg = decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
    for (const prop of ['r', 'cx', 'd', 'x', 'width', 'height', 'rx', 'transform', 'vector-effect']) {
      expect(svg, prop).not.toMatch(new RegExp(`<(?:path|rect|circle|use|g)\\b[^>]*style="[^"]*(?:^|[;\\s"])${prop}:`))
    }
    const canvas = await result.toCanvas()
    const ctx = canvas.getContext('2d')
    expect(isRed(px(ctx, 60, 50)), 'masked line').toBe(true)
    expect(isWhite(px(ctx, 150, 50)), 'mask hole').toBe(true)
    expect(isRed(px(ctx, 40, 80)), 'rect').toBe(true)
  })

  it('does not rewrite the live transform attribute while comparing it', async () => {
    // consolidate() would turn the page's own `translate(10 5) rotate(30)` into one matrix().
    const root = mount('<svg width="200" height="100"><g transform="translate(10 5) rotate(30)"><rect width="20" height="20" fill="red"/></g></svg>',
      '.other { transform: rotate(3deg) }')
    const g = root.querySelector('g')
    await snapdom(root, OPTS)
    expect(g.getAttribute('transform')).toBe('translate(10 5) rotate(30)')
    expect(g.transform.baseVal.numberOfItems).toBe(2)
  })

  it('leaves precise attributes alone in a shadow root, where every prop is read', async () => {
    // Shadow content has no scanned rule set to gate on. Firefox serializes `d` and lengths in
    // single-float precision, and writing them back moved the arcs of an orbit demo.
    const root = mount('<div class="host"></div>')
    const shadow = root.firstChild.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<svg width="200" height="100"><path d="M 51.12492386887649,-5.0001 A 50.4363267749187 50.4363267749187 0 0 1 100.123456789,50" stroke="red" fill="none"/>' +
      '<circle cx="150.123456789" cy="50.987654321" r="20.333333333" fill="red" transform="translate(0.123456789 0)"/></svg>'
    const result = await snapdom(root, OPTS)
    const svg = decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
    for (const prop of ['d', 'r', 'cx', 'cy', 'transform']) {
      expect(svg, prop).not.toMatch(new RegExp(`<(?:path|circle)\\b[^>]*style="[^"]*(?:^|[;\\s"])${prop}:`))
    }
  })

  it('an <svg> sized by CSS is not cut off (#217)', async () => {
    const root = mount('<svg class="wide" viewBox="0 0 10 1" preserveAspectRatio="none"><rect width="10" height="1" fill="red"/></svg>',
      '.wide { width: 380px; height: 30px; display: block }')
    const ctx = await capture(root)
    expect(isRed(px(ctx, 5, 15))).toBe(true)
    expect(isRed(px(ctx, 375, 15)), 'right end').toBe(true)
    expect(isRed(px(ctx, 375, 28)), 'bottom right').toBe(true)
  })
})

describe('styleScan svgGeometry', () => {
  it('collects the SVG geometry props rules and keyframes declare, and nothing from the always-list', () => {
    const style = document.createElement('style')
    style.textContent = '.zz-g { r: 3px; cx: 1px } @keyframes zz-g { to { vector-effect: none } }'
    document.head.appendChild(style)
    mounted.push(style)
    const { svgGeometry, universe } = scanAuthorStyles(document)
    expect(svgGeometry.has('r')).toBe(true)
    expect(svgGeometry.has('cx')).toBe(true)
    expect(svgGeometry.has('vector-effect')).toBe(true)
    expect(universe.has('transform-origin')).toBe(true) // ALWAYS_PROPS
    expect(svgGeometry.has('transform-box')).toBe(false)
  })

  it('gates by the selectors of the rules that declare them', async () => {
    const style = document.createElement('style')
    style.textContent = '.zz-a circle, .zz-b::before { r: 3px } .zz-c { fill: red } @keyframes zz-k { to { cx: 1px } } .zz-anim { animation: zz-k 1s }'
    document.head.appendChild(style)
    mounted.push(style)
    const sels = scanAuthorStyles(document).svgGeometrySel.split(',')
    expect(sels).toContain('.zz-a circle')
    expect(sels).toContain('.zz-b')
    expect(sels).toContain('.zz-anim')
    expect(sels).not.toContain('.zz-c')
  })
})
