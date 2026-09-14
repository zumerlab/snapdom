import { describe, it, beforeEach, afterEach, afterAll, expect } from 'vitest'
import { domToDataUrl } from 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm'
import { snapdom } from '../src/index'

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

describe('Output file size snapdom vs modern-screenshot (cdn, averaged)', () => {
  let container
  let report
  const RUNS = 3

  beforeEach(async () => {
    container = document.createElement('div')
    container.style.width = '400px'
    container.style.height = '300px'
    container.style.background = 'linear-gradient(to right, red, blue)'
    container.innerHTML = '<h1>Hello Benchmark</h1><p>Testing multiple runs...</p>'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  afterAll(() => {
    console.log(report)
  })

  it('snapdom output file size should be smaller than modern-screenshot', async () => {
    // The previous version of this file had ZERO expect() calls — the it-block could only
    // fail on an unrelated throw, never on the size claim its name makes — and applied
    // base64 math to snapdom's percent-encoded URL. Rebuilt in the html2canvas sibling's
    // shape: averaged runs, format-aware byte counts, and a real assertion.
    let snapSum = 0
    let msSum = 0

    for (let i = 0; i < RUNS; i++) {
      const snapUrl = await snapdom.toRaw(container, { burst: false })
      snapSum += dataUrlBytes(snapUrl)

      const msUrl = await domToDataUrl(container)
      msSum += dataUrlBytes(msUrl)

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    }

    const snapKB = snapSum / RUNS / 1024
    const msKB = msSum / RUNS / 1024
    const diffPct = ((msKB - snapKB) / msKB) * 100

    report = `snapdom captured file size is ${diffPct.toFixed(2)}% smaller compared to modern-screenshot (${snapKB.toFixed(2)} KB vs. ${msKB.toFixed(2)} KB)`

    expect(snapKB).toBeGreaterThan(0)
    expect(msKB).toBeGreaterThan(0)
    expect(snapKB).toBeLessThan(msKB)
  })
})
