import { afterEach, describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'
import { cache } from '../src/core/cache.js'
import { generateDedupedBaseCSS, getDefaultStyleForTag } from '../src/utils/css.js'

const mounted = []
let sequence = 0
let previousViewport
afterEach(async () => {
  while (mounted.length) mounted.pop().remove()
  cache.defaultStyle.clear()
  if (previousViewport) {
    await page.viewport(...previousViewport)
    previousViewport = null
  }
})

function component(symbolStyle = true) {
  const tag = `issue505-element-${++sequence}`
  const calls = { constructed: 0, connected: 0, disconnected: 0 }
  class Component extends HTMLElement {
    constructor() {
      super()
      calls.constructed++
    }
    connectedCallback() { calls.connected++ }
    disconnectedCallback() { calls.disconnected++ }
  }
  // A component can expose its own `style` property with a Symbol as its initial value.
  // Reading CSS defaults must not instantiate it or access that property.
  if (symbolStyle) Object.defineProperty(Component.prototype, 'style', { get: () => Symbol.for('issue505-unset') })
  customElements.define(tag, Component)
  return { tag, calls }
}

describe('custom element CSS defaults (#505)', () => {
  it.each([true, false])('does not run component code when Symbol style is %s', (symbolStyle) => {
    const { tag, calls } = component(symbolStyle)
    const defaults = getDefaultStyleForTag(tag)
    expect(defaults.display).toBe('inline')
    expect(defaults['unicode-bidi']).toBe('normal')
    expect(defaults['background-color']).toBe('rgba(0, 0, 0, 0)')
    expect(defaults['margin-top']).toBe('0px')
    expect(calls).toEqual({ constructed: 0, connected: 0, disconnected: 0 })
    expect(getDefaultStyleForTag(tag.toUpperCase())).toBe(defaults)
    expect(cache.defaultStyle.get(tag)).toBe(defaults)
  })

  it('emits the component base reset after its defaults were evicted', () => {
    const { tag, calls } = component()
    getDefaultStyleForTag(tag)
    cache.defaultStyle.delete(tag)
    const css = generateDedupedBaseCSS(['div', tag], new Set(['display', 'margin-top', 'background-color']))
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    const rules = [...sheet.cssRules].filter(rule => rule.selectorText.split(',').map(s => s.trim()).includes(tag))
    expect(rules.length).toBeGreaterThan(0)
    const declarations = Object.assign({}, ...rules.map(rule => Object.fromEntries(
      [...rule.style].map(prop => [prop, rule.style.getPropertyValue(prop)])
    )))
    expect(declarations).toEqual({ display: 'inline', 'margin-top': '0px', 'background-color': 'rgba(0, 0, 0, 0)' })
    expect(calls).toEqual({ constructed: 0, connected: 0, disconnected: 0 })
  })
})

describe('custom element capture (#505)', { timeout: 60_000 }, () => {
  it.each([true, false])('does not inherit author probe styles with identity sharing: %s', async (__styleShare) => {
    const { tag } = component()
    const sheet = document.createElement('style')
    sheet.textContent = `span{background:red!important}
      .issue505-transparent{display:block;width:240px;height:96px;background:transparent;color:#123;font:16px/24px Arial,sans-serif}`
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const root = document.createElement('div')
    root.style.cssText = 'width:240px;height:384px;background:white'
    // Twins exercise the shared snapshot path as well as the first snapshot for each tag.
    root.innerHTML = '<label class="issue505-transparent">Preview</label>'.repeat(2) +
      `<${tag} class="issue505-transparent">Preview</${tag}>`.repeat(2)
    document.body.appendChild(root)
    mounted.push(root)
    const canvas = await snapdom.toCanvas(root, { scale: 1, dpr: 1, burst: false, cache: 'disabled', __styleShare })
    const context = canvas.getContext('2d')
    for (const y of [10, 106, 202, 298]) {
      expect([...context.getImageData(230, y, 1, 1).data]).toEqual([255, 255, 255, 255])
    }
  })

  it.each([true, false])('matches the live component with fast: %s', async (fast) => {
    previousViewport = [window.innerWidth, window.innerHeight]
    // Keep the tester iframe at native scale, so glyph rasterization is comparable.
    await page.viewport(400, 300)
    const { tag } = component()
    const sheet = document.createElement('style')
    // Author rules can target the neutral probe tag with !important. The base reset and
    // computed-style diff must still reconstruct the component's own appearance.
    sheet.textContent = `span{display:block!important;color:red!important;padding:9px!important;background:yellow!important}
      ${tag}{display:block;width:240px;height:96px;background:#153e63;color:white;font:16px/24px Arial,sans-serif}
      ${tag} header{box-sizing:border-box;height:40px;padding:8px 12px;background:#087f8c}
      ${tag} p{box-sizing:border-box;height:56px;margin:0;padding:16px 12px}`
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const root = document.createElement('div')
    root.style.cssText = 'width:240px;height:96px;background:white'
    root.innerHTML = `<${tag}><header>Component preview</header><p>Style property: Symbol</p></${tag}>`
    document.body.appendChild(root)
    mounted.push(root)
    expect(typeof root.firstElementChild.style).toBe('symbol')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const screenshot = await page.screenshot({ element: root, base64: true })
    const live = new Image()
    live.src = 'data:image/png;base64,' + screenshot.base64
    await live.decode()
    const result = await snapdom(root, { fast, scale: 1, dpr: 1, burst: false, cache: 'disabled' })
    const svg = new DOMParser().parseFromString(await (await result.toBlob()).text(), 'image/svg+xml')
    expect(svg.querySelector(tag).textContent).toBe('Component previewStyle property: Symbol')

    const actual = await result.toCanvas()
    expect(actual.width).toBe(240)
    expect(actual.height).toBe(96)
    const context = actual.getContext('2d')
    expect([...context.getImageData(230, 10, 1, 1).data]).toEqual([8, 127, 140, 255])
    expect([...context.getImageData(230, 80, 1, 1).data]).toEqual([21, 62, 99, 255])
    const comparison = document.createElement('canvas')
    const width = comparison.width = live.naturalWidth
    const height = comparison.height = live.naturalHeight
    const comparisonContext = comparison.getContext('2d')
    comparisonContext.drawImage(actual, 0, 0, width, height)
    const actualPixels = comparisonContext.getImageData(0, 0, width, height).data
    comparisonContext.clearRect(0, 0, width, height)
    comparisonContext.drawImage(live, 0, 0)
    const expectedPixels = comparisonContext.getImageData(0, 0, width, height).data
    let differing = 0
    for (let i = 0; i < actualPixels.length; i += 4) {
      if ([0, 1, 2, 3].some(channel => Math.abs(actualPixels[i + channel] - expectedPixels[i + channel]) > 40)) differing++
    }
    // Allow font edge differences while catching lost text, backgrounds or component layout.
    expect(100 * differing / (width * height)).toBeLessThan(5)
  })
})
