// #558: a stylesheet adopted by many shadow roots was rewritten once per root, so the svg grew
// with the number of hosts. Hosts at one depth with the same CSS now share one copy; these pin
// the size and every case where sharing could paint something else. The style snapshot and the
// base reset outrank every scoped rule on an element, so the cases paint ::marker, which only
// the scoped rules reach inside a shadow tree.
import { afterEach, beforeAll, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const RED = [255, 0, 0], GREEN = [0, 160, 0], BLUE = [0, 0, 255], BLACK = [0, 0, 0]
const LIST = 'margin:0;padding:0;list-style:square inside;font:40px sans-serif'

const sheet = new CSSStyleSheet()
sheet.replaceSync(Array.from({ length: 300 }, (_, i) => `.rule-${i}{padding:${i % 7}px}`).join('') +
  `:host{display:block}ul{${LIST}}li::marker{color:var(--c, rgb(0, 0, 255))}`)

beforeAll(() => {
  customElements.define('x-558', class extends HTMLElement {
    constructor() {
      super()
      const root = this.attachShadow({ mode: 'open' })
      root.adoptedStyleSheets = [sheet]
      root.innerHTML = '<ul><li>&nbsp;</li></ul><slot></slot>'
    }
  })
  // An outer host whose marker rule reaches the host in its shadow tree once flattened; that
  // host's own rule, later in the cascade, is what keeps its marker blue.
  customElements.define('x-558-shell', class extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>li::marker{color:rgb(255, 0, 0)}</style><x-558></x-558>'
    }
  })
  customElements.define('x-558-wrap', class extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML = '<x-558></x-558>'
    }
  })
})

let host
afterEach(() => { host?.remove(); host = null })

async function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;width:300px;background:#fff'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

const svgText = (url) => decodeURIComponent(url.slice(url.indexOf(',') + 1))

// Pixels close to [r, g, b] inside one element's box.
function count(canvas, el, [r, g, b]) {
  const o = host.getBoundingClientRect(), e = el.getBoundingClientRect()
  const d = canvas.getContext('2d').getImageData(e.left - o.left, e.top - o.top, e.width, e.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40) n++
  return n
}

const capture = () => snapdom.toCanvas(host, { dpr: 1, cache: 'disabled' })

it('writes a sheet shared by 16 hosts once', async () => {
  await mount('<x-558></x-558>'.repeat(16))
  const svg = svgText((await snapdom(host, { dpr: 1, cache: 'disabled' })).url)
  expect(svg.split('.rule-123:not(').length - 1).toBe(1)
})

// The third host sets no --c. A seed that reached every member would paint it with another's.
it('keeps each host its own custom-property seed', async () => {
  await mount('<x-558 style="--c: rgb(255, 0, 0)"></x-558><x-558 style="--c: rgb(0, 160, 0)"></x-558><x-558></x-558>')
  const canvas = await capture()
  const [a, b, c] = host.querySelectorAll('x-558')
  expect(count(canvas, a, RED)).toBeGreaterThan(50)
  expect(count(canvas, a, GREEN)).toBe(0)
  expect(count(canvas, b, GREEN)).toBeGreaterThan(50)
  expect(count(canvas, b, RED)).toBe(0)
  expect(count(canvas, c, BLUE)).toBeGreaterThan(50)
  expect(count(canvas, c, RED) + count(canvas, c, GREEN)).toBe(0)
})

// The host in the wrapper and the one in the shell share a group, whose one copy is written at
// the first, before the shell's rules in the document. It must still follow them, or the shell's
// marker rule wins in the second host. The top-level one, a level shallower, must stay apart.
it('keeps a nested host\'s own rules after the scopes above it', async () => {
  await mount('<x-558></x-558><x-558-wrap></x-558-wrap><x-558-shell></x-558-shell>')
  const canvas = await capture()
  for (const el of host.children) expect(count(canvas, el, BLUE), el.localName).toBeGreaterThan(50)
  expect(count(canvas, host, RED)).toBe(0)
})

// A host slotted into a host with the same sheet keeps its own rules and seed, and the outer
// one's rules do not reach the slotted light-DOM list, whose marker keeps the text colour.
it('styles a host slotted into a host with the same sheet, and not the slotted list', async () => {
  await mount(`<x-558 style="--c: rgb(255, 0, 0)"><x-558 style="--c: rgb(0, 160, 0)"></x-558><ul style="${LIST}"><li>&nbsp;</li></ul></x-558>`)
  const canvas = await capture()
  const inner = host.querySelector('x-558 x-558')
  const slotted = host.querySelector(':scope > x-558 > ul')
  expect(count(canvas, inner, GREEN)).toBeGreaterThan(50)
  expect(count(canvas, inner, RED)).toBe(0)
  expect(count(canvas, slotted, BLACK)).toBeGreaterThan(50)
  expect(count(canvas, slotted, RED) + count(canvas, slotted, BLUE)).toBe(0)
})
