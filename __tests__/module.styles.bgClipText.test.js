// Firefox drops background-clip:text inside an SVG foreignObject image, so gradient text whose
// own colour is transparent captures as nothing at all. The snapshot substitutes a plain colour,
// the average of the gradient's stops, and bgClipText.js then repaints the real gradient (#530);
// the average stays where that repaint cannot run.
// Imported from @frostin/snapdom (element-mirror).
import { describe, it, expect, afterEach } from 'vitest'
import { bgClipTextFallbackColor } from '../src/modules/styles.js'
import { snapdom } from '../src/index.js'

describe('bgClipTextFallbackColor', () => {
  it('averages the stops of a computed gradient', () => {
    const gradient = 'linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'
    expect(bgClipTextFallbackColor(gradient, 'rgba(0, 0, 0, 0)')).toBe('rgb(128, 0, 128)')
  })

  it('ignores stops that paint nothing', () => {
    const gradient = 'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgb(0, 0, 255) 100%)'
    expect(bgClipTextFallbackColor(gradient, null)).toBe('rgb(0, 0, 255)')
  })

  it('falls back to the background colour when the image carries no colour', () => {
    expect(bgClipTextFallbackColor('none', 'rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)')
  })

  it('returns null when there is no colour to stand in', () => {
    expect(bgClipTextFallbackColor('none', 'rgba(0, 0, 0, 0)')).toBeNull()
    expect(bgClipTextFallbackColor(undefined, undefined)).toBeNull()
  })
})

describe('gradient text survives the capture', () => {
  let host
  afterEach(() => { host?.remove(); host = null })

  const paintedPixels = (canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240)) painted++
    }
    return painted
  }

  async function captureGradientText() {
    host = document.createElement('div')
    host.style.cssText = 'width:200px;height:40px;background:white'
    host.innerHTML =
      '<span style="font:bold 30px Arial;background-image:linear-gradient(90deg, rgb(255,0,0), rgb(0,0,255));' +
      '-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent">HELLO</span>'
    document.body.appendChild(host)
    return snapdom.toCanvas(host, { dpr: 1, embedFonts: false })
  }

  // The bug and the fallback are both Firefox-only; every other engine rasterizes the real
  // clipped gradient and must keep doing so.
  it('paints the words on every engine', async () => {
    const canvas = await captureGradientText()
    expect(paintedPixels(canvas)).toBeGreaterThan(200)
  })

  // A real red->blue gradient must paint a red-dominant AND a blue-dominant population. On
  // Firefox that used to be the purple average of the stops; #530 repaints the gradient there.
  const hues = (canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const out = new Set()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128 || (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240)) continue
      out.add(`${data[i] > 128}|${data[i + 2] > 128}`)
    }
    return out
  }

  it('paints the gradient, not a solid stand-in, on every engine', async () => {
    const h = hues(await captureGradientText())
    expect(h.has('true|false')).toBe(true)
    expect(h.has('false|true')).toBe(true)
  })

  it('keeps wrapped, centered gradient text where the live layout put it (#530)', async () => {
    host = document.createElement('div')
    host.style.cssText = 'width:150px;background:white;padding:6px'
    host.innerHTML = '<div style="font:bold 26px Arial;text-align:center;letter-spacing:2px;' +
      'background-image:linear-gradient(180deg, rgb(255,0,0) 50%, rgb(0,0,255) 50%);' +
      '-webkit-background-clip:text;background-clip:text;color:transparent">TOP<br>BOTTOM</div>'
    document.body.appendChild(host)
    const canvas = await snapdom.toCanvas(host, { dpr: 1, embedFonts: false })
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    // Red ink only in the top half, blue only in the bottom, and both centered.
    const box = { r: [width, 0, height, 0], b: [width, 0, height, 0] }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const k = data[i] > 180 && data[i + 2] < 80 ? 'r' : data[i + 2] > 180 && data[i] < 80 ? 'b' : null
      if (!k) continue
      const bb = box[k]
      bb[0] = Math.min(bb[0], x); bb[1] = Math.max(bb[1], x); bb[2] = Math.min(bb[2], y); bb[3] = Math.max(bb[3], y)
    }
    // Both inks must exist: the solid stand-in paints neither and left this vacuously green.
    expect(box.r[1]).toBeGreaterThan(0)
    expect(box.b[1]).toBeGreaterThan(0)
    expect(box.r[3]).toBeLessThan(box.b[2])
    const mid = (bb) => (bb[0] + bb[1]) / 2
    expect(Math.abs(mid(box.r) - width / 2)).toBeLessThan(4)
    expect(Math.abs(mid(box.b) - width / 2)).toBeLessThan(4)
  })
})
