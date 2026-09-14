import { afterEach, expect, it, vi } from 'vitest'
import { toImg } from '../src/exporters/toImg.js'

afterEach(() => vi.restoreAllMocks())
const svg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>')

it.each([1, 2])('decodes once and returns immediately drawable SVG at scale %s', async scale => {
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode')
  const img = await toImg(svg, { scale })
  expect(decode).toHaveBeenCalledTimes(1)
  expect(img.complete).toBe(true)
  expect(img.naturalWidth).toBe(200 * scale)
  expect(img.style.width).toBe(`${200 * scale}px`)
  if (scale === 1) expect(img.src).toBe(svg)
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 200
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  expect([...ctx.getImageData(50, 50, 1, 1).data]).toEqual([255, 0, 0, 255])
})
