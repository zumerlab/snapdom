import { afterEach, describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'
import { inlineSingleBackgroundEntry } from '../src/utils/image.js'

// Vaadin's sort indicator from the ArcGIS feature table in #503. CSSOM escapes the
// SVG's quotes; those backslashes must not become part of the embedded XML.
const sortSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="12" viewBox="0 0 8 12" fill="none"><path d="M7.49854 6.99951C7.92795 6.99951 8.15791 7.50528 7.87549 7.82861L4.37646 11.8296C4.17728 12.0571 3.82272 12.0571 3.62354 11.8296L0.125488 7.82861C-0.157248 7.50531 0.0719873 6.99956 0.501465 6.99951H7.49854ZM3.62354 0.17041C3.82275 -0.0573875 4.17725 -0.0573848 4.37646 0.17041L7.87549 4.17041C8.15825 4.49373 7.92806 5.00049 7.49854 5.00049L0.501465 4.99951C0.0719873 4.99946 -0.157248 4.49371 0.125488 4.17041L3.62354 0.17041Z" fill="black"/></svg>'
const sortUrl = 'data:image/svg+xml;utf8,' + sortSvg
const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

describe('CSS data URL passthrough', () => {
  it.each([
    ['raw SVG', sortUrl],
    ['partly encoded SVG', sortUrl.replace('fill="black"', 'fill="%23000000"')],
    ['fully encoded SVG', 'data:image/svg+xml,' + encodeURIComponent(sortSvg)],
    ['base64 PNG', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='],
  ])('preserves CSSOM serialization for %s', async (_kind, url) => {
    const style = document.createElement('div').style
    style.maskImage = `url('${url}')`
    expect(style.maskImage).not.toBe('')
    expect(await inlineSingleBackgroundEntry(style.maskImage)).toBe(style.maskImage)
  })
})

async function pixelsOf(image) {
  if (typeof image === 'string') {
    const decoded = new Image()
    decoded.src = image
    await decoded.decode()
    image = decoded
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, 64, 64)
  return context.getImageData(0, 0, 64, 64).data
}

describe('raw SVG sort icons (#503)', { timeout: 60_000 }, () => {
  it.each(['pseudo mask', 'pseudo mask with encoded color', 'element mask', 'background'])('preserves the shape and transparent gaps of a %s', async (kind) => {
    const host = document.createElement('div')
    host.style.cssText = 'display:block;width:64px;height:64px;background:white'
    host.attachShadow({ mode: 'open' }).innerHTML = '<style></style><div class="icon"></div>'
    // The background uses a partly URI-encoded SVG, a common authoring pattern for # colors.
    const url = kind === 'background' || kind.includes('encoded') ? sortUrl.replace('fill="black"', 'fill="%23000000"') : sortUrl
    const target = kind.startsWith('pseudo mask') ? '.icon::before' : '.icon'
    const imageStyle = kind === 'background'
      ? `background-image:url('${url}');background-size:32px 48px;background-repeat:no-repeat`
      : `background:black;mask-image:url('${url}');mask-size:32px 48px;mask-repeat:no-repeat`
    host.shadowRoot.querySelector('style').textContent = `${target}{content:"";display:block;position:absolute;left:16px;top:8px;width:32px;height:48px;${imageStyle}}`
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push(host)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const screenshot = await page.screenshot({ element: host, base64: true })
    const expected = await pixelsOf('data:image/png;base64,' + screenshot.base64)
    const result = await snapdom(host, { cache: 'disabled', burst: false, scale: 1, dpr: 1 })
    const actual = await pixelsOf(await result.toCanvas())
    for (const [label, pixels] of [['native', expected], ['capture', actual]]) {
      // Both triangles remain visible; their corners and the space between them stay clear.
      for (const [x, y, value] of [[32, 20, 0], [32, 44, 0], [16, 8, 255], [32, 32, 255]]) {
        expect([...pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)], `${label}: ${x},${y}`).toEqual([value, value, value, 255])
      }
    }
    let differing = 0
    for (let i = 0; i < expected.length; i += 4) {
      if (Math.abs(expected[i] - actual[i]) > 30) differing++
    }
    // Vitest scales its iframe: the native screenshot can be 52px for this 64px scene,
    // so resampling shifts antialiased edges. The opaque/clear interior checks stay exact.
    expect(differing / (64 * 64)).toBeLessThan(0.07)
  })
})
