import { describe, it, beforeEach, afterEach, afterAll, expect } from 'vitest'
// ✅ variante ESM en jsDelivr (también podés usar unpkg con ?module)
import html2canvas from 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm'
import { snapdom } from '../src/index.js'

function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || ''
  const padding = (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0))
  return Math.floor(b64.length * 0.75) - padding
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
      const snapUrl = await snapdom.toRaw(container)
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
