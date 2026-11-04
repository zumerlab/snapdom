// The base reset must be pruned by the universe the snapshots were pruned by. A class omits
// a value equal to the tag default and relies on the reset to restate it, and the reset must
// not stamp a prop no snapshot read. Both cases below broke that pairing.
//
// #554: the first capture of a page with a Google Fonts <link> painted a black child in its
// pink parent's colour. The link's sheet throws on cssRules, so the scan is unreliable and the
// snapshots read every property; the fetched copy landed during the capture, the scan turned
// reliable, and the base reset was built from the narrower universe. The parent's class kept
// its resolved `-webkit-text-fill-color`, the child's black equalled the default and was
// diffed out, and the reset no longer stamped it, so the child inherited the pink fill.
// The afterClone hook holds the capture open between the snapshots and the reset, which is
// where the copy landed under a real font request.
//
// Shadow root (3.1.0 to 3.7.1): with the capture root inside a shadow root, the snapshots were
// pruned by the capture's shadow union and the reset read every property, so the reset's
// resolved black `-webkit-text-fill-color` overrode every colour and all text painted black.
import { describe, it, expect, afterEach } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(el) { document.body.appendChild(el); mounted.push(el); return el }

async function linkCrossOriginSheet(css) {
  const href = await commands.serveCrossOriginCss(css, { cors: true })
  const link = mount(document.createElement('link'))
  link.rel = 'stylesheet'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href })
  expect(() => link.sheet.cssRules).toThrow() // the first scan really cannot read it
}

/** White, pink and dark pixels of a capture, read off its canvas. */
async function inks(el, options) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, embedFonts: false, burst: false, ...options })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let white = 0
  let pink = 0
  let dark = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++
    else if (d[i] > 120 && d[i + 1] < 90 && d[i + 2] > 80) pink++
    else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark++
  }
  return { white, pink, dark }
}

describe('the base reset prunes with the snapshots\' universe', () => {
  it('a child keeps its own colour when the cross-origin copy lands after the snapshots (#554)', async () => {
    await linkCrossOriginSheet('.s554-unused{color:red}')
    const el = mount(document.createElement('div'))
    el.style.cssText = 'display:inline-block;background:#fff;font:bold 32px Arial,sans-serif;color:#a9337e;padding:4px'
    el.innerHTML = '<span style="color:#000">BLACK TEXT</span>'
    const hold = { name: 's554-hold', afterClone: () => new Promise((r) => setTimeout(r, 300)) }
    const first = await inks(el, { plugins: [hold] })
    expect(first.dark).toBeGreaterThan(300)
    expect(first.pink).toBe(0)
  })

  it('text keeps its colours when the capture root lives in a shadow root', async () => {
    const host = mount(document.createElement('div'))
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div style="display:inline-block;font:bold 32px Arial,sans-serif;padding:4px;color:#fff;background:#000">WHITE <span style="color:#a9337e">PINK</span></div>'
    const { white, pink } = await inks(root.firstElementChild)
    expect(white).toBeGreaterThan(300)
    expect(pink).toBeGreaterThan(300)
  })
})
