// Container-query units outside @container: twins under query containers of different sizes
// compute different px, so a rule that makes a container turns the share off.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { flushStyleInvalidations } from '../src/core/changes.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, css) {
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
  mounted.push(st)
  const el = document.createElement('div')
  el.style.cssText = 'width:400px;background:#fff'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

async function canvasOf(el, opts = {}) {
  const c = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false, ...opts })
  return { c, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data }
}

/** Red pixels on row y between x0 and x1. */
function redRun({ c, d }, y, x0, x1) {
  let n = 0
  for (let x = x0; x < x1; x++) {
    const i = (y * c.width + x) * 4
    if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++
  }
  return n
}

/** Height of the dark ink (text) in columns x0..x1. */
function inkHeight({ c, d }, x0, x1) {
  let top = -1, bottom = -1
  for (let y = 0; y < c.height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * c.width + x) * 4
      if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100 && d[i + 3] > 200) {
        if (top < 0) top = y
        bottom = y
        break
      }
    }
  }
  return top < 0 ? 0 : bottom - top + 1
}

// Two twin query containers in grid columns of 100px and 300px (one attribute set, so the
// twins below them keep one ancestor chain).
const GRID = (p) => `.${p}g{display:grid;grid-template-columns:100px 300px;align-items:start}` +
  `.${p}c{container-type:inline-size}`

describe('cq units on identity twins under different containers', () => {
  it('padding-left:10cqw is 10px and 30px under 100px and 300px containers', async () => {
    const el = mount(
      '<div class="c1g"><div class="c1c"><div class="c1b"><i></i></div></div><div class="c1c"><div class="c1b"><i></i></div></div></div>',
      GRID('c1') + '.c1b{padding-left:10cqw;background:rgb(255,0,0)}.c1b>i{display:block;height:20px;background:rgb(0,0,255)}')
    await settle()
    const boxes = el.querySelectorAll('.c1b')
    expect(getComputedStyle(boxes[0]).paddingLeft).toBe('10px')
    expect(getComputedStyle(boxes[1]).paddingLeft).toBe('30px')
    const cv = await canvasOf(el)
    expect(redRun(cv, 10, 0, 100)).toBe(10)
    expect(redRun(cv, 10, 100, 400)).toBe(30)
  })

  it('font-size:10cqi paints 10px and 30px glyphs under 100px and 300px containers', async () => {
    const el = mount(
      '<div class="c2g"><div class="c2c"><div class="c2t">H</div></div><div class="c2c"><div class="c2t">H</div></div></div>',
      GRID('c2') + '.c2t{font:10cqi/1 Arial,sans-serif;color:#000}')
    await settle()
    const t = el.querySelectorAll('.c2t')
    expect(getComputedStyle(t[1]).fontSize).toBe('30px')
    const cv = await canvasOf(el)
    const narrow = inkHeight(cv, 0, 100)
    const wide = inkHeight(cv, 100, 400)
    // Cap height of Arial is ~0.72em: ~7px and ~21px.
    expect(wide).toBeGreaterThan(narrow * 2)
  })

  it('border-left-width:5cqw is 5px and 15px (border widths are never re-read)', async () => {
    const el = mount(
      '<div class="c3g"><div class="c3c"><div class="c3b"></div></div><div class="c3c"><div class="c3b"></div></div></div>',
      GRID('c3') + '.c3b{height:20px;border-left:5cqw solid rgb(255,0,0)}')
    await settle()
    const cv = await canvasOf(el)
    expect(redRun(cv, 10, 0, 100)).toBe(5)
    expect(redRun(cv, 10, 100, 400)).toBe(15)
  })

  it('control: the share off paints the 30px padding in the wide column', async () => {
    const el = mount(
      '<div class="c4g"><div class="c4c"><div class="c4b"><i></i></div></div><div class="c4c"><div class="c4b"><i></i></div></div></div>',
      GRID('c4') + '.c4b{padding-left:10cqw;background:rgb(255,0,0)}.c4b>i{display:block;height:20px;background:rgb(0,0,255)}')
    await settle()
    const cv = await canvasOf(el, { __styleShare: false })
    expect(redRun(cv, 10, 0, 100)).toBe(10)
    expect(redRun(cv, 10, 100, 400)).toBe(30)
  })

  it('control: a %-padding twin (scan flags it unstable) keeps its own 30px', async () => {
    const el = mount(
      '<div class="c5g"><div class="c5c"><div class="c5b"><i></i></div></div><div class="c5c"><div class="c5b"><i></i></div></div></div>',
      GRID('c5') + '.c5b{padding-left:10%;background:rgb(255,0,0)}.c5b>i{display:block;height:20px;background:rgb(0,0,255)}')
    await settle()
    const cv = await canvasOf(el)
    expect(redRun(cv, 10, 100, 400)).toBe(30)
  })
})
