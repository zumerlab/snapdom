// #508: rows stacked in a container drifted out of it on phones.
//
// Browsers snap border widths to whole device pixels and getComputedStyle reports the snapped
// width: at devicePixelRatio 2.625 a `1px` border reads `0.761905px`. The svg image lays out
// at 1x and snaps it again to 1px, so every row whose content-box height was frozen grew by
// the difference and the last rows fell out of their container.
//
// The headless runner has a devicePixelRatio of 1. `zoom` on an ANCESTOR of the captured node
// produces the same snapped value on every engine (1px under zoom 1.3125 is 1.3125 device
// pixels, floored to 1, read back as 0.761905px), and the capture never sees that ancestor.

import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const ROWS = 40
const mounted = []
afterEach(() => { for (const el of mounted.splice(0)) el.remove() })

function scene(rowStyle, rowInner = '') {
  const zoom = document.createElement('div')
  zoom.style.zoom = '1.3125'
  const root = document.createElement('div')
  root.style.cssText = 'width:120px;background:#fff;display:flow-root'
  for (let i = 0; i < ROWS; i++) {
    const row = document.createElement('div')
    row.style.cssText = rowStyle + (i === ROWS - 1 ? ';background:#f00' : ';background:#0f0')
    row.innerHTML = rowInner
    root.appendChild(row)
  }
  zoom.appendChild(root)
  document.body.appendChild(zoom)
  mounted.push(zoom)
  return root
}

/** Pixels of the capture matching an rgb predicate. */
async function count(root, pred) {
  const canvas = await (await snapdom(root, { scale: 1, dpr: 1, cache: 'disabled' })).toCanvas()
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let n = 0
  for (let i = 0; i < data.length; i += 4) if (pred(data[i], data[i + 1], data[i + 2])) n++
  return { n, canvas }
}
const red = (r, g, b) => r > 200 && g < 60 && b < 60

describe('#508 borders snapped to a fractional width', () => {
  it('the precondition holds: the live border reads fractional', () => {
    const root = scene('height:10px;border:1px solid #00f')
    expect(parseFloat(getComputedStyle(root.firstChild).borderTopWidth)).toBeLessThan(1)
  })

  it('keeps the last of 40 bordered rows inside its container', async () => {
    const root = scene('height:10px;border:1px solid #00f')
    const { n, canvas } = await count(root, red)
    // Drifted 40 × 0.476px ≈ 19px: the whole red row sat below the image. Inside the 1px
    // border the svg paints, its background is 118 × ~9.5 px.
    expect(n).toBeGreaterThan(118 * 7)
    // And it is the bottom row of the image, not somewhere above a blank strip.
    const { data } = canvas.getContext('2d').getImageData(0, canvas.height - 3, canvas.width, 1)
    expect(red(data[4 * 60], data[4 * 60 + 1], data[4 * 60 + 2])).toBe(true)
  })

  // The content box ends up ~0.5px smaller than its live content, and an `auto` scroller
  // shows a scrollbar for that sliver: real Chrome at DPR 2.625 drew one under every row.
  // The runner cannot see it (Playwright launches headless with --hide-scrollbars), so this
  // pins the decision in the emitted CSS: clip without a bar where the live box had nothing
  // to scroll, keep `auto` where it had. The rows are identity twins that differ only in
  // content, which is what the twin signature has to tell apart.
  it('clips an idle auto scroller without a scrollbar, keeps a scrolling twin auto', async () => {
    const root = scene('height:10px;overflow:auto;border:1px solid #00f', '<i style="display:block;height:10px"></i>')
    root.children[5].firstChild.style.height = '30px'
    expect(root.children[5].scrollHeight).toBeGreaterThan(root.children[5].clientHeight)
    expect(root.children[0].scrollHeight).toBeLessThanOrEqual(root.children[0].clientHeight)

    const res = await snapdom(root, { cache: 'disabled' })
    const svg = new DOMParser().parseFromString(decodeURIComponent(res.url.slice(res.url.indexOf(',') + 1)), 'image/svg+xml')
    const css = [...svg.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    // The foreignObject's first div is snapdom's wrapper; the captured root is inside it.
    const rows = svg.querySelector('foreignObject > div > div').children
    const ruleOf = (el) => {
      const cls = [...el.classList].find((c) => new RegExp(`\\.${c}\\{`).test(css))
      return css.match(new RegExp(`\\.${cls}\\{([^}]*)\\}`))[1] + ';' + (el.getAttribute('style') || '')
    }
    expect(ruleOf(rows[0])).toMatch(/overflow-y:\s*hidden/)
    expect(ruleOf(rows[5])).not.toMatch(/overflow-y:\s*hidden/)
    expect(ruleOf(rows[6])).toMatch(/overflow-y:\s*hidden/)
  })

  it('leaves integer borders in content-box', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<div style="height:10px;border:1px solid #00f"></div>'
    document.body.appendChild(root)
    mounted.push(root)
    const res = await snapdom(root, { cache: 'disabled' })
    const css = decodeURIComponent(res.url).match(/<style[^>]*>([\s\S]*?)<\/style>/)[1]
    expect(css).toMatch(/border-top-width:1px/)
    expect(css).not.toMatch(/box-sizing:border-box/)
  })
})
