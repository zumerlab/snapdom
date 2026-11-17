// An @font-face rebuilt from CSSOM dropped the descriptors that size the glyphs: under
// `size-adjust: 200%` the capture drew the text at half the width of the page.
import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

it('text in a face with size-adjust keeps the width of the page', async () => {
  const style = document.createElement('style')
  style.textContent = '@font-face{font-family:SdAdjusted;src:url(/__tests__/fixtures/fonts/inter-400.woff2);size-adjust:200%}'
  document.head.appendChild(style)
  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;left:0;top:0;width:600px;height:60px;background:#fff;color:#000'
  root.innerHTML = '<span style="font:20px/1 SdAdjusted;white-space:nowrap">HHHHHHHH</span>'
  document.body.appendChild(root)
  mounted.push(style, root)
  await document.fonts.load('20px SdAdjusted')
  const live = root.firstChild.getBoundingClientRect().width
  const canvas = await snapdom.toCanvas(root, { dpr: 1, scale: 1, burst: false, embedFonts: true })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let lo = canvas.width, hi = -1
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 80) { const x = i / 4 % canvas.width; lo = Math.min(lo, x); hi = Math.max(hi, x) }
  }
  // Ink is a few px narrower than the advance box, never half of it.
  expect(hi - lo + 1, `live ${live}`).toBeGreaterThan(live * 0.9)
})
