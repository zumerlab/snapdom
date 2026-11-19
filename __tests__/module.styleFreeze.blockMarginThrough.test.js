// A child's bottom margin collapses through a block of auto height and pushes what follows.
// Frozen to its used height, a <details>, <form>, <address>, custom element or blockified
// span kept that margin inside: after `<details><p>` everything came out 16px high (found on
// html2pdf.js's all-tags reference page, where it shifted the rest of a 3,782px capture).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { inlineAllStyles } from '../src/modules/styles.js'

let host
afterEach(() => { host?.remove(); host = null })

function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'width:300px;background:white;font:16px/18px serif'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

const BAR = '<div data-bar style="height:20px;background:rgb(89,49,134)"></div>'

/** First canvas row at x=5 that carries the bar's colour. */
function barTop(canvas) {
  const d = canvas.getContext('2d').getImageData(5, 0, 1, canvas.height).data
  for (let y = 0; y < canvas.height; y++) {
    if (Math.abs(d[y * 4] - 89) < 12 && Math.abs(d[y * 4 + 1] - 49) < 12 && Math.abs(d[y * 4 + 2] - 134) < 12) return y
  }
  return -1
}

async function styleKeyFor(el) {
  const clone = el.cloneNode(true)
  const session = { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  await inlineAllStyles(el, clone, session)
  return session.styleMap.get(clone) || ''
}

describe('a bottom margin that collapses through a block', () => {
  const blocks = {
    details: '<details open><summary>Summary</summary><p>Inside</p></details>',
    form: '<form><p>Inside</p></form>',
    address: '<address><p>Inside</p></address>',
    'custom element': '<x-card style="display:block"><p>Inside</p></x-card>',
    'block span': '<span style="display:block"><p>Inside</p></span>',
  }
  for (const [name, html] of Object.entries(blocks)) {
    it(`keeps pushing what follows a ${name}`, async () => {
      mount(html + BAR)
      const live = host.querySelector('[data-bar]').getBoundingClientRect().top - host.getBoundingClientRect().top
      const canvas = await (await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })).toCanvas()
      expect(Math.abs(barTop(canvas) - Math.round(live))).toBeLessThanOrEqual(1)
    })
  }

  it('lets go of the height only where the last child carries a margin', async () => {
    mount('<form id="a"><p>Inside</p></form><form id="b"><p style="margin:0">Inside</p></form>')
    expect(await styleKeyFor(host.querySelector('#a'))).not.toMatch(/(?:^|;)height:/)
    expect(await styleKeyFor(host.querySelector('#b'))).toMatch(/(?:^|;)height:18px/)
  })
})
