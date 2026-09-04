// A capture with a nested same-origin iframe never hit the burst memo. rasterizeIframe pins
// the frame's viewport with a <style> in the frame's <head> and an attribute on its <html>;
// the frame's own invalidation observers (wired per document) read both as external, so
// every capture bumped the environment epoch twice, which is an unconditional dirtyAll on
// the outer element's memo (found 2026-09-03 on d6-demo-gallery-iframe and d449-iframe-
// scaling: memo hit ≈ steady state, ~50 ms). The attribute also stamped every snapshot in
// every document (a record on <html> is the all-stamp). A third bump hid behind those two:
// wiring a document's invalidation (styles.js) armed `fonts.ready.then(bump)`, which on a
// settled font set resolves at once, so the first capture that touched the frame bumped
// the epoch once more and the second capture ran the full pipeline anyway.
//
// Proven to fail: dropping `data-snapdom-internal` from the pin style, writing the pin flag
// back as an attribute on the frame's <html>, or arming `fonts.ready` unconditionally, each
// turns this red.
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

describe('burst memo with a nested iframe', () => {
  it('the pin leaves no external record, so the second capture is a memo hit', async () => {
    await mount()
    await snapdom(wrap, { burst: true }) // wires the frame document's observers, fills the memo
    await new Promise((r) => setTimeout(r, 0))
    const env = getStyleEnvEpoch()
    const reads = vi.spyOn(window, 'getComputedStyle')
    const res = await snapdom(wrap, { burst: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(getStyleEnvEpoch()).toBe(env)
    expect(reads).not.toHaveBeenCalled()
    expect(res.url.startsWith('data:image/svg+xml')).toBe(true)
  })
})
