// Fidelity against GROUND TRUTH, not against a recorded baseline.
//
// The rest of the visual suite diffs a capture against a PNG snapdom itself recorded, so a
// SYSTEMATIC error becomes the baseline and passes forever. The identity-share grid bug was
// exactly that: every capture placed a grid's columns wrong, all three engines agreed, and no
// baseline moved — it took a screenshot of the LIVE element to see it (18.6% of pixels wrong
// against the live DOM, html2canvas 0.8%). This file makes that screenshot a test: it captures
// each scene, screenshots the live element with the browser's own compositor (Playwright, via
// page.screenshot — independent of snapdom), and diffs the two.
//
// The scenes are deliberately BLOCK-COLOURED, no text: glyph hinting alone moves ~25% of a
// text-dense scene between two renderers, which would drown the structural signal this exists
// to catch. Each scene is a construction that a past bug placed wrong.
import { describe, it, expect, afterEach } from 'vitest'
import { page } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'

// One threshold for every scene. Measured chromium/firefox/webkit, correct capture vs the live
// screenshot: grid 3.4/3.4/3.7, flex 1.7, image 2.8/1.3/2.8, translate 5.2/5.2/5.4 — the residue
// is edge antialiasing after the tester's ~0.8x iframe downscale. With each fix reverted the
// same scene measures 42.6 (grid), 39.6 (image) and 20.0 (translate); the part-pseudo scene
// measures 0.0/0.1/0.0 with its fix and 43.3/25.7/56.6 without it, and the web components scene
// 3.4/3.5/3.4 with the shadow universe and 22.6/22.6/22.5 pruned by the document's alone. A misplaced solid block is
// a contiguous wrong region, nothing like edge noise. 10 sits with a wide margin on both sides.
const THRESHOLD = 10

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, css = '') {
  const el = document.createElement('div')
  el.style.cssText = 'background:#fff;' + css
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Draw `img` onto a fresh w×h canvas over white and return its pixels. */
function pixelsOf(img, w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}

/**
 * Percentage of pixels where snapdom's capture differs from a live screenshot of the same
 * element by more than `tol` on any channel. Both are drawn to the screenshot's own size (the
 * tester runs in a scaled iframe, so the Playwright shot is smaller than the CSS box), over
 * white, so alpha and scale are neutralised before the compare.
 */
async function mismatchVsLive(el, tol = 40) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const shot = await page.screenshot({ element: el, base64: true })
  const live = await decode('data:image/png;base64,' + shot.base64)
  const w = live.naturalWidth
  const h = live.naturalHeight
  const cap = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })
  const a = pixelsOf(live, w, h)
  const b = pixelsOf(cap, w, h)
  let differing = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) differing++
  }
  return 100 * differing / (w * h)
}

// A canvas-generated image (no network, no fixtures) so the image scenes are self-contained.
function dataImage(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')
  x.fillStyle = '#1888ff'
  x.fillRect(0, 0, w, h)
  x.fillStyle = '#ffcc00'
  x.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6)
  return c.toDataURL('image/png')
}

// A Playwright element screenshot is a round trip through the node side; under BROWSER=all
// the three engines share the machine and one took past the default 15s.
describe('capture matches a live screenshot of the element', { timeout: 60_000 }, () => {
  // THE grid bug. Two identical-identity `1fr 1fr` grids under 120px and 300px columns; the
  // used track list differs, and the identity share used to copy one twin's columns to the
  // other. A block-coloured cell in the wrong place is a large, unmissable diff.
  it('nested grid twins under different-width columns', async () => {
    const el = mount(
      `<div class="lg-outer">
        <div class="lg-col"><div class="lg-twin"><i></i><b></b></div></div>
        <div class="lg-col"><div class="lg-twin"><i></i><b></b></div></div>
      </div>`,
      'width:420px')
    const s = document.createElement('style')
    s.textContent = `
      .lg-outer{display:grid;grid-template-columns:120px 300px}
      .lg-twin{display:grid;grid-template-columns:1fr 1fr;height:120px}
      .lg-twin i{background:#e0004d} .lg-twin b{background:#00a0b0}`
    document.head.appendChild(s)
    mounted.push(s)
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })

  // Nested flex boxes with per-level colours — the deep-tree shape in miniature, where the same
  // share reads used widths per box.
  it('nested flex boxes', async () => {
    const el = mount(
      '<div class="fb"><div class="fb2"></div><div class="fb2 wide"></div></div>',
      'width:360px')
    const s = document.createElement('style')
    s.textContent = `
      .fb{display:flex;height:120px}.fb2{flex:1;background:#4060c0}.fb2.wide{flex:2;background:#c04060}`
    document.head.appendChild(s)
    mounted.push(s)
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })

  // The <img> box fix: a padded, bordered image resolves min-*/size against the content box.
  // A too-large frozen box scales the picture inside it — a diff spread across the whole image.
  it('an image with padding and a border', async () => {
    const el = mount('<img style="width:240px;height:auto;padding:20px;border:6px solid #202020">', 'display:inline-block')
    const img = el.querySelector('img')
    img.src = dataImage(240, 160)
    await img.decode()
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })

  // A percent translate resolves against each box; the share re-reads `transform` only when the
  // identity has one. Two translated twins under different-width parents.
  it('percent-translated twins', async () => {
    const el = mount(
      `<div class="tt-outer">
        <div class="tt-col"><div class="tt"></div></div>
        <div class="tt-col"><div class="tt"></div></div>
      </div>`,
      'width:400px;padding:20px')
    const s = document.createElement('style')
    s.textContent = `
      .tt-outer{display:grid;grid-template-columns:140px 280px}
      .tt{width:50%;height:120px;background:#7030c0;transform:translateX(100%)}`
    document.head.appendChild(s)
    mounted.push(s)
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })

  // #502: a meter and a progress whose look lives in their UA part pseudos. The capture carries
  // the author rules for those parts; without them the clone painted the default chrome (green
  // and grey bars) over the authored box. The meter's CSS is the report's own.
  it('a meter and a progress styled through their part pseudos', async () => {
    const el = mount(
      `<div class="mp-bar"><meter min="0" max="100" value="33" optimum="100"></meter></div>
       <div class="mp-bar"><progress max="100" value="60"></progress></div>`,
      'width:260px;padding:10px')
    const s = document.createElement('style')
    s.textContent = `
      .mp-bar{position:relative;width:260px;height:36px;margin-bottom:10px}
      .mp-bar meter,.mp-bar progress{position:absolute;inset:0;width:100%;height:100%;appearance:none;-webkit-appearance:none;border:1px solid #2a7;box-sizing:border-box;background:#7fd8bd}
      .mp-bar meter::-webkit-meter-bar{background:inherit}
      .mp-bar meter::-webkit-meter-optimum-value{background:inherit}
      .mp-bar meter::-moz-meter-bar{background:inherit}
      .mp-bar progress::-webkit-progress-bar{background:inherit}
      .mp-bar progress::-webkit-progress-value{background:#e0004d}
      .mp-bar progress::-moz-progress-bar{background:#e0004d}`
    document.head.appendChild(s)
    mounted.push(s)
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })

  // Shadow-root content reads only the properties some root's sheets can set (#503). Each root
  // here styles through a different route: an adopted sheet, `:host`, `::slotted`, and a
  // `::part` rule from the root above. The scoped copy of the shadow CSS cannot match `::part`,
  // and the background pass takes background-blend-mode from the snapshot, so the black bar
  // (yellow multiplied over blue) paints only when that root joined the shadow universe.
  it('web components styled through adopted sheets, :host, ::part and ::slotted', async () => {
    const el = mount('<div></div>', 'width:300px;padding:10px')
    const a = el.firstElementChild.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      .frame{height:30px;border:10px solid transparent;border-image:linear-gradient(#e0004d,#e0004d) 1}
      .inner::part(bar){height:30px;background:linear-gradient(#ff0,#ff0),#00f;background-blend-mode:multiply}`)
    a.adoptedStyleSheets = [sheet]
    a.innerHTML = '<div class="frame"></div><div class="inner"><div class="s"></div></div>'
    const b = a.querySelector('.inner').attachShadow({ mode: 'open' })
    b.innerHTML = `<style>
      :host{display:block;border-left:20px solid transparent;border-image:linear-gradient(#4060c0,#4060c0) 1}
      ::slotted(.s){display:block;height:30px;background:#7030c0;mask-image:linear-gradient(to right,transparent 50%,#000 50%)}
    </style><div part="bar"></div><slot></slot>`
    expect(await mismatchVsLive(el)).toBeLessThan(THRESHOLD)
  })
})
