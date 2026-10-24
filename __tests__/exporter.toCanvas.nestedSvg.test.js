import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  // A decode frame that already holds the nested svg paints it at once and hides the bug.
  for (const frame of document.querySelectorAll('iframe[data-snapdom-internal]')) frame.remove()
})

let nonce = 0
/** A red svg the image cache has never seen, behind a blob: URL the capture inlines. */
function freshRedSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" preserveAspectRatio="none"><!--${nonce++}-${Math.random()}--><rect width="10" height="10" fill="red"/></svg>`
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
}

function redRatio(source) {
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 50
  const context = canvas.getContext('2d')
  context.drawImage(source, 0, 0, 100, 50)
  const data = context.getImageData(0, 0, 100, 50).data
  let red = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++
  return red / 5000
}

describe('first raster of a nested svg image', () => {
  it.each(['toCanvas', 'toPng'])('paints a freshly inlined svg background in the first %s export', async (exporter) => {
    const root = document.createElement('div')
    root.style.cssText = `width:100px;height:50px;background:white url("${freshRedSvg()}") 0 0/100% 100%`
    document.body.appendChild(root)
    mounted.push(root)
    const result = await snapdom(root, { cache: 'disabled', burst: false, scale: 1, dpr: 1 })
    expect(decodeURIComponent(result.url)).toMatch(/data:image\/svg\+xml;base64,/)
    expect(redRatio(await result[exporter]())).toBeGreaterThan(0.9)
  })
})
