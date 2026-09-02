// #328 had no direct pixel test: normalizeInlineStyleToComputed re-resolves an element's
// inline declarations through the cascade so a stylesheet `!important` still wins inside the
// clone. These pin the three outcomes that pass has to produce, on painted pixels rather than
// on the serialized payload.
//
// They also bound an optimization that was measured and rejected. Scoping the pass to the
// properties some author rule marks `!important` takes toRaw on a 500-row table from 67.6 ms
// to 38.6 ms — 45% of the pipeline — and these three stay green, because #328 is only half of
// what the pass does. The other half is undocumented: it is the mechanism that carries
// snapdom's OWN writes on the source element (the selection highlight's background layers,
// same-origin iframe expansion) onto the clone. The demo corpus caught it on all three engines
// (d32-iframe-same-origin) along with module.selection. Scoping it needs the passes that write
// to the source to record WHICH properties they wrote; the important-property set alone is not
// the contract.
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
