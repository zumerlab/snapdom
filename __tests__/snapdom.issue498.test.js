// #498 — three layout misalignments in one report.
//
// 1. A `::before`/`::after` with `content:""; display:inline-block` and no size was dropped as
//    "nothing to paint". A 0×0 atomic inline box still takes part in line layout: it is a
//    justification opportunity, so `text-align-last: justify` spreads "A B C" as "A   B   C" with
//    the boxes and "A     B     C" without them.
// 2. `getComputedStyle().width/height` of a content-box scroll container EXCLUDE its classic
//    scrollbars. Freezing the bare value shrank the box by the scrollbar size, the rows no longer
//    fit and a vertical scrollbar that does not exist live appeared in the capture.
// 3. `<img style="width:1.6rem">` (25.6px) got `min-width: 26px` from its integer `offsetWidth`;
//    min-width beats width, the image grew 0.4px and pushed "CCC" onto a new line inside its
//    frozen flex item.

import { describe, it, expect, afterEach } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { inlinePseudoElements } from '../src/modules/pseudo.js'
import { addScrollbarGutter } from '../src/modules/styles.js'

const mounted = []
function mount(el) {
  document.body.appendChild(el)
  mounted.push(el)
  return el
}
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

describe('#498 zero-size atomic inline pseudo boxes', () => {
  it('materializes content:"" inline-block pseudos even at 0×0 (justification opportunity)', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = `
      .i498-just { text-align: justify; text-align-last: justify; width: 200px; border: 1px solid #000; }
      .i498-just::before, .i498-just::after { content: ""; display: inline-block; }
    `
    const el = mount(document.createElement('div'))
    el.className = 'i498-just'
    el.textContent = 'A B C'
    const ps = getComputedStyle(el, '::before')
    expect(parseFloat(ps.width) || 0).toBe(0)

    const clone = el.cloneNode(true)
    await inlinePseudoElements(el, clone, { styleMap: new Map(), styleCache: new WeakMap() }, {})
    const spans = clone.querySelectorAll('[data-snapdom-pseudo]')
    expect([...spans].map((s) => s.dataset.snapdomPseudo)).toEqual(['::before', '::after'])
  })

  it('still drops a 0×0 block-level content:"" pseudo (no line-layout effect)', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.i498-blk::after { content: ""; display: block; width: 0; }'
    const el = mount(document.createElement('div'))
    el.className = 'i498-blk'
    el.textContent = 'x'
    const clone = el.cloneNode(true)
    await inlinePseudoElements(el, clone, { styleMap: new Map(), styleCache: new WeakMap() }, {})
    expect(clone.querySelector('[data-snapdom-pseudo]')).toBeNull()
  })
})

describe('#498 classic scrollbar gutter on content-box scroll containers', () => {
  const pre = (props) => ({ getPropertyValue: (p) => props[p] ?? '' })
  const base = {
    'overflow-x': 'auto', 'overflow-y': 'auto', 'box-sizing': 'content-box',
    'border-top-width': '1px', 'border-bottom-width': '1px',
    'border-left-width': '1px', 'border-right-width': '1px',
  }

  it('adds the horizontal scrollbar height back to a frozen height', () => {
    // Live numbers from the report's #demo2 > div in Chrome with classic scrollbars.
    const source = { offsetWidth: 308, clientWidth: 306, offsetHeight: 200, clientHeight: 184 }
    const snap = { width: '306px', height: '184px' }
    addScrollbarGutter(source, pre(base), snap)
    expect(snap).toEqual({ width: '306px', height: '198px' })
  })

  it('adds the vertical scrollbar width back to a frozen width and inline-size', () => {
    const source = { offsetWidth: 308, clientWidth: 289, offsetHeight: 200, clientHeight: 198 }
    const snap = { width: '289px', 'inline-size': '289px', height: '198px' }
    addScrollbarGutter(source, pre(base), snap)
    expect(snap).toEqual({ width: '306px', 'inline-size': '306px', height: '198px' })
  })

  it('leaves border-box, overflow:visible and overlay-scrollbar boxes untouched', () => {
    const source = { offsetWidth: 308, clientWidth: 306, offsetHeight: 200, clientHeight: 184 }
    const a = { width: '308px', height: '200px' }
    addScrollbarGutter(source, pre({ ...base, 'box-sizing': 'border-box' }), a)
    expect(a).toEqual({ width: '308px', height: '200px' })

    const b = { width: '306px', height: '184px' }
    addScrollbarGutter(source, pre({ ...base, 'overflow-x': 'visible', 'overflow-y': 'visible' }), b)
    expect(b).toEqual({ width: '306px', height: '184px' })

    const overlay = { offsetWidth: 308, clientWidth: 306, offsetHeight: 186, clientHeight: 184 }
    const c = { width: '306px', height: '184px' }
    addScrollbarGutter(overlay, pre(base), c)
    expect(c).toEqual({ width: '306px', height: '184px' })
  })

  it('end-to-end: a frozen scroll container keeps its live outer height', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = `
      .i498-scroll { width: 200px; border: 1px solid #000; overflow-x: auto; font: 20px/1.5 monospace; }
      .i498-scroll::-webkit-scrollbar { height: 14px; background: #eee; }
      .i498-scroll::-webkit-scrollbar-thumb { background: #999; }
    `
    const el = mount(document.createElement('div'))
    el.className = 'i498-scroll'
    el.innerHTML = '0123456789<br>012345678901234567890123456789<br>0123456789<br>0123456789'
    const gutter = el.offsetHeight - el.clientHeight - 2
    // Headless engines without classic scrollbars measure no gutter; the helper is covered above.
    if (gutter <= 0) return

    const { clone, classCSS } = await prepareClone(el, { embedFonts: false })
    const host = mount(document.createElement('div'))
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:400px'
    const shadow = host.attachShadow({ mode: 'open' })
    const css = document.createElement('style')
    css.textContent = classCSS + style.textContent
    shadow.append(css, clone)
    expect(clone.offsetHeight).toBe(el.offsetHeight)
    expect(clone.scrollHeight).toBeLessThanOrEqual(clone.clientHeight)
  })
})

describe('#498 fractional image dimensions', () => {
  it('records the used fractional size instead of the integer offsetWidth', async () => {
    const wrap = mount(document.createElement('div'))
    wrap.style.cssText = 'display:flex;font-size:16px'
    const inner = document.createElement('div')
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
    img.style.width = '1.6rem'
    inner.append(img, 'A BB CCC')
    wrap.appendChild(inner)
    await new Promise((r) => (img.complete ? r() : (img.onload = r)))
    expect(img.offsetWidth).toBe(26)
    expect(parseFloat(getComputedStyle(img).width)).toBeCloseTo(25.594, 2)

    const { clone } = await prepareClone(wrap, { embedFonts: false })
    const cimg = clone.querySelector('img')
    expect(parseFloat(cimg.dataset.snapdomWidth)).toBeCloseTo(25.594, 2)
    // The min-width guard must not be larger than the frozen width.
    expect(parseFloat(cimg.style.minWidth)).toBeLessThanOrEqual(25.6)
  })
})
