// A structural or sibling rule that ends in a pseudo-element splits the pseudo-elements of
// identity twins, so it has to turn the share off like the same rule on the element.
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
  el.style.cssText = 'width:200px;background:#fff'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

/** Red, blue and green pixel totals of the capture. */
async function colours(el, opts = {}) {
  const c = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false, ...opts })
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let red = 0, blue = 0, green = 0
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    if (r > 200 && g < 60 && b < 60) red++
    else if (r < 60 && g < 60 && b > 200) blue++
    else if (r < 60 && g > 100 && b < 60) green++
  }
  return { red, blue, green }
}

const LIST = (p, n) => `<ul class="${p}">` + '<li></li>'.repeat(n) + '</ul>'
const BASE = (p) => `.${p}{margin:0;padding:0;list-style:none}.${p} li{height:12px;line-height:0}` +
  `.${p} li::before{content:"";display:inline-block;width:0;height:10px;border-left:10px solid}`
const SQ = 100 // one 10x10 ::before

describe('a structural rule on a pseudo-element turns the share off', () => {
  it(':nth-child(odd/even)::before paints 3 red and 3 blue squares', async () => {
    const el = mount(LIST('b1', 6), BASE('b1') +
      '.b1 li:nth-child(odd)::before{border-left-color:rgb(255,0,0)}.b1 li:nth-child(even)::before{border-left-color:rgb(0,0,255)}')
    await settle()
    const live = [...el.querySelectorAll('li')].map((li) => getComputedStyle(li, '::before').borderLeftColor)
    expect(live.filter((c) => c === 'rgb(0, 0, 255)').length).toBe(3)
    const got = await colours(el)
    expect(got.red).toBe(3 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it(':first-child::before paints one red square, the rest blue', async () => {
    const el = mount(LIST('b2', 4), BASE('b2') +
      '.b2 li::before{border-left-color:rgb(0,0,255)}.b2 li:first-child::before{border-left-color:rgb(255,0,0)}')
    await settle()
    const got = await colours(el)
    expect(got.red).toBe(1 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it(':nth-of-type(2)::after paints exactly one green square', async () => {
    const el = mount(LIST('b3', 4), '.b3{margin:0;padding:0;list-style:none}.b3 li{height:12px;line-height:0}' +
      '.b3 li::after{content:"";display:inline-block;width:0;height:10px;border-left:10px solid rgb(0,0,255)}' +
      '.b3 li:nth-of-type(2)::after{border-left-color:rgb(0,160,0)}')
    await settle()
    const got = await colours(el)
    expect(got.green).toBe(1 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it('li + li::before paints the first square red, the rest blue', async () => {
    const el = mount(LIST('b4', 4), BASE('b4') +
      '.b4 li::before{border-left-color:rgb(255,0,0)}.b4 li + li::before{border-left-color:rgb(0,0,255)}')
    await settle()
    const got = await colours(el)
    expect(got.red).toBe(1 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it(':nth-child(even)::before border width 20px paints 3 squares and 3 double squares', async () => {
    const el = mount(LIST('b7', 6), BASE('b7') +
      '.b7 li::before{border-left-color:rgb(255,0,0)}.b7 li:nth-child(even)::before{border-left-width:20px}')
    await settle()
    const got = await colours(el)
    expect(got.red).toBe(9 * SQ)
  })

  it('background colour variant (masked by the background pass): 3 red and 3 blue', async () => {
    const el = mount(LIST('b8', 6), '.b8{margin:0;padding:0;list-style:none}.b8 li{height:12px;line-height:0}' +
      '.b8 li::before{content:"";display:inline-block;width:10px;height:10px}' +
      '.b8 li:nth-child(odd)::before{background:rgb(255,0,0)}.b8 li:nth-child(even)::before{background:rgb(0,0,255)}')
    await settle()
    const got = await colours(el)
    expect(got.red).toBe(3 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it('control: the share off paints 3 red and 3 blue on the nth-child scene', async () => {
    const el = mount(LIST('b5', 6), BASE('b5') +
      '.b5 li:nth-child(odd)::before{border-left-color:rgb(255,0,0)}.b5 li:nth-child(even)::before{border-left-color:rgb(0,0,255)}')
    await settle()
    const got = await colours(el, { __styleShare: false })
    expect(got.red).toBe(3 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })

  it('control: a structural rule on the element itself (no pseudo) keeps the share off', async () => {
    // The same split, carried by the li's own colour: the gate matches it and paints right.
    const el = mount(LIST('b6', 6), '.b6{margin:0;padding:0;list-style:none}.b6 li{height:12px;line-height:0}' +
      '.b6 li>i{display:inline-block;width:10px;height:10px;background:currentColor}' +
      '.b6 li:nth-child(odd){color:rgb(255,0,0)}.b6 li:nth-child(even){color:rgb(0,0,255)}')
    for (const li of el.querySelectorAll('li')) li.appendChild(document.createElement('i'))
    await settle()
    const got = await colours(el)
    expect(got.red).toBe(3 * SQ)
    expect(got.blue).toBe(3 * SQ)
  })
})
