import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// #327: iOS WebKit re-applies text-size-adjust when rasterizing the SVG,
// inflating font-size inside the foreignObject while container heights
// stay fixed. Emit `text-size-adjust: 100%` as a CSS rule in the SVG
// <style> so it overrides the `all: initial` reset on the container.
describe('capture — text-size-adjust in SVG output (#327)', () => {
  function svgFromDataURL(url) {
    const i = url.indexOf(',')
    return i >= 0 ? decodeURIComponent(url.slice(i + 1)) : ''
  }

  it('emits text-size-adjust:100% with !important in the SVG style rule', async () => {
    const el = document.createElement('div')
    el.textContent = 'hi'
    el.style.cssText = 'width:80px;height:40px;font-size:14px'
    document.body.appendChild(el)
    const url = await snapdom.toRaw(el)
    document.body.removeChild(el)
    const svg = svgFromDataURL(url)
    // Must have both the -webkit- prefix (WebKit only accepts prefixed) and
    // the unprefixed standard name, both with !important to beat inline styles.
    expect(svg).toMatch(/-webkit-text-size-adjust\s*:\s*100%\s*!important/)
    expect(svg).toMatch(/[^-]text-size-adjust\s*:\s*100%\s*!important/)
  })
})
