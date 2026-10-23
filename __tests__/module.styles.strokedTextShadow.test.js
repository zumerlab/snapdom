// #531: WebKit paints no text-shadow under -webkit-text-stroke inside an SVG foreignObject
// image, so stroked text lost its shadow in the capture. On Safari the clone swaps that shadow
// for an equivalent drop-shadow filter (strokedTextShadowToFilter, src/modules/styles.js);
// every engine must paint the shadow about as much as the live page does.
import { describe, it, expect, afterEach } from 'vitest'
import { page } from 'vitest/browser'
import { snapdom } from '../src/index.js'

let host
afterEach(() => { host?.remove(); host = null })

const magentaIn = async (url) => {
  const img = new Image(); img.src = url; await img.decode()
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let m = 0
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128 && d[i] - d[i + 1] > 60 && d[i + 2] - d[i + 1] > 60) m++
  return m
}

describe('stroked text keeps its text-shadow (#531)', () => {
  // A transparent background written as oklch() serializes that way in WebKit and read as opaque.
  for (const [shadow, bg] of [['3px 3px 0 #f0f', 'none'], ['2px 4px 4px #f0f', 'none'], ['3px 3px 0 #f0f', 'oklch(0.5 0.1 30 / 0)']]) {
    // Timed out at the 15 s default in WebKit during a full parallel run (2026-10-23), on
    // the page.viewport/page.screenshot round-trips this test needs.
    it(`paints ${shadow} like the live page (background ${bg})`, async () => {
      // A viewport the runner window holds at 1:1, or the screenshot comes back scaled.
      await page.viewport(800, 600)
      host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:10px;top:10px;padding:8px;background:#fff'
      host.innerHTML = `<div style="font:900 36px Arial;color:#ff0;-webkit-text-stroke:2px #000;text-shadow:${shadow};background:${bg}">Stroke</div>`
      document.body.appendChild(host)
      const shot = await page.screenshot({ element: host, base64: true, save: false })
      const live = await magentaIn('data:image/png;base64,' + (shot.base64 || shot))
      const canvas = await snapdom.toCanvas(host, { dpr: 1, burst: false })
      const got = await magentaIn(canvas.toDataURL())
      expect(live).toBeGreaterThan(200)
      expect(got / live).toBeGreaterThan(0.6)
      expect(got / live).toBeLessThan(1.5)
    }, 30_000)
  }
})
