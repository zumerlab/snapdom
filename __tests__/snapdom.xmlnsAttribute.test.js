// #511: an `xmlns` set through setAttribute on a created SVG element is a plain attribute.
// XMLSerializer writes the element's own xmlns beside it, so any other value (a trailing
// space is enough) gives the tag two xmlns attributes and the SVG fails to decode with
// "EncodingError: The source image cannot be decoded".
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const SVG_NS = 'http://www.w3.org/2000/svg'

function iconWithXmlns(value) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', value)
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '32')
  svg.setAttribute('height', '32')
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('width', '16')
  rect.setAttribute('height', '16')
  rect.setAttribute('fill', 'rgb(0,128,0)')
  svg.appendChild(rect)
  return svg
}

describe('#511 xmlns attribute set on a created SVG element', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('decodes the svg blob when xmlns carries a trailing space', async () => {
    host.appendChild(iconWithXmlns(SVG_NS + ' '))
    const blob = await snapdom.toBlob(host, { type: 'svg', scale: 1 })
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      expect(img.naturalWidth).toBeGreaterThan(0)
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  it('paints the icon when xmlns names another namespace', async () => {
    host.appendChild(iconWithXmlns('http://example.com/ns'))
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    const d = canvas.getContext('2d').getImageData(16, 16, 1, 1).data
    expect([d[0], d[1], d[2], d[3]]).toEqual([0, 128, 0, 255])
  })
})
