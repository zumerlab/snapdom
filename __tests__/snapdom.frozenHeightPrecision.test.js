// A frozen height must lay out at the live height, not 1/64px under it.
//
// Blink lays out on a 1/64px grid but serializes a computed length to 6 significant digits, and
// it parses a length back by flooring onto that grid. A block whose used height is 38.390625px
// (32px text at line-height 1.2) reads back as "38.3906px" and lays out at 38.375 in the clone.
// Each frozen block lost 1/64px, so a tall capture drifted: on the 4136px rich-text scene of the
// render-tag comparison, text lines below ~1400px painted one pixel higher than the live page
// (0.996% of pixels against a native screenshot, 0.03% with the height nudged like a width).
//
// WebKit serializes the exact value and Gecko re-rounds to its own 1/60 grid, so this scene
// only goes red in Chromium. It runs on all three engines as a guard on the nudge itself.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const ROWS = 40

function mount() {
  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;left:0;top:0;width:200px;background:#fff'
  for (let i = 0; i < ROWS; i++) {
    // A <p>, not a <div>: its used height differs from the tag default, so it is frozen.
    const row = document.createElement('p')
    row.style.cssText = 'font:32px/1.2 Arial, Helvetica, sans-serif;color:#fff;margin:0'
    row.textContent = 'Ag'
    root.appendChild(row)
  }
  const mark = document.createElement('div')
  mark.style.cssText = 'height:4px;background:#000'
  root.appendChild(mark)
  document.body.appendChild(root)
  return { root, mark }
}

/** First row, in a middle column, whose pixel is darker than mid-gray. */
function firstDarkRow(canvas) {
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data
  for (let y = 0; y < canvas.height; y++) {
    if (data[y * 4] < 128) return y
  }
  return -1
}

describe('frozen height precision', () => {
  let root
  afterEach(() => root?.remove())

  it('paints a block below 40 frozen fractional paragraph heights where the live page does', async () => {
    const mounted = mount()
    root = mounted.root
    const liveTop = mounted.mark.getBoundingClientRect().top - root.getBoundingClientRect().top

    const result = await snapdom(root, { embedFonts: false })
    const canvas = await result.toCanvas({ dpr: 1, scale: 1 })
    const row = firstDarkRow(canvas)

    // Chromium live: 40 x 38.390625 = 1535.625, painted from row 1536. Without the snap the
    // clone stacks 40 x 38.375 = 1535 and the mark starts a row early.
    expect(row).toBeGreaterThan(0)
    expect(Math.abs(row - liveTop)).toBeLessThan(0.5)
  })
})
