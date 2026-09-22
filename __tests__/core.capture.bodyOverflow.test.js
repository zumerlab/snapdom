import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const frames = []
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
})

async function fixture(htmlStyle = '', bodyStyle = '') {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:240px;height:160px;border:0;display:block'
  frames.push(frame)
  const loaded = new Promise(resolve => { frame.onload = resolve })
  frame.srcdoc = `<!doctype html><style>
    html, body { margin:0; height:0 }
    html { ${htmlStyle} }
    body { position:relative; overflow-y:scroll; ${bodyStyle} }
    main { position:absolute; left:0; top:0; width:120px; height:80px; background:rgb(0,136,170) }
  </style><body><main></main></body>`
  document.body.appendChild(frame)
  await loaded
  return frame.contentDocument
}

async function capturePixel(doc, root) {
  const element = root === 'body' ? doc.body : doc.documentElement
  expect(element.getBoundingClientRect().height).toBe(0)
  const canvas = await snapdom.toCanvas(element, { clip: 'viewport', scale: 1, dpr: 1, embedFonts: false })
  expect([canvas.width, canvas.height]).toEqual([240, 160])
  return Array.from(canvas.getContext('2d').getImageData(40, 40, 1, 1).data)
}

describe('document overflow propagated to the viewport (#505)', () => {
  it.each(['body', 'html'])('paints overflowing absolute children when capturing %s', async root => {
    const doc = await fixture()
    expect(doc.elementFromPoint(40, 40).localName).toBe('main')
    expect(await capturePixel(doc, root)).toEqual([0, 136, 170, 255])
    expect(doc.defaultView.getComputedStyle(doc.body).overflowY).toBe('scroll')
  })

  it('paints a zero-height body without clipping', async () => {
    const doc = await fixture()
    expect(doc.body.getBoundingClientRect().height).toBe(0)
    expect(doc.elementFromPoint(40, 40).localName).toBe('main')
    const canvas = await snapdom.toCanvas(doc.body, { embedFonts: false, scale: 1, dpr: 1, burst: false })
    expect(canvas.width).toBeGreaterThanOrEqual(120)
    expect(canvas.height).toBeGreaterThanOrEqual(80)
    expect(Array.from(canvas.getContext('2d').getImageData(40, 40, 1, 1).data)).toEqual([0, 136, 170, 255])
  })

  it.each(['body', 'html'])('preserves body clipping when html owns overflow, capturing %s', async root => {
    const doc = await fixture('overflow:hidden')
    expect(doc.elementFromPoint(40, 40).localName).not.toBe('main')
    expect(await capturePixel(doc, root)).toEqual([0, 0, 0, 0])
  })

  it.each(['html', 'body'])('preserves body clipping when %s containment disables propagation', async target => {
    const doc = await fixture(target === 'html' ? 'contain:layout' : '', target === 'body' ? 'contain:layout' : '')
    expect(doc.elementFromPoint(40, 40).localName).not.toBe('main')
    expect(await capturePixel(doc, 'body')).toEqual([0, 0, 0, 0])
  })

  describe.each(['html', 'body'])('implicit containment on %s', target => {
    it.each([
      ['container-type', 'size'],
      ['container-type', 'inline-size'],
      ['content-visibility', 'auto'],
      ['content-visibility', 'hidden'],
    ])('preserves body clipping with %s:%s despite contain:none', async (property, value) => {
      const declaration = `${property}:${value}`
      const doc = await fixture(target === 'html' ? declaration : '', target === 'body' ? declaration : '')
      const source = target === 'html' ? doc.documentElement : doc.body
      const computed = doc.defaultView.getComputedStyle(source)
      expect(computed.contain).toBe('none')
      expect(computed.getPropertyValue(property)).toBe(value)
      expect(doc.elementFromPoint(40, 40)?.localName).not.toBe('main')
      for (const root of ['body', 'html']) {
        expect(await capturePixel(doc, root), `capturing ${root}`).toEqual([0, 0, 0, 0])
      }
      expect(computed.getPropertyValue(property)).toBe(value)
    })
  })

  it.skipIf(!CSS.supports('container-type', 'scroll-state')).each(['html', 'body'])('does not treat scroll-state queries on %s as containment', async target => {
    const doc = await fixture(target === 'html' ? 'container-type:scroll-state' : '', target === 'body' ? 'container-type:scroll-state' : '')
    expect(doc.elementFromPoint(40, 40)?.localName).toBe('main')
    for (const root of ['body', 'html']) {
      expect(await capturePixel(doc, root), `capturing ${root}`).toEqual([0, 136, 170, 255])
    }
  })

  it('does not clip a zero-height html box whose overflow belongs to the viewport', async () => {
    const doc = await fixture('overflow:hidden', 'overflow:visible')
    expect(doc.elementFromPoint(40, 40).localName).toBe('main')
    expect(await capturePixel(doc, 'html')).toEqual([0, 136, 170, 255])
  })
})
