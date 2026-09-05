import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { freezeImgSrcset } from '../src/utils/clone.helpers.js'

afterEach(() => { document.body.innerHTML = '' })

function png(color) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 8
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 8, 8)
  return canvas.toDataURL()
}

describe('responsive sources with a fallback src', () => {
  it('captures the selected srcset image when src is an inline fallback', async () => {
    const fallback = png('#f00')
    const selected = png('#0f0')
    const img = document.createElement('img')
    img.src = fallback
    img.srcset = `${selected} 1x`
    img.width = img.height = 32
    document.body.appendChild(img)
    await img.decode()
    expect(img.currentSrc).toBe(selected)

    const shot = await snapdom(img, { burst: false, compress: false, scale: 1, dpr: 1 })
    const canvas = await shot.toCanvas()
    const pixel = canvas.getContext('2d').getImageData(16, 16, 1, 1).data
    expect(pixel[1]).toBeGreaterThan(200)
    expect(pixel[0]).toBeLessThan(20)
    expect(img.getAttribute('src')).toBe(fallback)
    expect(img.srcset).toBe(`${selected} 1x`)
  })

  it('resolves a pending srcset before a non-empty fallback', () => {
    const img = document.createElement('img')
    img.src = png('#f00')
    img.srcset = '/__tests__/fixtures/bh-1x.svg 1x'
    Object.defineProperty(img, 'currentSrc', { get: () => '' })
    const clone = img.cloneNode()

    freezeImgSrcset(img, clone)

    expect(clone.getAttribute('src')).toBe('/__tests__/fixtures/bh-1x.svg')
    expect(clone.hasAttribute('srcset')).toBe(false)
    expect(img.hasAttribute('srcset')).toBe(true)
  })
})
