import { describe, it, expect, afterEach } from 'vitest'
import { pinIframeViewport, rasterizeIframe } from '../src/utils/clone.helpers.js'
import { snapdom } from '../src/api/snapdom.js'

// #393: pinIframeViewport applies `overflow: hidden` to the iframe html/body,
// which clamps the scroll position to 0. The live page must be left untouched
// after the unpin — scroll state restored, no leftover <style>.
describe('pinIframeViewport — live iframe state (#393)', () => {
  let iframe

  afterEach(() => {
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe)
  })

  function makeScrollableIframe() {
    iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:200px;height:150px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write('<html><body style="margin:0"><div style="width:2000px;height:2000px;background:linear-gradient(red,blue)"></div></body></html>')
    doc.close()
    return doc
  }

  it('restores window scroll position after unpin', () => {
    const doc = makeScrollableIframe()
    const win = doc.defaultView
    win.scrollTo(500, 400)
    // sanity: scroll took effect
    expect(win.scrollY).toBeCloseTo(400, 0)
    expect(win.scrollX).toBeCloseTo(500, 0)

    const unpin = pinIframeViewport(doc, 200, 150)
    // during pin, overflow:hidden clamps scroll to 0
    expect(win.scrollY).toBe(0)
    expect(win.scrollX).toBe(0)

    unpin()
    expect(win.scrollX).toBeCloseTo(500, 0)
    expect(win.scrollY).toBeCloseTo(400, 0)
  })

  it('removes the injected <style> on unpin', () => {
    const doc = makeScrollableIframe()
    const unpin = pinIframeViewport(doc, 200, 150)
    expect(doc.querySelector('style[data-sd-iframe-pin]')).not.toBeNull()
    unpin()
    expect(doc.querySelector('style[data-sd-iframe-pin]')).toBeNull()
  })

  // #448: pinning must not hard-zero body margin/padding — the content inset was lost.
  // Body margin is folded into padding so content keeps its live offset while body still
  // fills the box (background propagation preserved).
  it('folds body margin into padding instead of zeroing it (#448)', () => {
    iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:400px;height:150px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write('<html><body style="margin:24px;padding:16px;background:#eef"><p>hi</p></body></html>')
    doc.close()

    const unpin = pinIframeViewport(doc, 400, 150)
    const cs = doc.defaultView.getComputedStyle(doc.body)
    // margin collapsed to 0, but margin(24)+padding(16)=40 preserved as padding
    expect(parseFloat(cs.marginTop)).toBe(0)
    expect(parseFloat(cs.paddingTop)).toBe(40)
    expect(parseFloat(cs.paddingLeft)).toBe(40)
    // body still fills the pinned viewport so its background propagates
    expect(parseFloat(cs.width)).toBe(400)
    expect(parseFloat(cs.height)).toBe(150)
    unpin()
  })

  // #449: a doc taller than its iframe was captured at full scrollHeight and then squeezed
  // into the iframe box by the <img> height → vertically compressed. The bitmap must match
  // the iframe viewport.
  it('rasterizes a long iframe doc at viewport size, not full page height (#449)', async () => {
    iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:300px;height:200px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write('<html><body style="margin:0"><div style="height:2000px;background:linear-gradient(red,blue)">TOP</div></body></html>')
    doc.close()
    expect(doc.documentElement.scrollHeight).toBeGreaterThan(1000)

    const session = {
      styleMap: new Map(),
      styleCache: new WeakMap(),
      nodeMap: new Map(),
    }
    const wrapper = await rasterizeIframe(iframe, session, { snap: snapdom })
    const img = wrapper.querySelector('img')
    await new Promise((resolve) => {
      if (img.complete && img.naturalHeight) resolve()
      else img.onload = resolve
    })
    expect(img.naturalWidth).toBe(300)
    expect(img.naturalHeight).toBe(200)
    // and the live doc is left clean
    expect(doc.documentElement.hasAttribute('data-sd-pinned')).toBe(false)
  })
})

// Pinning clamps the frame's scroll to 0, so a frame the user had scrolled was captured
// from the top of its document instead of from what they were looking at. Asserted on the
// pixel the browser actually paints at the top of the frame viewport.
describe('a scrolled same-origin iframe captures what the user sees', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('keeps the scroll offset through the capture', async () => {
    const host = document.createElement('div')
    const f = document.createElement('iframe')
    f.style.cssText = 'width:300px;height:200px;border:0'
    f.srcdoc = '<body style="margin:0">' +
      ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan']
        .map((c) => `<div style="height:100px;background:${c}"></div>`).join('') + '</body>'
    host.appendChild(f)
    document.body.appendChild(host)
    await new Promise((r) => { f.onload = r; setTimeout(r, 500) })
    await new Promise((r) => setTimeout(r, 100))

    f.contentWindow.scrollTo(0, 200)
    await new Promise((r) => setTimeout(r, 100))
    const doc = f.contentDocument
    // Precondition: the frame really is scrolled and paints the third band on top.
    const livePainted = doc.defaultView.getComputedStyle(doc.elementFromPoint(5, 5)).backgroundColor
    expect(livePainted).toBe('rgb(0, 0, 255)')

    const res = await snapdom(host, { dpr: 1, scale: 1 })
    const c = await res.toCanvas()
    const px = c.getContext('2d').getImageData(5, 5, 1, 1).data
    expect(`rgb(${px[0]}, ${px[1]}, ${px[2]})`).toBe(livePainted)
  })
})
