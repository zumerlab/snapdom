import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('snapdom API', () => {
  let testElement

  beforeEach(() => {
    testElement = document.createElement('div')
    testElement.style.width = '100px'
    testElement.style.height = '50px'
    document.body.appendChild(testElement )
  })

  afterEach(() => {
    document.body.removeChild(testElement )
  })

  describe('snapdom.toRaw', () => {
    it('should return a SVG data URL', async () => {
      const result = await snapdom.toRaw(testElement )
      expect(result).toMatch(/^data:image\/svg\+xml/)
    })
  })

  describe('snapdom', () => {
    it('toImg should return an HTMLImageElement', async () => {

      const img = await snapdom.toImg(testElement )
      expect(img).toBeInstanceOf(HTMLImageElement)
      expect(img.src).toMatch(/^data:image\/svg\+xml/)

    })

    it('toCanvas should return a HTMLCanvasElement', async () => {
     // const decodeMock = vi.spyOn(window.Image.prototype, 'decode').mockResolvedValue();
      const canvas = await snapdom.toCanvas(testElement )
      expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    //  decodeMock.mockRestore();
    })

    it('toPng should return an HTMLImageElement with PNG data URL', async () => {
    //  const decodeMock = vi.spyOn(window.Image.prototype, 'decode').mockResolvedValue();
      const img = await snapdom.toPng(testElement )
      expect(img).toBeInstanceOf(HTMLImageElement)
      expect(img.src).toMatch(/^data:image\/png/)
    //  decodeMock.mockRestore();
    })

    it('toJpg should return an HTMLImageElement with JPEG data URL', async () => {
     // const decodeMock = vi.spyOn(window.Image.prototype, 'decode').mockResolvedValue();
      const img = await snapdom.toJpg(testElement )
      expect(img).toBeInstanceOf(HTMLImageElement)
      expect(img.src).toMatch(/^data:image\/jpeg/)
     // decodeMock.mockRestore();
    })

    it('toWebp should return an HTMLImageElement with WebP data URL', async () => {
    //  const decodeMock = vi.spyOn(window.Image.prototype, 'decode').mockResolvedValue();
      const img = await snapdom.toWebp(testElement )
      expect(img).toBeInstanceOf(HTMLImageElement)
      expect(img.src).toMatch(/^data:image\/webp/)
    //  decodeMock.mockRestore();
    })

    it('toBlob should return a Blob of type image/svg+xml', async () => {
      const blob = await snapdom.toBlob(testElement )
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('image/svg+xml')
    })
  })
})
