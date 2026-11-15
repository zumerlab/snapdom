// A shrink-to-fit box whose text is on one line gets `nowrap` in the clone (freezeOneLine).
// When a sibling squeezes it and the text wraps, a differential frame reads the retained
// clone again and has to drop the pin, or the label stays on one line in the frame.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

let host
afterEach(() => host?.remove())

describe('differential frame and the one-line pin', () => {
  it('a label squeezed onto several lines wraps in the frame', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:200px;background:#fff;font:14px/18px Arial,sans-serif'
    // The first item's text is on one line until its sibling grows and squeezes it. Only the
    // sibling's text is edited, so the first item is a retained clone that is read again.
    host.innerHTML = '<div><div style="display:flex;align-items:flex-start;height:100px">' +
      '<div id="label">aa bb cc dd ee</div>' +
      '<div style="flex:none"><p style="margin:0;white-space:nowrap">x</p></div></div></div>'
    document.body.appendChild(host)
    const O = { scale: 1, dpr: 1, embedFonts: false }
    /** Dark pixels below the first line, inside the label: text that wrapped. */
    const wrappedInk = async (opts) => {
      const canvas = await (await snapdom(host, { ...O, ...opts })).toCanvas()
      const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      let n = 0
      for (let y = 22; y < 72; y++) {
        for (let x = 0; x < 40; x++) if (data[(y * width + x) * 4] < 80) n++
      }
      return n
    }
    for (let i = 0; i < 3; i++) await snapdom(host, O)
    host.querySelector('p').firstChild.data = 'a sibling that takes most of the row'
    expect(host.querySelector('#label').getBoundingClientRect().height).toBeGreaterThan(30)
    const served = __diffStats.served
    expect(await wrappedInk()).toBeGreaterThan(20)
    expect(__diffStats.served).toBe(served + 1)
    expect(await wrappedInk({ burst: false })).toBeGreaterThan(20)
  })
})
