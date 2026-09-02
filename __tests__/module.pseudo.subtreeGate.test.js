// The subtree gate in inlinePseudoElements skips the whole recursive pseudo walk when no
// node under the capture root can match an author pseudo selector. These are the cases where
// skipping would be WRONG, and each one asserts on painted pixels rather than on the
// serialized payload — the class CSS travels in the svg whether or not anything renders.
//
// Prove-it-can-fail: neutering the guard's descendant search (`source.querySelector(sel)` →
// `null`) turns the first test red, and dropping the `shadowScopes` bail turns the second red.
import { describe, test, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

let mounted = []
const mount = (el) => { document.body.appendChild(el); mounted.push(el); return el }
afterEach(() => { for (const el of mounted) el.remove(); mounted = [] })

/** Opaque pixels within tolerance of `rgb`, counted on the rasterized capture. */
async function countPixels(el, rgb, opts = {}) {
  const canvas = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false, ...opts })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    if (Math.abs(data[i] - rgb[0]) <= 40 && Math.abs(data[i + 1] - rgb[1]) <= 40 && Math.abs(data[i + 2] - rgb[2]) <= 40) n++
  }
  return n
}

describe('pseudo subtree gate', () => {
  test('a ::before that matches a DESCENDANT, not the capture root, still renders', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.sg-icon::before{content:"";display:block;width:40px;height:40px;background:#e00000}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:120px;height:120px;background:#fff'
    root.innerHTML = '<div><span class="sg-icon"></span></div>'
    // The root itself matches nothing; only a grandchild does.
    expect(root.matches('.sg-icon')).toBe(false)
    expect(await countPixels(root, [0xe0, 0x00, 0x00])).toBeGreaterThan(1000)
  }, 30_000)

  // A ::after declared INSIDE an open shadow root, on a page whose document sheets mention no
  // pseudo at all. Two things used to lose it: the pass's preflight only reads the document's
  // sheets, so it skipped the whole walk; and the scope rewrite produced
  // `:where([data-sd] .k::after:not(…))`, which no parser accepts. It is inlined as a span
  // from the live computed style, like a light-DOM ::after, and exactly once.
  test('a ::after inside an open shadow root still renders', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:120px;height:120px;background:#fff'
    const host = document.createElement('div')
    root.appendChild(host)
    const sr = host.attachShadow({ mode: 'open' })
    sr.innerHTML = '<style>.k::after{content:"";display:block;width:40px;height:40px;background:#0000e0}</style><div class="k"></div>'
    const n = await countPixels(root, [0x00, 0x00, 0xe0])
    expect(n).toBeGreaterThan(1000)
    expect(n).toBeLessThan(2200) // one 40x40 box, not two
  }, 30_000)

  // ::marker has no span mechanism: it renders natively in the foreignObject from the scoped
  // rule, which needs the pseudo-element OUTSIDE the :where() wrapper to be a valid selector.
  test('a ::marker declared inside a shadow root colours the marker', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:160px;height:80px;background:#fff;font:16px Arial'
    const host = document.createElement('div')
    root.appendChild(host)
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<style>li::marker{color:#c000c0;font-size:40px}</style><ul style="margin:0;padding-left:60px"><li>x</li></ul>'
    expect(await countPixels(root, [0xc0, 0x00, 0xc0])).toBeGreaterThan(40)
  }, 30_000)

  // The shadow bail in canSkipPseudoWalk is behaviour-preserving rather than provable through
  // rendering while the defect above stands: with a shadow root anywhere in the capture the
  // walk runs exactly as it did before, so whatever shadow content does render keeps rendering.
  test('a capture containing a shadow root is unaffected by the gate', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.sg-mark::before{content:"";display:block;width:40px;height:40px;background:#a000a0}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:160px;height:160px;background:#fff'
    root.innerHTML = '<span class="sg-mark"></span><div id="sg-host"></div>'
    root.querySelector('#sg-host').attachShadow({ mode: 'open' }).innerHTML = '<div>shadow</div>'
    expect(await countPixels(root, [0xa0, 0x00, 0xa0])).toBeGreaterThan(1000)
  }, 30_000)

  test('the gate does not fire when the author rule genuinely matches nothing', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.sg-absent::before{content:"";display:block;width:40px;height:40px;background:#00c000}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:120px;height:120px;background:#fff'
    root.innerHTML = '<div><span>plain</span></div>'
    expect(await countPixels(root, [0x00, 0xc0, 0x00])).toBe(0)
  }, 30_000)
})
