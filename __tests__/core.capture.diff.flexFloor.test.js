// A flex item's min-width floor follows whether its row overflows. On a differential frame
// only the box that changed drifts, so the row is asked again and its other items re-read:
// they keep their width when the row starts to overflow and may shrink again when it stops.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

let host
afterEach(() => host?.remove())

/** First blue column on row y=10 of a capture: where the second item starts. */
const blueStart = async (el, opts) => {
  const canvas = await (await snapdom(el, { scale: 1, dpr: 1, embedFonts: false, ...opts })).toCanvas()
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let x = 0; x < width; x++) {
    const i = (10 * width + x) * 4
    if (data[i] < 60 && data[i + 2] > 200) return x
  }
  return -1
}

describe('differential frame and the flex floor', () => {
  for (const [name, from, to] of [['starts', 50, 300], ['stops', 300, 50]]) {
    it(`a row that ${name} overflowing because a sibling's content changed`, async () => {
      host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:0;top:0;width:300px;background:#fff'
      // Red item of 100px, then a blue item whose content is `from` wide, in a 200px row.
      host.innerHTML = '<div><div style="display:flex;width:200px;height:20px">' +
        '<div style="background:rgb(255,0,0)"><i style="display:block;width:100px;height:20px"></i></div>' +
        `<div style="background:rgb(0,0,255)"><i style="display:block;width:${from}px;height:20px"></i></div>` +
        '</div></div>'
      document.body.appendChild(host)
      const inner = host.querySelectorAll('i')[1]
      for (let i = 0; i < 3; i++) await snapdom(host, { scale: 1, dpr: 1, embedFonts: false })
      inner.style.width = to + 'px'
      const live = Math.round(inner.parentElement.getBoundingClientRect().left - host.getBoundingClientRect().left)
      const served = __diffStats.served
      expect(await blueStart(host)).toBe(live)
      expect(__diffStats.served).toBe(served + 1)
      expect(await blueStart(host, { burst: false })).toBe(live)
    })
  }
})
