import { describe, it, beforeEach, afterEach, afterAll, expect } from 'vitest'
// ESM variant on jsDelivr (unpkg with ?module works too)
import html2canvas from 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm'
import { snapdom } from '../src/index.js'

function dataUrlBytes(dataUrl) {
  // Format-aware: snapdom's toRaw is PERCENT-ENCODED svg (`;charset=utf-8,`), not base64 —
  // base64 math (*0.75) on it understated snapdom's bytes while the competitor's PNG data
  // URL IS base64, making the comparison apples to oranges.
  const [head, payload = ''] = dataUrl.split(/,(.*)/s)
  if (/;base64/i.test(head)) {
    const padding = (payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0))
    return Math.floor(payload.length * 0.75) - padding
  }
  return new Blob([decodeURIComponent(payload)]).size
}

describe('Output file size snapdom vs html2canvas (cdn, averaged)', () => {
  let container
  let report
  const RUNS = 3

  beforeEach(() => {
    container = document.createElement('div')
    container.style.width = '400px'
    container.style.height = '300px'
    container.style.background = 'linear-gradient(to right, red, blue)'
    container.innerHTML = '<h1>Hello Benchmark</h1><p>Testing multiple runs...</p>'
    document.body.appendChild(container)
  })

  afterEach(() => {
    container?.remove()
    container = null
  })

  afterAll(() => {

    console.log(report)
  })

  it('snapdom output file size should be smaller than html2canvas', async () => {
    let snapSum = 0
    let h2cSum = 0

    for (let i = 0; i < RUNS; i++) {
      // SnapDOM (SVG dataURL)
      const snapUrl = await snapdom.toRaw(container, { burst: false })
      snapSum += dataUrlBytes(snapUrl)

      // html2canvas → PNG dataURL
      const canvas = await html2canvas(container, { backgroundColor: null })
      const h2cUrl = canvas.toDataURL('image/png')
      h2cSum += dataUrlBytes(h2cUrl)

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    }

    const snapKB = snapSum / RUNS / 1024
    const h2cKB  = h2cSum / RUNS / 1024
    const diffPct = ((h2cKB - snapKB) / h2cKB) * 100

    report = `snapdom captured file size is ${diffPct.toFixed(2)}% smaller compared to html2canvas (${snapKB.toFixed(2)} KB vs. ${h2cKB.toFixed(2)} KB)`

    expect(snapKB).toBeLessThan(h2cKB)
  })
})
