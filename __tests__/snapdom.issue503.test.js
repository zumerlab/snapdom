import { afterEach, describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'
import { rewriteShadowCSS } from '../src/utils/clone.helpers.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const scope = '[data-sd="issue503"]'

function parsedRules(selector) {
  const sheet = new CSSStyleSheet()
  // Generated capture classes follow the rewritten shadow CSS in the same sheet. A broken
  // selector swallowed that entire tail, leaving the ArcGIS table's intact DOM unstyled.
  sheet.replaceSync(rewriteShadowCSS(`${selector}{color:red}`, scope, 'issue503') +
    '.sentinel{color:rgb(0,128,0)}')
  const rules = [...sheet.cssRules]
  expect(rules).toHaveLength(2)
  expect(rules[1].selectorText).toBe('.sentinel')
  expect(rules[1].style.color).toBe('rgb(0, 128, 0)')
  return rules
}

describe('shadow selector lists (#503)', () => {
  it.each([
    ':is(.last-column-cell, .last-frozen-cell, .frozen-to-end-cell) .resize-handle::before',
    ':host(:not([checked], [indeterminate]))::before',
    ':where(.row, :is(.cell, .other)):not(.hidden, .disabled)::after',
    '[data-label="first, second"]::before',
    '.first\\,second::before',
  ])('keeps following capture classes after %s', (selector) => {
    parsedRules(selector)
  })

  it.each([
    [':is(.first, .second)', ['first', 'second']],
    [':not(.first, .second)', ['third', 'nested']],
    [':where(.first, :is(.second, .third))', ['first', 'second', 'third']],
    ['.third:has(> .nested, > .missing)', ['third']],
    ['[data-label="first, second"]', ['second']],
    ['.first\\,second, .second', ['first', 'second']],
  ])('preserves matches for %s', (selector, matches) => {
    const host = document.createElement('div')
    host.setAttribute('data-sd', 'issue503')
    host.innerHTML = '<div id="first" class="first first,second"></div>' +
      '<div id="second" class="second" data-label="first, second"></div>' +
      '<div id="third" class="third"><span id="nested" class="nested"></span></div>'
    document.body.appendChild(host)
    mounted.push(host)
    const [rule] = parsedRules(selector)
    expect([...host.querySelectorAll(rule.selectorText)].map(el => el.id)).toEqual(matches)
    const outside = host.cloneNode(true)
    outside.removeAttribute('data-sd')
    expect(outside.querySelector(rule.selectorText)).toBe(null)
  })
})

function tableScene() {
  const host = document.createElement('div')
  host.style.cssText = 'display:block;width:360px;height:180px;background:white'
  host.attachShadow({ mode: 'open' }).innerHTML = `<style>
    :host{font:14px/20px Arial,sans-serif;color:#152235}
    .panel{height:180px;background:#e5edf5}
    header{box-sizing:border-box;height:40px;padding:10px 12px;background:#173e62;color:white}
  </style><section class="panel"><header>Feature table</header><slot></slot></section>`
  const grid = document.createElement('div')
  host.appendChild(grid)
  grid.attachShadow({ mode: 'open' }).innerHTML = `<style>
    :host{display:block}
    :is(.last-column-cell, .last-frozen-cell, .frozen-to-end-cell) .resize-handle::before{
      content:"";display:block;width:4px;height:12px;background:#007ac2
    }
    table{border-collapse:collapse;width:360px;table-layout:fixed}
    th,td{box-sizing:border-box;height:40px;padding:10px 12px;text-align:left;border-bottom:1px solid #afc3d6}
    th{background:#b9d6ed;color:#152235;font-weight:bold}
    td{background:#f0f6fb}
    tr:last-child td{background:#d9e9f5}
    .resize-handle{float:right}
  </style><table><thead><tr><th>Name</th><th class="last-column-cell">Status<span class="resize-handle"></span></th></tr></thead>
    <tbody><tr><td>Bar-K Wrangler Camp</td><td>Open</td></tr><tr><td>Bard Springs</td><td>Seasonal</td></tr></tbody></table>`
  const checkbox = document.createElement('div')
  checkbox.style.cssText = 'display:block;height:20px'
  checkbox.attachShadow({ mode: 'open' }).innerHTML = `<style>
    :host(:not([checked], [indeterminate]))::before{content:"";display:block;width:12px;height:12px;background:#007ac2}
  </style>`
  grid.shadowRoot.appendChild(checkbox)
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

async function decode(src) {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

function pixelsOf(image, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return context.getImageData(0, 0, width, height).data
}

describe('composed feature table rendering (#503)', { timeout: 60_000 }, () => {
  it.each([true, false])('matches the live table with fast: %s', async (fast) => {
    const host = tableScene()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const screenshot = await page.screenshot({ element: host, base64: true })
    const live = await decode('data:image/png;base64,' + screenshot.base64)
    const result = await snapdom(host, { fast, scale: 1, dpr: 1, burst: false, cache: 'disabled' })
    const svg = new DOMParser().parseFromString(await (await result.toBlob()).text(), 'image/svg+xml')
    expect(svg.querySelector('thead').textContent).toBe('NameStatus')
    expect(svg.querySelector('tbody').textContent).toContain('Bar-K Wrangler Camp')
    expect(svg.querySelector('tbody').textContent).toContain('Bard Springs')

    const width = live.naturalWidth
    const height = live.naturalHeight
    const expected = pixelsOf(live, width, height)
    const actual = pixelsOf(await result.toCanvas(), width, height)
    let differing = 0
    for (let i = 0; i < expected.length; i += 4) {
      if ([0, 1, 2].some(channel => Math.abs(expected[i + channel] - actual[i + channel]) > 40)) differing++
    }
    // Text hinting and the test iframe's scaling affect edges. Missing table styles alter
    // most of the coloured surface, far beyond the live-render tolerance used elsewhere.
    expect(100 * differing / (width * height)).toBeLessThan(10)
  })
})
