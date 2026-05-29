import { describe, it, expect, beforeEach } from 'vitest'
import { snapdom } from  '../src/index'

describe('snapdom.toJpg backgroundColor option', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.style.width = '100px'
    container.style.height = '100px'
    container.style.background = 'transparent'
    document.body.appendChild(container)
  })

  it('applies white background by default', async () => {
    const img = await snapdom.toJpg(container )
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const pixel = ctx.getImageData(0, 0, 1, 1).data
    // JPEG compresses, but for a solid color it should be near white
    expect(pixel[0]).toBeGreaterThan(240)
    expect(pixel[1]).toBeGreaterThan(240)
    expect(pixel[2]).toBeGreaterThan(240)
  })

  it('applies custom background color', async () => {
    const img = await snapdom.toJpg(container, { backgroundColor: '#00ff00'  })
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const pixel = ctx.getImageData(0, 0, 1, 1).data
    // Green check (JPEG lossy, so check near values)
    expect(pixel[0]).toBeLessThan(30)    // red
    expect(pixel[1]).toBeGreaterThan(200) // green
    expect(pixel[2]).toBeLessThan(30)    // blue
  })
})

describe('lossy format flattening at export time (no format on capture)', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.style.width = '100px'
    container.style.height = '100px'
    container.style.background = 'transparent'
    document.body.appendChild(container)
  })

  // The capture has no `format` (defaults to png, backgroundColor null). The lossy
  // format is requested only at export time via the result helper. White must still
  // be flattened in, otherwise JPEG encodes the transparent area as black.
  it('result.toBlob({ type: "jpeg" }) flattens white instead of black', async () => {
    const result = await snapdom(container)
    const blob = await result.toBlob({ type: 'jpeg' })
    expect(blob.type).toBe('image/jpeg')
    const img = new Image()
    img.src = URL.createObjectURL(blob)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const pixel = ctx.getImageData(0, 0, 1, 1).data
    expect(pixel[0]).toBeGreaterThan(240)
    expect(pixel[1]).toBeGreaterThan(240)
    expect(pixel[2]).toBeGreaterThan(240)
  })

  it('result.toCanvas({ format: "jpeg" }) flattens white instead of leaving transparent', async () => {
    const result = await snapdom(container)
    const canvas = await result.toCanvas({ format: 'jpeg' })
    const ctx = canvas.getContext('2d')
    const pixel = ctx.getImageData(0, 0, 1, 1).data
    expect(pixel[3]).toBe(255)            // opaque
    expect(pixel[0]).toBeGreaterThan(240) // white
    expect(pixel[1]).toBeGreaterThan(240)
    expect(pixel[2]).toBeGreaterThan(240)
  })
})
