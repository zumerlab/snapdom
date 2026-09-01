// An HTML element can reach an SVG def through CSS — `filter: url(#f)`, `clip-path`, `mask` —
// and those defs usually live in a hidden <svg> somewhere else in the page, outside the
// captured subtree. The collector only looked at SVG subtrees and bailed when the capture root
// contained none, so the reference was serialized dangling and the effect was silently lost.
//
// Asserted in PIXELS: the value survives in the payload either way, so a payload check would
// pass against the broken build. The filter here is a colour matrix that turns red into blue,
// which is unmistakable at one sample point.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function withDefs(id) {
  const defs = document.createElement('div')
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  // Drops the red channel and forces full blue: red in, blue out.
  defs.innerHTML = `<svg width="0" height="0"><filter id="${id}">` +
    '<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 1  0 0 0 1 0"/>' +
    '</filter></svg>'
  document.body.appendChild(defs)
  mounted.push(defs)
}

function host(html, css) {
  if (css) {
    const st = document.createElement('style')
    st.textContent = css
    document.head.appendChild(st)
    mounted.push(st)
  }
  const el = document.createElement('div')
  el.style.cssText = 'width:60px;height:60px;background:#fff'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function centre(el) {
  const c = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false })
  const d = c.getContext('2d')
    .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
  return { r: d[0], g: d[1], b: d[2] }
}

describe('url(#id) referenced from HTML', () => {
  it('applies a filter set by a class', async () => {
    withDefs('t-class')
    const el = host('<div class="t-uses" style="width:60px;height:60px;background:rgb(255,0,0)"></div>',
      '.t-uses { filter: url(#t-class); }')
    const px = await centre(el)
    expect(px.b).toBeGreaterThan(180)
    expect(px.r).toBeLessThan(80)
  })

  it('applies a filter set inline', async () => {
    withDefs('t-inline')
    const el = host('<div style="width:60px;height:60px;background:rgb(255,0,0);filter:url(#t-inline)"></div>')
    const px = await centre(el)
    expect(px.b).toBeGreaterThan(180)
    expect(px.r).toBeLessThan(80)
  })

  it('leaves an unfiltered element alone', async () => {
    withDefs('t-unused')
    const el = host('<div style="width:60px;height:60px;background:rgb(255,0,0)"></div>')
    const px = await centre(el)
    expect(px.r).toBeGreaterThan(180)
    expect(px.b).toBeLessThan(80)
  })
})
