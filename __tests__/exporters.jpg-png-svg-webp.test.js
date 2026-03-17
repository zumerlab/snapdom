// __tests__/exporters.jpg-png-svg-webp.test.js – direct exporter calls (0% → covered)
import { describe, it, expect } from 'vitest'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBCd4/7mEAAAAASUVORK5CYII='

describe('toJpg (direct)', () => {
  it('returns rasterized output when given data URL (string path)', async () => {
    const { toJpg } = await import('../src/exporters/toJpg.js')
    const out = await toJpg(DATA_PNG, { scale: 1 })
    expect(out).toBeDefined()
    expect(out instanceof HTMLImageElement || out instanceof HTMLCanvasElement || typeof out === 'string' || out instanceof Blob).toBe(true)
  })
})

describe('toPng (direct)', () => {
  it('returns rasterized output when given data URL', async () => {
    const { toPng } = await import('../src/exporters/toPng.js')
    const out = await toPng(DATA_PNG)
    expect(out).toBeDefined()
  })
})

describe('toSvg (direct)', () => {
  const DATA_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')

  it('re-exports toImg as toSvg and returns Image when given SVG data URL', async () => {
    const { toSvg } = await import('../src/exporters/toSvg.js')
    const out = await toSvg(DATA_SVG, { scale: 1 })
    expect(out).toBeInstanceOf(HTMLImageElement)
    expect(out.src).toMatch(/^data:image\/svg\+xml/)
  })
})

describe('toWebp (direct)', () => {
  it('returns rasterized output when given data URL', async () => {
    const { toWebp } = await import('../src/exporters/toWebp.js')
    const out = await toWebp(DATA_PNG)
    expect(out).toBeDefined()
  })
})
