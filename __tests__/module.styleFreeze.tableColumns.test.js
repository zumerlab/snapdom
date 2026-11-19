// A <col span="2"> resolves `width` to both columns and CSS applies it to each: a 253px table
// came out 423px. A table's used height counts its captions while `height` sizes the row
// grid: 21px rows came out 30px. Both found on html2pdf.js's all-tags reference page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { inlineAllStyles } from '../src/modules/styles.js'

let host
afterEach(() => { host?.remove(); host = null })

function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'width:500px;background:white;font:16px/18px serif'
  host.innerHTML = `<style>table{border-collapse:collapse}td{border:1px solid rgb(0,0,0);padding:1px}</style>${html}`
  document.body.appendChild(host)
  return host
}

const ROWS = '<tr><td>One</td><td>Two words</td><td>Three little words</td></tr><tr><td>1</td><td>2</td><td>3</td></tr>'
const BAR = '<div data-bar style="height:20px;background:rgb(89,49,134)"></div>'

async function styleKeyFor(el) {
  const clone = el.cloneNode(true)
  const session = { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  await inlineAllStyles(el, clone, session)
  return session.styleMap.get(clone) || ''
}

const capture = async () => (await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })).toCanvas()

/** Last column of row `y` that is darker than mid grey: the table's right border. */
function rightEdge(canvas, y) {
  const d = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data
  for (let x = canvas.width - 1; x >= 0; x--) if (d[x * 4] < 100 && d[x * 4 + 3] > 200) return x
  return -1
}

function barTop(canvas) {
  const d = canvas.getContext('2d').getImageData(5, 0, 1, canvas.height).data
  for (let y = 0; y < canvas.height; y++) {
    if (Math.abs(d[y * 4] - 89) < 12 && Math.abs(d[y * 4 + 1] - 49) < 12 && Math.abs(d[y * 4 + 2] - 134) < 12) return y
  }
  return -1
}

describe('table columns', () => {
  it('a spanning <col> does not widen the table', async () => {
    mount(`<table><colgroup><col span="2" style="background:#ddd"><col></colgroup>${ROWS}</table>`)
    const width = host.querySelector('table').getBoundingClientRect().width
    const canvas = await capture()
    expect(Math.abs(rightEdge(canvas, 0) + 1 - Math.round(width))).toBeLessThanOrEqual(1)
  })

  it('a spanning <colgroup> does not either', async () => {
    mount(`<table><colgroup span="2" style="background:#ddd"></colgroup><colgroup><col></colgroup>${ROWS}</table>`)
    const width = host.querySelector('table').getBoundingClientRect().width
    const canvas = await capture()
    expect(Math.abs(rightEdge(canvas, 0) + 1 - Math.round(width))).toBeLessThanOrEqual(1)
  })

  it('a spanning <col> keeps the width its author gave each column', async () => {
    mount(`<style>.w{width:120px}</style><table><colgroup><col class="w" span="2"><col></colgroup>${ROWS}</table>`)
    const width = host.querySelector('table').getBoundingClientRect().width
    const canvas = await capture()
    expect(Math.abs(rightEdge(canvas, 0) + 1 - Math.round(width))).toBeLessThanOrEqual(1)
  })

  it('a single <col> keeps its resolved width, a span of auto columns none', async () => {
    mount(`<table><colgroup><col id="one"><col id="two" span="2"></colgroup>${ROWS}</table>`)
    expect(await styleKeyFor(host.querySelector('#one'))).toMatch(/(?:^|;)width:/)
    expect(await styleKeyFor(host.querySelector('#two'))).not.toMatch(/(?:^|;)width:/)
  })
})

describe('a table with a caption', () => {
  for (const side of ['top', 'bottom']) {
    it(`keeps its rows their height, caption at the ${side}`, async () => {
      mount(`<table><caption style="caption-side:${side}">Caption</caption>${ROWS}</table>${BAR}`)
      const live = host.querySelector('[data-bar]').getBoundingClientRect().top - host.getBoundingClientRect().top
      const canvas = await capture()
      expect(Math.abs(barTop(canvas) - Math.round(live))).toBeLessThanOrEqual(1)
      const rows = [...host.querySelectorAll('tr')].map((tr) => tr.getBoundingClientRect().height)
      expect(await styleKeyFor(host.querySelector('tr'))).toMatch(new RegExp(`(?:^|;)height:${rows[0]}px`))
    })
  }

  it('keeps an authored height, which its rows already carry', async () => {
    mount(`<table style="height:160px"><caption>Caption</caption>${ROWS}</table>${BAR}`)
    const live = host.querySelector('[data-bar]').getBoundingClientRect().top - host.getBoundingClientRect().top
    expect(Math.abs(barTop(await capture()) - Math.round(live))).toBeLessThanOrEqual(1)
  })
})
