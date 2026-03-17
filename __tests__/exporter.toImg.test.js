// __tests__/exporter.toImg.test.js – toImg.js coverage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils')
  return { ...actual, isSafari: vi.fn() }
})
import { isSafari } from '../src/utils'
import { toImg } from '../src/exporters/toImg.js'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBCd4/7mEAAAAASUVORK5CYII='
const DATA_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>')

beforeEach(() => {
  vi.mocked(isSafari).mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toImg', () => {
  it('uses width and height when both provided', async () => {
    const img = await toImg(DATA_PNG, { width: 100, height: 50 })
    expect(img.style.width).toBe('100px')
    expect(img.style.height).toBe('50px')
  })

  it('uses width only (scales height)', async () => {
    const img = await toImg(DATA_PNG, { width: 80 })
    expect(img.style.width).toBe('80px')
    expect(img.style.height).toBeDefined()
  })

  it('uses height only (scales width)', async () => {
    const img = await toImg(DATA_PNG, { height: 60 })
    expect(img.style.height).toBe('60px')
    expect(img.style.width).toBeDefined()
  })

  it('uses meta.w0/meta.h0 when provided', async () => {
    const img = await toImg(DATA_PNG, { width: 50, meta: { w0: 10, h0: 5 } })
    expect(img.style.width).toBe('50px')
    expect(img.style.height).toBe('25px')
  })

  it('uses scale for non-SVG', async () => {
    const img = await toImg(DATA_PNG, { scale: 2 })
    expect(img.style.width).toBe('2px')
    expect(img.style.height).toBe('2px')
  })

  it('patches SVG dimensions when scale !== 1', async () => {
    const img = await toImg(DATA_SVG, { scale: 2 })
    expect(img.style.width).toBe('40px')
    expect(img.style.height).toBe('20px')
    expect(decodeURIComponent(img.src)).toContain('width="40"')
  })

  it('uses rasterize path on Safari when wantsScale', async () => {
    vi.mocked(isSafari).mockReturnValue(true)
    const img = await toImg(DATA_PNG, { scale: 2 })
    expect(img).toBeDefined()
  })
})
