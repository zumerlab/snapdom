// rasterizeIframe pins a same-origin frame's viewport with a temporary <style>. That helper
// must remain invisible to the shared style environment even though iframe-bearing captures
// now deliberately bypass burst: a frame is an independent paint source and may change via
// canvas, video, animation or cross-document state the outer observer cannot prove static.
// Avoiding the false epoch still preserves the cross-capture style caches used by each fresh
// pipeline and prevents an iframe capture from invalidating unrelated elements.
//
// Proven to fail: dropping private ownership from the pin style, writing the pin flag back as
// an attribute on the frame's <html>, or arming `fonts.ready` unconditionally changes the
// epoch. Removing iframe from the automatic safety boundary makes the read assertion red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { getStyleEnvEpoch } from '../src/modules/styles.js'

let wrap = null
afterEach(() => { wrap?.remove(); wrap = null; vi.restoreAllMocks() })

async function mount() {
  wrap = document.createElement('div')
  wrap.style.cssText = 'width:320px;padding:10px;background:#eee'
  wrap.innerHTML = '<p>above</p><iframe style="width:280px;height:120px;border:1px solid #999" srcdoc="<body style=\'margin:0;background:#cfe\'><h2>inside</h2></body>"></iframe><p>below</p>'
  document.body.appendChild(wrap)
  const fr = wrap.querySelector('iframe')
  if (!fr.contentDocument || fr.contentDocument.readyState !== 'complete' || !fr.contentDocument.body?.firstChild) {
    await new Promise((r) => { fr.onload = r; setTimeout(r, 3000) })
  }
  await new Promise((r) => setTimeout(r, 50))
  return wrap
}

describe('a nested iframe capture', () => {
  it('keeps its pin internal but captures the independent frame fresh', async () => {
    await mount()
    await snapdom(wrap, { burst: true }) // wires the frame document's shared style observers
    await new Promise((r) => setTimeout(r, 0))
    const env = getStyleEnvEpoch()
    const reads = vi.spyOn(window, 'getComputedStyle')
    const res = await snapdom(wrap, { burst: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(getStyleEnvEpoch()).toBe(env)
    expect(reads).toHaveBeenCalled()
    expect(res.url.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('recomputes percentage layout when a fresh iframe capture changes viewport size', async () => {
    wrap = document.createElement('iframe')
    wrap.style.cssText = 'display:block;width:100px;height:100px;border:0'
    document.body.appendChild(wrap)
    const doc = wrap.contentDocument
    doc.open()
    doc.write('<style>html,body{margin:0;width:100%;height:100%}body{background:rgb(0,128,0)}section{width:50%;height:100px;background:rgb(255,0,0)}</style><section></section>')
    doc.close()
    const options = { burst: false, dpr: 1, scale: 1, embedFonts: false }

    await snapdom.toCanvas(wrap, options) // cache style snapshots under a 100px pin
    wrap.style.width = '200px'
    const resized = await snapdom.toCanvas(wrap, options)
    const pixel = resized.getContext('2d', { willReadFrequently: true }).getImageData(75, 50, 1, 1).data

    expect(resized.width).toBe(200)
    expect(Array.from(pixel)).toEqual([255, 0, 0, 255])
  })
})
