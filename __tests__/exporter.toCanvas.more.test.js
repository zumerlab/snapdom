// __tests__/exporter.toCanvas.more.test.js – extra toCanvas coverage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'
import { toCanvas } from '../src/exporters/toCanvas.js'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.mocked(browser.isSafari).mockReturnValue(false)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('toCanvas – width/height branches', () => {
  it('uses explicit width and height', async () => {
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { width: 100, height: 50 })
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(50)
  })

  it('uses width only (scales height proportionally)', async () => {
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { width: 50 })
    expect(canvas.style.width).toBe('50px')
  })

  it('uses height only (scales width proportionally)', async () => {
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { height: 40 })
    expect(canvas.style.height).toBe('40px')
  })

  it('prefers meta.vbW/vbH (post-bleed) over meta.w0/h0 (pre-bleed) so an asymmetric outerShadows bleed does not stretch the output', async () => {
    // w0/h0 ratio is 2:1 (would give height 25 for width 50); vbW/vbH ratio is
    // 4:1 (post-bleed, matches what was actually rasterized) → height ~12.5.
    const canvas = await toCanvas(ONE_BY_ONE_PNG, {
      width: 50,
      meta: { w0: 10, h0: 5, vbW: 20, vbH: 5 }
    })
    expect(canvas.height).toBe(12)
  })
})

describe('toCanvas – backgroundColor', () => {
  it('fills background when backgroundColor is set', async () => {
    const canvas = await toCanvas(ONE_BY_ONE_PNG, { scale: 1, backgroundColor: '#ff0000' })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)
  })
})

describe('toCanvas – Safari SVG box-shadow path', () => {
  it('converts box-shadow to drop-shadow for Safari on SVG URLs', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(true)
    const svgWithBoxShadow = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<style>rect{box-shadow:2px 2px 4px black}</style><rect fill="blue"/></svg>'
    )
    const canvas = await toCanvas(svgWithBoxShadow, {})
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })
})
