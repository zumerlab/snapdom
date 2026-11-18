// The document scan costs by the rule and saves by the element, so a document is scanned
// once its captures can pay for it (SCAN_RULES_PER_ELEMENT, core/changes.js). Until then a
// capture gets the conservative answers: 10,000 rules beside one element, first capture
// 115.9 to 25.3 ms in Chromium.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { scanFor, getStyleEnvEpoch } from '../src/core/changes.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, rules) {
  const style = document.createElement('style')
  style.textContent = Array.from({ length: rules }, (_, i) => `.sb-none-${i}{outline-offset:${i}px}`).join('') +
    '.sb-box{width:120px;height:40px;background:rgb(0,128,0)}.sb-box::before{content:"";display:block;width:20px;height:20px;background:rgb(255,0,0)}'
  const root = document.createElement('div')
  root.innerHTML = html
  document.head.appendChild(style)
  document.body.appendChild(root)
  mounted.push(style, root)
  return root
}

async function pixels(el) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, scale: 1, burst: false, embedFonts: false })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0, green = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] < 60) red++
    else if (d[i + 1] > 100 && d[i] < 60) green++
  }
  return { red, green }
}

describe('the scan waits until the captures can pay for it', () => {
  it('a small capture beside a large sheet is not scanned, and paints the same', async () => {
    const root = mount('<div class="sb-box"></div>', 5000)
    const got = await pixels(root.firstChild)
    expect(scanFor(document).universe).toBe(null)
    expect(scanFor(document).declined).toBeGreaterThan(5000)
    expect(got).toEqual({ red: 400, green: 4400 })
  })

  it('an image gets no pseudo-element from the ungated probe', async () => {
    const root = mount('<p>a<img alt="" width="10" height="10">b</p>', 5000)
    const res = await snapdom(root.firstChild, { burst: false, embedFonts: false })
    expect(scanFor(document).universe).toBe(null)
    expect(decodeURIComponent(res.url)).not.toContain('moz-alt-content')
  })

  it('the document is scanned once enough elements were captured, and what came before holds', async () => {
    const root = mount('<div class="sb-box"></div>' + '<p>row</p>'.repeat(600), 5000)
    const before = await pixels(root.firstChild)
    expect(scanFor(document).universe).toBe(null)
    const env = getStyleEnvEpoch()
    await snapdom(root, { burst: false, embedFonts: false })
    expect(scanFor(document).universe.has('outline-offset')).toBe(true)
    // No epoch moves with the scan, so a memo made before it is still served.
    expect(getStyleEnvEpoch()).toBe(env)
    // The box was read without a universe above and is served from that snapshot here.
    expect(await pixels(root.firstChild)).toEqual(before)
    expect(before).toEqual({ red: 400, green: 4400 })
  })
})
