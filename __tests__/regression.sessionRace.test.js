import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// Concurrent captures used to share one cache.session nodeMap: applyCachePolicy runs at
// captureDOM entry but the maps were only snapshotted inside prepareClone, several awaits
// later — a second capture starting in that window reassigned the global, and each capture's
// non-idempotent scroll-compensation loop then also processed the OTHER capture's clones
// (double translate wrapper, content shifted by 2x the scroll).

function makeScroller() {
  const el = document.createElement('div')
  el.style.cssText = 'width:200px;height:100px;overflow:auto'
  const colors = ['red', 'lime', 'blue', 'orange', 'purple']
  for (let i = 0; i < 5; i++) {
    const line = document.createElement('div')
    line.style.cssText = `height:50px;background:${colors[i]}`
    el.appendChild(line)
  }
  document.body.appendChild(el)
  void el.offsetHeight // Firefox: flush layout so the element is scrollable before scrollTop lands
  el.scrollTop = 50
  return el
}

async function centerPixel(result) {
  const canvas = await result.toCanvas()
  const ctx = canvas.getContext('2d')
  const px = ctx.getImageData(Math.floor(canvas.width / 2), 5, 1, 1).data
  return [px[0], px[1], px[2]]
}

describe('concurrent captures own their session maps', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('a scrolled element is wrapped exactly once under Promise.all of two captures', async () => {
    const plain = document.createElement('div')
    for (let i = 0; i < 100; i++) plain.appendChild(document.createElement('span')).textContent = 'x'
    document.body.appendChild(plain)
    const scroller = makeScroller()

    const [_, resB] = await Promise.all([snapdom(plain), snapdom(scroller)])
    const svg = decodeURIComponent(resB.url.split(',')[1])
    const wraps = (svg.match(/translate\(0px,\s*-(?:4[5-9](?:\.\d+)?|50)px\)/g) || []).length
    expect(wraps).toBe(1)

    // Fidelity: at scrollTop=50 the top row shows the middle of the 2nd (lime) band
    const [r, g, b] = await centerPixel(resB)
    expect(g).toBeGreaterThan(200)
    expect(r).toBeLessThan(100)
    expect(b).toBeLessThan(100)
  })

  it('sequential control still wraps once', async () => {
    const scroller = makeScroller()
    const res = await snapdom(scroller)
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect((svg.match(/translate\(0px,\s*-(?:4[5-9](?:\.\d+)?|50)px\)/g) || []).length).toBe(1)
    const [, g] = await centerPixel(res)
    expect(g).toBeGreaterThan(200)
  })

  it('scroll compensation reaches clones from an iframe realm (instanceof HTMLElement is realm-bound)', async () => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:260px;height:160px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<!DOCTYPE html><html><body style="margin:0">
      <div id="sc" style="width:200px;height:100px;overflow:auto">
        <div style="height:50px;background:red"></div>
        <div style="height:50px;background:lime"></div>
        <div style="height:50px;background:blue"></div>
      </div></body></html>`)
    doc.close()
    doc.getElementById('sc').scrollTop = 50
    await new Promise((r) => requestAnimationFrame(r))

    const res = await snapdom(doc.body)
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect((svg.match(/translate\(0px,\s*-(?:4[5-9](?:\.\d+)?|50)px\)/g) || []).length).toBe(1)
  })
})
