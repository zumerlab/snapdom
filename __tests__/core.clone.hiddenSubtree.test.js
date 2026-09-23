// Nothing under a display:none element paints, so deepClone keeps an emptied shell of it
// instead of cloning, styling and fetching its whole subtree (#507). What the shell must keep,
// and its exemptions, are pinned here in pixels where they can paint.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

afterEach(() => { document.body.innerHTML = '' })

const opts = { cache: 'disabled', burst: false, embedFonts: false, dpr: 1, scale: 1 }
const svgOf = async (el, o = opts) => decodeURIComponent((await snapdom(el, o)).url.split(',')[1])

async function countPx(el, pred, o = opts) {
  const c = await (await snapdom(el, o)).toCanvas()
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (pred(d[i], d[i + 1], d[i + 2], d[i + 3])) n++
  return n
}
const red = (r, g, b, a) => a > 200 && r > 200 && g < 50 && b < 50
const dark = (r, g, b, a) => a > 200 && r < 100 && g < 100 && b < 100

function mount(html, css = 'width:200px') {
  const host = document.createElement('div')
  host.style.cssText = css
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('deepClone: display:none subtrees (#507)', () => {
  it('keeps an empty shell of the hidden element and drops its content', async () => {
    const host = mount('<nav class="menu" style="display:none"><a href="#">hidden-item</a><img src="/hidden-507.png"></nav><div style="width:50px;height:50px;background:rgb(255,0,0)"></div>')
    const svg = await svgOf(host)
    expect(svg).toContain('class="menu')
    expect(svg).not.toContain('hidden-item')
    expect(svg).not.toContain('hidden-507.png')
    expect(await countPx(host, red)).toBe(2500)
  })

  it('a hidden <img> shell carries no src, so nothing is fetched for it', async () => {
    const host = mount('<img src="/hidden-img-507.png" style="display:none"><span>x</span>')
    const spy = vi.spyOn(window, 'fetch')
    try {
      await svgOf(host)
      expect(spy.mock.calls.some(([u]) => String(u?.url ?? u).includes('hidden-img-507'))).toBe(false)
    } finally { spy.mockRestore() }
  })

  it('keeps <style> elements nested in a hidden wrapper', async () => {
    const host = mount('<span style="display:none"><b><style>.box507{width:40px;height:40px;background:rgb(255,0,0)}</style></b></span><div class="box507"></div>')
    expect(await svgOf(host)).toContain('.box507{')
    expect(await countPx(host, red)).toBe(1600)
  })

  it('still paints a <select> whose selected placeholder option is hidden', async () => {
    const host = mount('<select style="font:20px sans-serif;width:200px;color:#000"><option value="" hidden selected>Choose one</option><option>AAAAAAAAAAAA</option></select>')
    // Measured 473 dark pixels with the option kept, 22 once it was dropped.
    expect(await countPx(host, dark)).toBeGreaterThan(200)
  })

  it('an icon sprite inside a hidden HTML wrapper still reaches its <use>', async () => {
    const host = mount('<div hidden><svg><symbol id="s507" viewBox="0 0 10 10"><rect width="10" height="10" fill="rgb(255,0,0)"/></symbol></svg></div><svg width="50" height="50"><use href="#s507"/></svg>')
    expect(await countPx(host, red)).toBe(2500)
  })

  it('an element shown after a capture renders on the next memoized capture', async () => {
    const host = mount('<div id="late507" style="display:none;width:30px;height:30px;background:rgb(255,0,0)"></div>')
    const memo = { embedFonts: false, dpr: 1, scale: 1 }
    expect(await countPx(host, red, memo)).toBe(0)
    host.querySelector('#late507').style.display = 'block'
    expect(await countPx(host, red, memo)).toBe(900)
  })

  it('the capture root itself is cloned even when it is display:none', async () => {
    const host = mount('<span>root-content-507</span>', 'display:none')
    expect(await svgOf(host)).toContain('root-content-507')
  })
})
