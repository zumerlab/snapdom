// Two output-geometry rules that disagreed with the rest of the library.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isSafari } from '../src/utils/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  document.body.appendChild(d)
  mounted.push(d)
  return d
}

describe('the `width` option means the same thing in the SVG header and in every exporter', () => {
  // types/snapdom.d.ts: "width/height are the absolute output size and win (one rule across
  // all exporters)". The header used to size the svg so the ELEMENT was `width` px, which is
  // larger than the requested box by the bleed — so the same capture rendered its element at
  // two different sizes depending on which exporter you reached for.
  // Not on Safari: there the header deliberately stays at viewBox size and toImg/toSvg patch
  // width/height themselves to keep that path vector (see the Safari notes in CLAUDE.md), so
  // the raw header is not the number the exporter uses.
  it.skipIf(isSafari())('agrees with toCanvas for a shadowed element captured at a target width', async () => {
    const el = mount('<div style="width:200px;height:200px;background:#08f;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.3)"></div>').firstElementChild

    const raw = await snapdom.toRaw(el, { width: 400, outerShadows: true, embedFonts: false })
    const svg = decodeURIComponent(raw.split(',')[1] || '')
    const m = svg.match(/<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/)
    expect(m).not.toBeNull()

    const canvas = await snapdom.toCanvas(el, { width: 400, outerShadows: true, embedFonts: false, dpr: 1 })
    expect(Math.round(parseFloat(m[1]))).toBe(canvas.width)
    expect(Math.round(parseFloat(m[2]))).toBe(canvas.height)
  })
})

describe('clip windows under a scaled ancestor', () => {
  // The window was frozen from getBoundingClientRect (PAGE pixels, ancestor transforms
  // included) and consumed as viewBox coordinates (the root's own LAYOUT pixels).
  function scaledSlide() {
    return mount(
      '<div style="transform:scale(0.5);transform-origin:0 0">' +
      '<div id="slide" style="width:400px;height:200px;position:relative;background:#fff">' +
      '<div style="position:absolute;left:0;top:0;width:200px;height:200px;background:rgb(255,0,0)"></div>' +
      '<div style="position:absolute;left:200px;top:0;width:200px;height:200px;background:rgb(0,0,255)"></div>' +
      '</div></div>').querySelector('#slide')
  }

  async function centre(el, clip) {
    const canvas = await snapdom.toCanvas(el, { clip, embedFonts: false, scale: 1, dpr: 1 })
    const d = canvas.getContext('2d')
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    return { px: `${d[0]},${d[1]},${d[2]}`, w: canvas.width, h: canvas.height }
  }

  it('captures the half the caller asked for, at its layout extent', async () => {
    const slide = scaledSlide()
    const r = slide.getBoundingClientRect()
    const right = await centre(slide, {
      x: r.left + r.width / 2 + window.scrollX, y: r.top + window.scrollY,
      width: r.width / 2, height: r.height,
    })
    expect(right.px).toBe('0,0,255')
    expect(right.w).toBe(200)

    const left = await centre(slide, {
      x: r.left + window.scrollX, y: r.top + window.scrollY,
      width: r.width / 2, height: r.height,
    })
    expect(left.px).toBe('255,0,0')
  })

  it('leaves an untransformed clip capture unchanged', async () => {
    const plain = mount(
      '<div id="p" style="width:400px;height:200px;position:relative;background:#fff">' +
      '<div style="position:absolute;left:0;top:0;width:200px;height:200px;background:rgb(255,0,0)"></div>' +
      '<div style="position:absolute;left:200px;top:0;width:200px;height:200px;background:rgb(0,0,255)"></div>' +
      '</div>').querySelector('#p')
    const r = plain.getBoundingClientRect()
    const right = await centre(plain, {
      x: r.left + 200 + window.scrollX, y: r.top + window.scrollY, width: 200, height: 200,
    })
    expect(right.px).toBe('0,0,255')
    expect(right.w).toBe(200)
  })
})
