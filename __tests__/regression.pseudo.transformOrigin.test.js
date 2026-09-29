// Regression #509: a pseudo with `transform: scale()` and no authored transform-origin
// scaled toward its top-left corner. The pseudo snapshot reads only the props a pseudo
// rule names, and the origin reads as used px (`20px 20px`), so it fell back to the
// base rule's `0px 0px`. Asserts on painted pixels: the dot must sit in the centre.

import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let styleEl, host

afterEach(() => {
  styleEl?.remove()
  host?.remove()
})

it('centres a scaled ::after around its own box (#509)', async () => {
  styleEl = document.createElement('style')
  styleEl.textContent = `
    .r509 { position: relative; width: 42px; height: 42px; display: inline-flex; align-items: center;
      justify-content: center; box-sizing: border-box; background: rgb(0, 0, 255); border: 1px solid rgb(0, 0, 255); }
    .r509::after { content: ""; position: absolute; width: 100%; height: 100%; display: block;
      background: rgb(255, 255, 255); transform: scale(.375); }
  `
  document.head.appendChild(styleEl)
  host = document.createElement('div')
  host.style.cssText = 'display:inline-block;line-height:0'
  host.innerHTML = '<span class="r509"></span>'
  document.body.appendChild(host)

  const canvas = await (await snapdom(host, { scale: 1 })).toCanvas()
  const ctx = canvas.getContext('2d')
  const red = (x, y) => ctx.getImageData(x, y, 1, 1).data[0]
  // The 40px padding box scales to 15px: centred it spans 13.5..28.5, from the corner 1..16.
  expect(red(21, 21)).toBeGreaterThan(200)
  expect(red(6, 6)).toBeLessThan(50)
})
