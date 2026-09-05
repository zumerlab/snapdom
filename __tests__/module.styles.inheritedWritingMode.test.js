import { afterEach, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => { host?.remove(); host = null })

it('captures vertical writing inherited from an inline-styled ancestor', async () => {
  host = document.createElement('div')
  host.style.cssText = 'writing-mode:vertical-rl;text-orientation:upright'
  const root = document.createElement('div')
  root.style.cssText = 'width:80px;height:180px;background:white;color:black;font:24px Arial;line-height:1.2'
  root.textContent = 'ABCD'
  host.appendChild(root)
  document.body.appendChild(host)

  const computed = getComputedStyle(root)
  expect(computed.writingMode).toBe('vertical-rl')
  expect(computed.textOrientation).toBe('upright')
  const options = { cache: 'disabled', burst: false, embedFonts: false, dpr: 1, scale: 1 }
  const inherited = await snapdom.toCanvas(root, options)

  // Declaring the same computed values on the capture root must not change its pixels.
  // Both forms paint identically on the page; only the inherited form used to escape the
  // stylesheet-derived property universe when no author rule mentioned these properties.
  root.style.writingMode = 'vertical-rl'
  root.style.textOrientation = 'upright'
  const explicit = await snapdom.toCanvas(root, options)
  expect([inherited.width, inherited.height]).toEqual([explicit.width, explicit.height])
  const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const a = pixels(inherited), b = pixels(explicit)
  let changed = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 4) changed++
  expect(changed / a.length).toBeLessThan(0.001)
}, 15000)
