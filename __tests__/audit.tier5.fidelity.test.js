// Small fidelity defects found by the v3 audit. Each asserts the behaviour the CSS/HTML spec
// requires, and each fails against the code as it was.
import { describe, it, expect, afterEach } from 'vitest'
import { resolveCountersInContent, buildCounterContext } from '../src/modules/counter.js'
import { resolveImageSetURL } from '../src/utils/helpers.js'
import { deepClone } from '../src/core/clone.js'
import { snapdom } from '../src/index.js'
import { createCaptureSession } from '../src/core/session.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  document.body.appendChild(d)
  mounted.push(d)
  return d
}

describe('counter styles: lower-latin / upper-latin', () => {
  // Aliases of lower-alpha / upper-alpha (CSS Counter Styles §6.1). They fell through to the
  // decimal default, so an `a. b. c.` list captured as `1. 2. 3.`.
  it('renders letters, not digits', () => {
    const root = mount('<div id="c" style="counter-reset:n 3"></div>').querySelector('#c')
    const ctx = buildCounterContext(root)
    expect(resolveCountersInContent('counter(n, lower-latin)', root, ctx)).toBe('c')
    expect(resolveCountersInContent('counter(n, upper-latin)', root, ctx)).toBe('C')
  })

  it('still matches the -alpha spelling', () => {
    const root = mount('<div id="c2" style="counter-reset:n 3"></div>').querySelector('#c2')
    const ctx = buildCounterContext(root)
    expect(resolveCountersInContent('counter(n, lower-alpha)', root, ctx)).toBe('c')
  })
})

describe('image-set() resolution descriptors', () => {
  // The descriptor was matched across the whole candidate, so the first digits-then-x
  // anywhere in it won — including inside the filename.
  it('is not read out of the file name', () => {
    // The 1x candidate's filename carries "9x". Reading the descriptor from the whole
    // candidate ranked it as a 9x source, which pushed the real 1x pick out of the way and
    // returned the 2x file to a 1x target.
    const v = 'image-set(url("a-9x.png") 1x, url("b.png") 2x)'
    expect(resolveImageSetURL(v, 1)).toBe('a-9x.png')
  })

  it('still picks the lowest candidate that meets the target', () => {
    const v = 'image-set(url("a.png") 1x, url("b.png") 2x, url("c.png") 3x)'
    expect(resolveImageSetURL(v, 2)).toBe('b.png')
  })
})

describe('<select multiple>', () => {
  it('keeps every selected option, not just the first', async () => {
    const sel = mount(
      '<select id="s" multiple>' +
      '<option value="a">a</option><option value="b">b</option><option value="c">c</option>' +
      '</select>').querySelector('#s')
    sel.options[0].selected = true
    sel.options[2].selected = true

    const clone = await deepClone(sel, createCaptureSession('soft'), {})
    const picked = Array.from(clone.querySelectorAll('option'))
      .filter(o => o.hasAttribute('selected')).map(o => o.getAttribute('value'))
    expect(picked).toEqual(['a', 'c'])
  })

  it('leaves a single select on its one value', async () => {
    const sel = mount(
      '<select id="s2"><option value="a">a</option><option value="b">b</option></select>')
      .querySelector('#s2')
    sel.value = 'b'
    const clone = await deepClone(sel, createCaptureSession('soft'), {})
    const picked = Array.from(clone.querySelectorAll('option'))
      .filter(o => o.hasAttribute('selected')).map(o => o.getAttribute('value'))
    expect(picked).toEqual(['b'])
  })
})

describe('backdrop-filter on a replaced element', () => {
  // The emulation prepends a frost layer and a background layer, and wipes the element's own
  // background with !important to make room for them. A replaced element renders no children,
  // so the layers never paint and the wipe is all that survives — the element loses its
  // background and gains nothing.
  it('keeps the background of an input it cannot frost', async () => {
    const host = mount(
      '<div style="width:120px;height:60px;background:linear-gradient(90deg,#f00,#00f)">' +
      '<input id="bd" style="width:100px;height:40px;background-color:rgb(0,200,0);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)">' +
      '</div>')
    // Capture the CONTAINER: the emulation only runs for elements that have a backdrop to
    // sample, so the input has to be a descendant of the capture root.
    const canvas = await snapdom.toCanvas(host.firstElementChild, { embedFonts: false, scale: 1, dpr: 1 })
    const ctx = canvas.getContext('2d')
    // The input is centred in the 120x60 container; sample inside it.
    const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect(d[3]).toBeGreaterThan(200)
    expect(d[1]).toBeGreaterThan(120)
  })
})
