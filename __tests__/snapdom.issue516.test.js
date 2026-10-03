// #516, Firefox-for-Android defects from the issue's two demos.
//
// 1. The checkbox/radio/range replacements sized their inline <svg> by attributes alone, and
//    under the engine's layoutZoom (zoom = devicePixelRatio) Firefox painted that svg at twice
//    the box: a 14px checkbox drew 28px over its label at DPR 2. The runner's DPR is 1, so it is
//    stubbed. An indeterminate checkbox takes the replacement on every engine.
// 2. Font inflation: Firefox paints text larger than getComputedStyle reports when the layout
//    viewport is wider than the screen. No runner reaches that state, so the tests fake the
//    readings that lie (the computed font-size and line-height) and check the measured size
//    reaches the clone.
// 3. An inline-block frozen at the width of its own text wrapped in the capture when the capture
//    laid the text out a hair wider (Firefox at DPR 2.727, by under 1/60px), and every box below
//    it slid out of its frozen parent. The runner has no such drift, so the clone is mounted
//    with a little extra letter-spacing, which widens the text the same way.
// 4. A download is dpr 1 while the svg engine lays out on the live device-pixel grid, so a
//    border snapped to whole device pixels lands under one output pixel and Firefox dropped
//    some edges. `zoom` on an ancestor gives the runner the same snapped borders (#508).
// 5. That export goes through a raster at the grid, and a canvas that shrinks it in one
//    bilinear draw without mipmaps (mobile Firefox, the issue's 100-box demo) skips rows and
//    columns of it. Chromium's 'low' smoothing is that resampler, so the test pins the
//    quality at 'low' and reports Firefox for the export.

import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isFirefox } from '../src/utils/browser.js'
import { freezeInflatedFontSizes } from '../src/utils/clone.helpers.js'
import { prepareClone } from '../src/core/prepare.js'

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

  /** Report `src` the way Firefox reports inflated text: at the authored size, not the painted one. */
  function reportAuthored(src, fontSize, lineHeight = 'normal') {
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({ scale: 0.42 }) })
    const lie = { 'font-size': fontSize, 'line-height': lineHeight }
    window.getComputedStyle = (node, pseudo) => {
      const cs = ownGCS.call(window, node, pseudo)
      if (node !== src) return cs
      return new Proxy(cs, {
        get: (t, k) => k === 'fontSize' ? fontSize : k === 'lineHeight' ? lineHeight
          : k === 'getPropertyValue' ? (p) => lie[p] ?? t.getPropertyValue(p)
          : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])
      })
    }
  }

  it.runIf(isFirefox())('writes the painted size of inflated text onto the clone', () => {
    const src = mount('<p style="font:30px/45px serif;margin:0">Checkbox A</p>')
    const clone = src.cloneNode(true)
    clone.removeAttribute('style')
    reportAuthored(src, '16px', '24px')
    freezeInflatedFontSizes(new Map([[clone, src]]))
    expect(parseFloat(clone.style.fontSize)).toBeCloseTo(30, 0)
    // The line height is reported authored too, and painted inflated by the same ratio.
    expect(parseFloat(clone.style.lineHeight)).toBeCloseTo(45, 0)
  })

  it.runIf(isFirefox())('reads the painted size of a field value through the caret', () => {
    const src = mount('<input value="Hello input" style="position:fixed;left:0;top:0;font:26px sans-serif;width:300px">')
    const clone = src.cloneNode(true)
    clone.removeAttribute('style')
    reportAuthored(src, '13px')
    freezeInflatedFontSizes(new Map([[clone, src]]))
    expect(parseFloat(clone.style.fontSize)).toBeCloseTo(26, 0)
  })

  it('writes nothing when the page is not inflated', () => {
    const src = mount('<p style="font:16px serif;margin:0">Checkbox A</p>')
    const clone = src.cloneNode(true)
    freezeInflatedFontSizes(new Map([[clone, src]]))
    expect(clone.getAttribute('style')).toBe(src.getAttribute('style'))
  })
})

/**
 * The clone of `root`, mounted in a shadow root (cloned class names would otherwise pick up
 * this file's rules) with its text widened by `drift` per letter.
 */
async function mountDrifted(root, drift = 0.4) {
  const { clone, classCSS } = await prepareClone(root, { embedFonts: false })
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${root.getBoundingClientRect().width}px`
  document.body.appendChild(host)
  mounted.push(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = classCSS + `*{letter-spacing:${drift}px}`
  shadow.append(style, clone)
  return shadow
}
const pinned = (el) => el.style.textWrapMode === 'nowrap' || el.style.whiteSpace === 'nowrap'
const lines = (el) => {
  const tops = new Set()
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.data.trim()) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    for (const rect of r.getClientRects()) tops.add(Math.round(rect.top))
  }
  return tops.size
}

describe('#516 a box on one line live stays on one line in the capture', () => {
  const SCENE = '<div style="width:300px;padding:5px;background:#fff;font:16px serif">' +
    '<div class="o" style="border:1px solid #000;margin:16px">' +
    '<div class="t" style="display:inline-block;border:1px solid #000;padding:0 3.2px;margin:3px">aa bb</div>' +
    '<div class="b" style="border:1px solid #000;padding:0 3.2px;margin:3px">aa bb</div></div></div>'

  it('keeps the issue scene in place when the capture lays the text out wider', async () => {
    const el = mount(SCENE)
    const shadow = await mountDrifted(el)
    expect(pinned(shadow.querySelector('.t'))).toBe(true)
    expect(lines(shadow.querySelector('.t'))).toBe(1)
    const top = (root) => root.querySelector('.b').getBoundingClientRect().top - root.querySelector('.o').getBoundingClientRect().top
    expect(top(shadow)).toBeCloseTo(top(el), 1)
  })

  it('keeps a row of one-line boxes in a shrink-to-fit parent on one line', async () => {
    const el = mount('<div style="display:inline-block;font:15px sans-serif;background:#fff">' +
      ['Create', 'Upload many', 'Delete all'].map(t => `<div class="k" style="display:inline-block;padding:2px 6px;border:1px solid #333">${t}</div>`).join(' ') + '</div>')
    const shadow = await mountDrifted(el)
    const tops = new Set([...shadow.querySelectorAll('.k')].map(k => Math.round(k.getBoundingClientRect().top)))
    expect(tops.size).toBe(1)
  })

  it('leaves a box that wraps live free to wrap', async () => {
    const el = mount('<div style="background:#fff;font:16px serif"><div class="t" style="display:inline-block;width:40px">aa bb cc dd</div></div>')
    expect(lines(el.querySelector('.t'))).toBeGreaterThan(1)
    const shadow = await mountDrifted(el, 0)
    expect(pinned(shadow.querySelector('.t'))).toBe(false)
    expect(lines(shadow.querySelector('.t'))).toBe(lines(el.querySelector('.t')))
  })

  it('leaves a wrapped ::after of a one-line box wrapped', async () => {
    const style = document.createElement('style')
    style.textContent = '.i516tip{position:relative}.i516tip::after{content:"one two three four five six";position:absolute;left:0;top:100%;width:50px}'
    document.head.appendChild(style)
    mounted.push(style)
    const el = mount('<div style="background:#fff;font:16px serif;padding-bottom:120px"><div class="t i516tip" style="display:inline-block">aa bb</div></div>')
    const shadow = await mountDrifted(el, 0)
    const pseudo = shadow.querySelector('[data-snapdom-pseudo="::after"]')
    expect(pseudo).not.toBeNull()
    expect(lines(pseudo)).toBeGreaterThan(1)
  })

  it('does not trust line geometry under a rotated ancestor', async () => {
    // Rotated 90deg, the two lines sit side by side and overlap on the page's vertical axis.
    const el = mount('<div style="padding:60px;background:#fff;font:16px serif"><div style="transform:rotate(90deg)"><div class="t" style="display:inline-block;width:40px">aa bb cc dd</div></div></div>')
    const shadow = await mountDrifted(el, 0)
    expect(pinned(shadow.querySelector('.t'))).toBe(false)
  })
})

describe('#516 a dpr 1 export of a capture laid out on a finer grid', () => {
  it('keeps every edge of every bordered box', async () => {
    const zoom = document.createElement('div')
    zoom.style.zoom = '1.3125'
    zoom.innerHTML = '<div style="display:inline-block;padding:4px 7px;background:#fff">' +
      [31, 44, 27].map(w => `<div style="display:inline-block;width:${w}px;height:20px;border:1px solid #000;margin:3.3px"></div>`).join('') + '</div>'
    document.body.appendChild(zoom)
    mounted.push(zoom)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 2.625 })
    const canvas = await (await snapdom(zoom.firstElementChild, { cache: 'disabled', burst: false })).toCanvas({ dpr: 1 })
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    // A column belongs to a vertical edge when most of the band the boxes share has ink in it.
    let edges = 0
    let inEdge = false
    for (let x = 0; x < width; x++) {
      let ink = 0
      for (let y = 0; y < height; y++) if (data[4 * (y * width + x)] < 200) ink++
      const edge = ink >= 14
      if (edge && !inEdge) edges++
      inEdge = edge
    }
    expect(edges).toBe(6)
  })

  it('keeps every edge when the canvas cannot shrink with mipmaps', async () => {
    const box = '<div style="border:1px solid #000;margin:16px"><div style="display:inline-block;border:1px solid #000;padding:0 3.2px;margin:3px">aa bb</div>' +
      '<div style="border:1px solid #000;padding:0 3.2px;margin:3px">aa bb</div></div>'
    const el = mount(`<div style="width:198px;padding:5px;background:#fff;font:16px serif">${box.repeat(24)}</div>`)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 2.7272727 })
    const res = await snapdom(el, { cache: 'disabled', burst: false })
    const proto = CanvasRenderingContext2D.prototype
    const ownQuality = Object.getOwnPropertyDescriptor(proto, 'imageSmoothingQuality')
    const ownUA = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    Object.defineProperty(proto, 'imageSmoothingQuality', { configurable: true, get: () => 'low', set() {} })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0' })
    let canvas
    try {
      canvas = await res.toCanvas({ dpr: 1 })
    } finally {
      Object.defineProperty(proto, 'imageSmoothingQuality', ownQuality)
      if (ownUA) Object.defineProperty(navigator, 'userAgent', ownUA)
      else delete navigator.userAgent
    }
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    const ink = (x, y) => data[4 * (y * width + x)] < 200
    // The capture lays out on the 2.727 grid and drifts from the live boxes down the page, so
    // horizontal edges are counted as runs down a column right of the text: 4 per box.
    let runs = 0, last = 0
    for (let y = 0, prev = false; y < height; y++) {
      const on = ink(width - 30, y)
      if (on && !prev) runs++
      if (on) last = y
      prev = on
    }
    expect(runs).toBe(24 * 4)
    // Vertical edges are checked at the middle row of each box, its live row scaled by the
    // drift measured at the last box's bottom edge.
    const origin = el.getBoundingClientRect()
    const stretch = (last + 1) / (el.lastElementChild.getBoundingClientRect().bottom - origin.top)
    let lost = 0
    for (const b of el.querySelectorAll('div div')) {
      const r = b.getBoundingClientRect()
      const my = Math.floor(((r.top + r.bottom) / 2 - origin.top) * stretch)
      for (const x of [Math.floor(r.left - origin.left), Math.floor(r.right - origin.left) - 1]) {
        if (![-1, 0, 1].some(k => ink(x + k, my))) lost++
      }
    }
    expect(lost).toBe(0)
  })
})
