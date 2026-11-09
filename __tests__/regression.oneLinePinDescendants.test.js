// A box freezeOneLine pins to one line carries the pin to every element under it.
//
// conciv-dev/conciv#764: on a page with `overflow-wrap: anywhere`, Firefox laid snapdom's copy
// out a hair wider; the one-line row was pinned `nowrap`, but the base reset's own
// `a{white-space:normal}` (a type selector, which beats what the link inherits) gave each
// link its wrapping back, and "Home" broke into "Hom / e". The runner has no such drift, so
// the clone gets a little extra letter-spacing through a plugin, which widens the text the
// same way (the #516 technique). Every row is shrink-to-fit live, so the wider text has no
// slack and must either break or overflow.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { for (const el of mounted.splice(0)) el.remove() })

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  const el = host.firstElementChild
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

/** Widens every glyph of the clone by `drift` px (!important: the base reset restates letter-spacing per tag). */
const drifted = (drift = 0.4) => ({
  name: 'drift',
  afterClone: (ctx) => {
    const style = document.createElement('style')
    style.textContent = `*{letter-spacing:${drift}px !important}`
    ctx.clone.appendChild(style)
  },
})

/** Dark pixels per row of the capture, read off its canvas. */
async function inkRows(el, options) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, embedFonts: false, burst: false, plugins: [drifted()], ...options })
  const { width, height } = canvas
  const d = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const rows = []
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100 && d[i + 3] > 128) n++
    }
    rows.push(n)
  }
  return rows
}
/** Rows from the first inked one to the last: within one 20px line box for one line of text,
 *  past it (glyphs on a second line) once anything wraps. Underlines stay inside the line box. */
const extent = (rows) => {
  let first = -1
  let last = -1
  rows.forEach((n, y) => { if (n) { if (first < 0) first = y; last = y } })
  return last - first + 1
}
const LINE = 20

const ROW = 'display:inline-flex;align-items:flex-start;overflow-wrap:anywhere;padding:16px;background:#fff;color:#000;font:600 14px/20px Arial,sans-serif'
const LINK = 'display:inline-flex;align-items:center;color:inherit;text-decoration:none'

describe('a one-line pin reaches the elements under the pinned box', () => {
  it('keeps inline-flex links of a one-line row on one line (conciv#764)', async () => {
    const el = mount(`<nav style="${ROW}"><div style="display:flex;flex-wrap:nowrap;column-gap:16px">` +
      ['Home', 'About', 'Form', 'Docs'].map(t => `<a href="#" style="${LINK}">${t}</a>`).join('') + '</div></nav>')
    expect(extent(await inkRows(el))).toBeLessThan(LINE)
  })

  it('keeps plain inline links inside a one-line row on one line', async () => {
    const el = mount(`<div style="${ROW}"><span><a href="#" style="color:inherit">Home</a> · <a href="#" style="color:inherit">About</a></span></div>`)
    expect(extent(await inkRows(el))).toBeLessThan(LINE)
  })

  it('keeps the ::after of a pinned host whose box is taller than its line on that line', async () => {
    const el = mount(`<div style="${ROW}"><style>.p764::after{content:' Pro'}</style>` +
      '<div class="p764" style="padding:20px 0">Label</div></div>')
    expect(extent(await inkRows(el))).toBeLessThan(LINE)
  })

  it('leaves a child that wraps live inside a nowrap container free to wrap', async () => {
    const el = mount('<div style="display:inline-block;white-space:nowrap;background:#fff;color:#000;font:14px/20px Arial,sans-serif;padding:8px">' +
      '<p style="white-space:normal;width:60px;margin:0">Wraps here</p></div>')
    expect(extent(await inkRows(el))).toBeGreaterThanOrEqual(1.5 * LINE)
  })
})
