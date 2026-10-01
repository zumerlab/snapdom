// #516, two Firefox-for-Android defects on one form demo.
//
// 1. The checkbox/radio/range replacements sized their inline <svg> by attributes alone, and
//    under the engine's layoutZoom (zoom = devicePixelRatio) Firefox painted that svg at twice
//    the box: a 14px checkbox drew 28px over its label at DPR 2. The runner's DPR is 1, so it is
//    stubbed. An indeterminate checkbox takes the replacement on every engine.
// 2. Font inflation: Firefox paints text larger than getComputedStyle reports when the layout
//    viewport is wider than the screen. No runner reaches that state, so the test fakes the one
//    reading that lies (the computed font-size) and checks the measured size reaches the clone.

import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isFirefox } from '../src/utils/browser.js'
import { freezeInflatedFontSizes } from '../src/utils/clone.helpers.js'

const mounted = []
const ownDPR = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
const ownVV = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const ownGCS = window.getComputedStyle
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
  if (ownDPR) Object.defineProperty(window, 'devicePixelRatio', ownDPR)
  else delete window.devicePixelRatio
  if (ownVV) Object.defineProperty(window, 'visualViewport', ownVV)
  else delete window.visualViewport
  window.getComputedStyle = ownGCS
})
function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host.firstElementChild
}

/** Width and height of the box holding every pure-red pixel. */
async function redSize(el) {
  const canvas = await (await snapdom(el, { dpr: 1, scale: 1, cache: 'disabled', burst: false })).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x)
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 200) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      }
    }
  }
  return x1 < 0 ? [0, 0] : [x1 - x0 + 1, y1 - y0 + 1]
}

describe('#516 Firefox for Android', () => {
  it('paints a checkbox replacement at its box size under a devicePixelRatio of 2', async () => {
    const el = mount('<div style="display:inline-block;padding:4px;background:#fff">' +
      '<input type="checkbox" checked style="accent-color:#f00;margin:0;width:16px;height:16px"></div>')
    el.firstElementChild.indeterminate = true
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 2 })
    const [w, h] = await redSize(el)
    expect(w).toBeGreaterThan(10)
    expect(w).toBeLessThanOrEqual(17)
    expect(h).toBeLessThanOrEqual(17)
  })

  it.runIf(isFirefox())('writes the painted size of inflated text onto the clone', () => {
    const src = mount('<p style="font:30px serif;margin:0">Checkbox A</p>')
    const clone = src.cloneNode(true)
    clone.removeAttribute('style')
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({ scale: 0.42 }) })
    // What Firefox reports for inflated text: the authored size, not the painted one.
    window.getComputedStyle = (node, pseudo) => {
      const cs = ownGCS.call(window, node, pseudo)
      if (node !== src) return cs
      return new Proxy(cs, {
        get: (t, k) => k === 'fontSize' ? '16px'
          : k === 'getPropertyValue' ? (p) => p === 'font-size' ? '16px' : t.getPropertyValue(p)
          : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])
      })
    }
    freezeInflatedFontSizes(new Map([[clone, src]]))
    expect(parseFloat(clone.style.fontSize)).toBeCloseTo(30, 0)
  })

  it('writes nothing when the page is not inflated', () => {
    const src = mount('<p style="font:16px serif;margin:0">Checkbox A</p>')
    const clone = src.cloneNode(true)
    freezeInflatedFontSizes(new Map([[clone, src]]))
    expect(clone.getAttribute('style')).toBe(src.getAttribute('style'))
  })
})
