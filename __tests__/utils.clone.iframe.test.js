import { describe, it, expect, afterEach } from 'vitest'
import { pinIframeViewport } from '../src/utils/clone.helpers.js'

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
    expect(win.scrollY).toBe(400)
    expect(win.scrollX).toBe(500)

    const unpin = pinIframeViewport(doc, 200, 150)
    // during pin, overflow:hidden clamps scroll to 0
    expect(win.scrollY).toBe(0)
    expect(win.scrollX).toBe(0)

    unpin()
    expect(win.scrollX).toBe(500)
    expect(win.scrollY).toBe(400)
  })

  it('removes the injected <style> on unpin', () => {
    const doc = makeScrollableIframe()
    const unpin = pinIframeViewport(doc, 200, 150)
    expect(doc.querySelector('style[data-sd-iframe-pin]')).not.toBeNull()
    unpin()
    expect(doc.querySelector('style[data-sd-iframe-pin]')).toBeNull()
  })
})
