// #542: the internal font key joined family, weight, style and stretch with `__`, and split
// on it again. A family whose name holds `__` (Next.js dev overlay's `__nextjs-Geist`, the
// `__Inter_abc123` names next/font generates) split into the wrong parts and was never
// embedded, so the capture fell back to another font.
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const ROBOTO = '/demos/assets/fonts/roboto/roboto-latin.woff2'
let host, style
afterEach(() => { host?.remove(); style?.remove(); host = style = null })

// Width of the dark ink of one line: Roboto and the fallback differ by tens of pixels.
const inkWidth = (canvas) => {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let min = Infinity, max = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (d[i + 3] > 200 && d[i] < 100) { min = Math.min(min, x); max = Math.max(max, x) }
    }
  }
  return max - min
}

describe('a family name with `__` is embedded (#542)', () => {
  for (const family of ['__nextjs-Geist', '__Inter_abc123', 'Brand__Display']) {
    it(family, async () => {
      style = document.createElement('style')
      style.textContent = `@font-face{font-family:'${family}';src:url('${ROBOTO}') format('woff2')}`
      document.head.appendChild(style)
      host = document.createElement('div')
      host.style.cssText = `display:inline-block;padding:4px;font:24px '${family}', serif;color:#000;background:#fff`
      host.textContent = 'Wide waves of jumbled text'
      document.body.appendChild(host)
      await document.fonts.load(`24px '${family}'`)
      const live = host.getBoundingClientRect().width
      const res = await snapdom(host, { embedFonts: true, cache: 'disabled' })
      const svg = decodeURIComponent(res.url.split(',')[1])
      expect(svg).toMatch(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*["']?${family}`))
      // The capture paints the text in the font too, not only declares it.
      const canvas = await res.toCanvas()
      expect(Math.abs(inkWidth(canvas) - (live - 8))).toBeLessThan(6)
    })
  }
})
