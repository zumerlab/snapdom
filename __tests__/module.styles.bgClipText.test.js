// Firefox drops background-clip:text inside an SVG foreignObject image, so gradient text whose
// own colour is transparent captures as nothing at all. The snapshot substitutes a plain colour
// — the average of the gradient's stops — which loses the gradient but keeps the words.
// Imported from @frostin/snapdom (element-mirror).
import { describe, it, expect, afterEach } from 'vitest'
import { bgClipTextFallbackColor } from '../src/modules/styles.js'
import { isFirefox } from '../src/utils/browser.js'
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

  it('paints a solid substitute colour on Firefox, and the gradient elsewhere', async () => {
    const canvas = await captureGradientText()
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const hues = new Set()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) continue
      hues.add(`${data[i] > 128}|${data[i + 2] > 128}`)
    }
    if (isFirefox()) {
      // The substitute is the average of red and blue: purple everywhere, no red-only or
      // blue-only run left.
      expect(hues.has('true|false')).toBe(false)
      expect(hues.has('false|true')).toBe(false)
    } else {
      // A real red->blue gradient must paint a red-dominant AND a blue-dominant population.
      // size >= 1 was satisfied by ANY ink — including the purple fallback wrongly engaging
      // here, which is exactly the regression this branch exists to catch.
      expect(hues.has('true|false')).toBe(true)
      expect(hues.has('false|true')).toBe(true)
    }
  })
})
