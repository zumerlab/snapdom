import { it, expect } from 'vitest'
import { snapdom } from '../src/index.js'

it.each([2.625, 2.7272727])('retains every thin border at DPR %s in a DPR 1 export', async dpr => {
  const ownDPR = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
  const fixture = document.createElement('div')
  fixture.innerHTML = '<div style="display:inline-block;background:white;color:white;padding:5px;font:16px monospace">' +
    Array.from({ length: 20 }, (_, i) => `<div style="display:inline-block;box-sizing:border-box;width:40px;height:24px;border:${(20 - i) / 20}px solid black;padding:1px;margin:4px">${(20 - i) / 20}</div>`).join('') + '</div>'
  document.body.append(fixture)
  try {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr })
    const root = fixture.firstElementChild
    const result = await snapdom(root, { embedFonts: false })
    const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1)), 'image/svg+xml')
    const cloned = svg.querySelector('foreignObject > div > div').children
    const css = [...svg.querySelectorAll('style')].map(el => el.textContent).join('\n')
    for (let i = 0; i < root.children.length; i++) {
      const used = getComputedStyle(root.children[i]).borderLeftWidth
      const declarations = document.createElement('div').style
      declarations.cssText = [...cloned[i].classList].map(cls =>
        (css.match(new RegExp(`\\.${cls}\\{([^}]*)\\}`)) || [])[1] || ''
      ).join(';') + ';' + (cloned[i].getAttribute('style') || '')
      expect(declarations.borderLeftWidth).toBe(used)
      expect(declarations.borderTopWidth).toBe(used)
    }
    const canvas = await result.toCanvas({ dpr: 1 })
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    const origin = root.getBoundingClientRect()
    const sx = width / origin.width, sy = height / origin.height
    for (const box of root.children) {
      const r = box.getBoundingClientRect()
      const y0 = Math.ceil((r.top - origin.top) * sy + 3)
      const y1 = Math.floor((r.bottom - origin.top) * sy - 3)
      const expectedInk = parseFloat(getComputedStyle(box).borderLeftWidth) * sx * 255
      for (const edge of [r.left, r.right]) {
        const x = Math.floor((edge - origin.left) * sx)
        let ink = 0, coverage = 0
        for (let y = y0; y < y1; y++) {
          let darkest = 255
          for (let k = -1; k <= 1; k++) {
            const value = data[4 * (y * width + x + k)]
            darkest = Math.min(darkest, value)
            coverage += 255 - value
          }
          if (darkest < 245) ink++
        }
        expect(ink, `${box.textContent}px border at x=${x}`).toBeGreaterThan((y1 - y0) * 0.8)
        // Bilinear downsampling varies with the edge's phase. A used 1px edge
        // must still retain at least 0.4px of ink; the authored 0.05px failed this.
        expect(coverage / (y1 - y0), `${box.textContent}px border coverage`).toBeGreaterThan(expectedInk * 0.4)
      }
    }
  } finally {
    fixture.remove()
    if (ownDPR) Object.defineProperty(window, 'devicePixelRatio', ownDPR)
    else delete window.devicePixelRatio
  }
})
