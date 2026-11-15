// A flex item's min-width floor depends on whether its row overflows, which belongs to the
// row and the capture, not to the item's cached or shared style snapshot.
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
  el.style.cssText = 'width:500px;background:#fff'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

/** Red and blue runs on canvas row y: count and first x of each. */
async function rows(el, ys, opts = {}) {
  const c = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false, ...opts })
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  return ys.map((y) => {
    let red = 0, blue = 0, firstBlue = -1
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++
      if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] > 200) { blue++; if (firstBlue < 0) firstBlue = x }
    }
    return { red, blue, firstBlue }
  })
}

const ROW = (p) => `.${p}r{display:flex;width:200px;height:20px}` +
  `.${p}x{background:rgb(255,0,0)}.${p}x>i,.${p}y>i,.${p}z>i{display:block;height:20px}` +
  `.${p}x>i{width:100px}.${p}y>i{width:50px}.${p}z>i{width:300px}` +
  `.${p}y,.${p}z{background:rgb(0,0,255)}`

describe('flex min-width floor', () => {
  it('twins: an X under an overflowing row keeps its 100px after two non-overflowing twins', async () => {
    // Rows 1-2: X(100) + Y(50) in 200px, no overflow, floor 0px. Row 3: X(100) + Z(300),
    // overflow, floor must be X's width. Live: X stays 100px, Z starts at x=100.
    const el = mount(
      '<div class="a1r"><div class="a1x"><i></i></div><div class="a1y"><i></i></div></div>'.repeat(2) +
      '<div class="a1r"><div class="a1x"><i></i></div><div class="a1z"><i></i></div></div>',
      ROW('a1'))
    await settle()
    const live = el.children[2].children[1].getBoundingClientRect().left - el.getBoundingClientRect().left
    expect(live).toBe(100)
    const [r1, r2, r3] = await rows(el, [10, 30, 50])
    expect(r1.red).toBe(100)
    expect(r2.red).toBe(100)
    expect(r3.red).toBe(100)
    expect(r3.firstBlue).toBe(100)
  })

  it('control: with the share off the same scene paints X at 100px in row 3', async () => {
    const el = mount(
      '<div class="a2r"><div class="a2x"><i></i></div><div class="a2y"><i></i></div></div>'.repeat(2) +
      '<div class="a2r"><div class="a2x"><i></i></div><div class="a2z"><i></i></div></div>',
      ROW('a2'))
    await settle()
    const [, , r3] = await rows(el, [10, 30, 50], { __styleShare: false, cache: 'disabled' })
    expect(r3.red).toBe(100)
    expect(r3.firstBlue).toBe(100)
  })

  it('control can register: a row whose X has min-width:0 live paints X collapsed', async () => {
    // The live geometry of the suspected wrong class: proves the pixel count tells them apart.
    const el = mount(
      '<div class="a3r"><div class="a3x" style="min-width:0"><i></i></div><div class="a3z"><i></i></div></div>',
      ROW('a3'))
    await settle()
    const [r] = await rows(el, [10])
    expect(r.firstBlue).toBe(0)
    expect(r.red).toBe(0)
  })

  it('recapture: X served from the cache after a sibling grows the row into overflow', async () => {
    // Capture 1: X(100) + S(50), no overflow, X's floor 0px. Then S's grandchild grows to
    // 300px (an attribute mutation that stamps S's subtree and ancestors, not X). X's box
    // holds, so its snapshot is served; the floor must now be 100px.
    const el = mount(
      '<div class="a4r"><div class="a4x"><i></i></div><div class="a4y"><span><b style="display:inline-block;width:50px;height:20px"></b></span></div></div>',
      ROW('a4') + '.a4y{white-space:nowrap;line-height:0}')
    await settle()
    const [before] = await rows(el, [10])
    expect(before.red).toBe(100)
    el.querySelector('b').style.width = '300px'
    await settle()
    const live = el.querySelector('.a4y').getBoundingClientRect().left - el.getBoundingClientRect().left
    expect(live).toBe(100)
    const [after] = await rows(el, [10])
    expect(after.firstBlue).toBe(100)
    expect(after.red).toBe(100)
  })

  it('control: the same final state captured fresh paints X at 100px', async () => {
    const el = mount(
      '<div class="a5r"><div class="a5x"><i></i></div><div class="a5y"><span><b style="display:inline-block;width:300px;height:20px"></b></span></div></div>',
      ROW('a5') + '.a5y{white-space:nowrap;line-height:0}')
    await settle()
    const [r] = await rows(el, [10])
    expect(r.firstBlue).toBe(100)
    expect(r.red).toBe(100)
  })
})
