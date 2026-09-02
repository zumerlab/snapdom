// normalizeInlineStyleToComputed re-resolves an element's inline declarations through the
// cascade. Its docstring names one reason — #328, a stylesheet `!important` must still win
// inside the clone — and it had no test. It has THREE contracts; the other two are
// undocumented and load-bearing, and each was found by a test going red while scoping the
// pass. All four assertions below are on painted pixels, never on the payload.
//
//  1. #328, for the property the important rule declares.
//  2. `background`: the selection highlight composes its measured px layers on top of the
//     longhands this pass puts on the clone (module.selection).
//  3. Context-dependent values — `width:100%`, `1.2em`, `calc()`, `auto` — resolve against a
//     containing block the foreignObject does not reproduce (d32-iframe-same-origin).
//
// Why that is worth writing down: this pass is 45% of a 500-row-table capture. Stubbed out,
// toRaw goes 67.6 -> 38.6 ms, because cells carrying `padding` and `border` shorthands pay 20
// computed reads and 20 writes per node for values their own style attribute already holds.
// Gating on all three contracts measures 67.6 -> 51.1 ms with the corpus green on chromium,
// firefox and webkit. NOT landed: the variant that satisfies contract 3 also compares the
// clone's style attribute against the source's, and that comparison answers differently in the
// differential-recapture path — it breaks core.capture.diff's "byte-equal to full" on all
// three engines. The open question is why those two attributes diverge in the full pipeline
// for d32's elements. Until that is answered the pass stays whole.

import { describe, test, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

let mounted = []
const mount = (el) => { document.body.appendChild(el); mounted.push(el); return el }
afterEach(() => { for (const el of mounted) el.remove(); mounted = [] })

async function countPixels(el, rgb) {
  const canvas = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    if (Math.abs(data[i] - rgb[0]) <= 30 && Math.abs(data[i + 1] - rgb[1]) <= 30 && Math.abs(data[i + 2] - rgb[2]) <= 30) n++
  }
  return n
}

describe('inline declarations and stylesheet !important (#328)', () => {
  test('#328: a stylesheet !important still beats the inline declaration', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.ig-box{background:#00c000 !important}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:100px;height:100px;background:#fff'
    root.innerHTML = '<div class="ig-box" style="background:#e00000;width:80px;height:80px"></div>'
    expect(await countPixels(root, [0x00, 0xc0, 0x00])).toBeGreaterThan(4000)
    expect(await countPixels(root, [0xe0, 0x00, 0x00])).toBe(0)
  }, 30_000)

  test('an inline declaration no rule marks important is kept verbatim', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.ig-other{outline-color:#00c000 !important}'   // important, but another property
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:100px;height:100px;background:#fff'
    root.innerHTML = '<div style="background:#e00000;width:80px;height:80px"></div>'
    expect(await countPixels(root, [0xe0, 0x00, 0x00])).toBeGreaterThan(4000)
  }, 30_000)

  test('a context-dependent inline value is pinned to its used value in the clone', async () => {
    // `50%` resolves against a containing block the foreignObject does not reproduce, so the
    // pass must re-resolve it even though no rule marks it important. Asserted through the
    // painted width, not the payload.
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:200px;height:60px;background:#fff'
    root.innerHTML = '<div style="width:50%;height:60px;background:#e00000"></div>'
    const canvas = await snapdom.toCanvas(root, { scale: 1, dpr: 1, burst: false })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const { data } = ctx.getImageData(0, 30, canvas.width, 1)   // una fila por el medio
    let red = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] < 60 && data[i + 2] < 60) red++
    }
    expect(red).toBeGreaterThan(90)
    expect(red).toBeLessThan(110)
  }, 30_000)

  test('a plain (non-important) rule does not override the inline declaration', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.ig-plain{background:#00c000}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:100px;height:100px;background:#fff'
    root.innerHTML = '<div class="ig-plain" style="background:#e00000;width:80px;height:80px"></div>'
    expect(await countPixels(root, [0xe0, 0x00, 0x00])).toBeGreaterThan(4000)
    expect(await countPixels(root, [0x00, 0xc0, 0x00])).toBe(0)
  }, 30_000)
})
