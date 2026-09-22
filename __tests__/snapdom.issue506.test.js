import { afterEach, describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'

const mounted = []
let previousViewport
afterEach(async () => {
  while (mounted.length) mounted.pop().remove()
  for (const frame of document.querySelectorAll('iframe[data-snapdom-internal]')) frame.remove()
  if (previousViewport) {
    await page.viewport(...previousViewport)
    previousViewport = null
  }
})

describe('first raster of an embedded web font (#506)', { timeout: 30_000 }, () => {
  it.each(['toCanvas', 'toPng'])('paints loaded glyphs in the first %s export', async (exporter) => {
    previousViewport = [window.innerWidth, window.innerHeight]
    await page.viewport(500, 300)
    const family = `Issue506${exporter}`
    const style = document.createElement('style')
    // MathJax's zero-width face has no letter glyphs. Chromium must load the following
    // font after inspecting it; Image.decode() used to resolve before that fallback painted.
    style.textContent = `@font-face{font-family:${family}Zero;src:url('/__tests__/fixtures/fonts/mathjax-zero.woff2') format('woff2')}
      @font-face{font-family:${family};src:url('/__tests__/fixtures/fonts/jbmono-400.woff2') format('woff2')}`
    document.head.appendChild(style)
    mounted.push(style)
    const root = document.createElement('div')
    root.style.cssText = `width:400px;height:80px;background:white;color:black;font:32px/80px ${family}Zero,${family},serif`
    root.textContent = 'Hamburgefontsiv 123'
    document.body.appendChild(root)
    mounted.push(root)
    await document.fonts.load(`32px ${family}Zero,${family}`, root.textContent)
    await document.fonts.ready
    const screenshot = await page.screenshot({ element: root, base64: true })
    const live = new Image()
    live.src = 'data:image/png;base64,' + screenshot.base64
    await live.decode()
    const result = await snapdom(root, { embedFonts: true, burst: false, cache: 'disabled', scale: 1, dpr: 1 })
    expect(decodeURIComponent(result.url)).toMatch(/@font-face[^}]+data:(?:font|application)\//)
    const output = await result[exporter]()
    const canvas = document.createElement('canvas')
    canvas.width = live.naturalWidth
    canvas.height = live.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(output, 0, 0, canvas.width, canvas.height)
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(live, 0, 0)
    const expected = context.getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    let expectedInk = 0
    let differing = 0
    for (let i = 0; i < actual.length; i += 4) {
      if (actual[i] < 100 && actual[i + 3] > 200) ink++
      if (expected[i] < 100 && expected[i + 3] > 200) expectedInk++
      if ([0, 1, 2, 3].some(channel => Math.abs(actual[i + channel] - expected[i + channel]) > 40)) differing++
    }
    expect(expectedInk).toBeGreaterThan(500)
    expect(ink).toBeGreaterThan(expectedInk * 0.8)
    expect(differing / (canvas.width * canvas.height)).toBeLessThan(0.05)
  })
})
