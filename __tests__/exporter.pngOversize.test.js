import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { download } from '../src/exporters/download.js'
import { toBlob } from '../src/exporters/toBlob.js'
import { toCanvas } from '../src/exporters/toCanvas.js'
import { toLargePng } from '../src/exporters/toLargePng.js'
import { isSafari } from '../src/utils/browser.js'

const roots = []
afterEach(() => {
  roots.splice(0).forEach(root => root.remove())
  vi.restoreAllMocks()
})

function svg(width, height, content, viewBox = `0 0 ${width} ${height}`) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${content}</svg>`
  )
}

// Read the file dimensions independently of browser image limits. onload deliberately
// replaces decode(): Chromium can display an oversized PNG while decode() rejects it.
async function inspectPng(blob, points = []) {
  expect(blob).toBeInstanceOf(Blob)
  expect(blob.type).toBe('image/png')
  const bytes = new Uint8Array(await blob.slice(0, 33).arrayBuffer())
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const header = new DataView(bytes.buffer)
  const size = [header.getUint32(16), header.getUint32(20)]
  if (!points.length) return { size, pixels: [] }

  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('The exported PNG did not load'))
      image.src = url
    })
    expect([image.naturalWidth, image.naturalHeight]).toEqual(size)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    const pixels = points.map(([x, y]) => {
      context.clearRect(0, 0, 1, 1)
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    })
    return { size, pixels }
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}

function mount(css) {
  const root = document.createElement('div')
  root.style.cssText = css
  document.body.append(root)
  roots.push(root)
  return root
}

const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]
const CLEAR = [0, 0, 0, 0]

describe('oversized PNG file exports', () => {
  it('leaves an ordinary SVG on the native encoder path', () => {
    expect(toLargePng(svg(20, 30, '<rect width="20" height="30" fill="red"/>'), {
      scale: 2, dpr: 1,
    })).toBeNull()
  })

  it.each(['tall', 'wide'])('preserves the full %s side and its last pixels', async direction => {
    const tall = direction === 'tall'
    const width = tall ? 12 : 40003
    const height = tall ? 40003 : 12
    const url = svg(width, height,
      `<rect width="${width}" height="${height}" fill="red"/>` +
      `<rect x="${tall ? 0 : 40000}" y="${tall ? 40000 : 0}" width="${tall ? 12 : 3}" height="${tall ? 3 : 12}" fill="blue"/>`
    )
    const points = tall ? [[5, 0], [5, 8191], [5, 32768], [5, 40002]]
      : [[0, 5], [8191, 5], [32768, 5], [40002, 5]]
    const result = await inspectPng(await toBlob(url, { format: 'png', scale: 1, dpr: 1 }), points)
    expect(result.size).toEqual([width, height])
    expect(result.pixels).toEqual([RED, RED, RED, BLUE])
  })

  it('applies scale and DPR once, retaining fractional output truncation', async () => {
    const url = svg(20, 24001,
      '<rect width="20" height="24001" fill="red"/><rect y="23990" width="20" height="11" fill="blue"/>'
    )
    const result = await inspectPng(await toBlob(url, {
      format: 'png', scale: 1.25, dpr: 1.5,
    }), [[10, 10], [10, 45000]])
    expect(result.size).toEqual([37, 45001])
    expect(result.pixels).toEqual([RED, BLUE])
  })

  it('uses an absolute width ahead of scale while preserving the viewBox aspect', async () => {
    const url = svg(20, 24000, '<rect width="20" height="24000" fill="red"/>')
    const result = await inspectPng(await toBlob(url, {
      format: 'png', width: 30, scale: 9, dpr: 1.25,
      meta: { vbW: 20, vbH: 24000 },
    }), [[10, 44999]])
    expect(result.size).toEqual([37, 45000])
    expect(result.pixels).toEqual([RED])
  })

  it('keeps the letterbox of an SVG whose viewport is taller than its viewBox', async () => {
    const url = svg(20, 40004,
      '<rect width="20" height="10000" fill="red"/><rect y="10000" width="20" height="10000" fill="blue"/>',
      '0 0 20 20000'
    )
    const result = await inspectPng(await toBlob(url, { format: 'png', dpr: 1 }),
      [[10, 5000], [10, 11000], [10, 29000], [10, 35000]])
    expect(result.size).toEqual([20, 40004])
    expect(result.pixels).toEqual([CLEAR, RED, BLUE, CLEAR])
  })

  it('preserves capture-time width and height semantics across SVG engines', async () => {
    const root = mount('width:20px;height:20000px;background:red')
    root.innerHTML = '<div style="height:10000px"></div><div style="height:10000px;background:blue"></div>'
    const captured = await snapdom(root, {
      width: 20, height: 40004, dpr: 1, embedFonts: false,
    })
    const control = await captured.toCanvas({ crop: { x: 0, y: 12000, width: 20, height: 1000 }, width: 20, height: 2000 })
    expect([...control.getContext('2d').getImageData(10, 1000, 1, 1).data], 'existing crop shows the lower block').toEqual(BLUE)
    const result = await inspectPng(await captured.toBlob({ format: 'png' }),
      [[10, 5000], [10, 11000], [10, 29000], [10, 35000]])
    expect(result.size).toEqual([20, 40004])
    // Safari keeps an unscaled capture header; the exporter then stretches that bitmap.
    expect(result.pixels).toEqual(isSafari() ? [RED, RED, BLUE, BLUE] : [CLEAR, RED, BLUE, CLEAR])
  })

  it('windows an oversized intrinsic SVG even when the requested file is smaller', async () => {
    const url = svg(20, 40000,
      '<rect width="20" height="20000" fill="red"/><rect y="20000" width="20" height="20000" fill="blue"/>'
    )
    const result = await inspectPng(await toBlob(url, {
      format: 'png', width: 10, dpr: 1, meta: { vbW: 20, vbH: 40000 },
    }), [[5, 100], [5, 19999]])
    expect(result.size).toEqual([10, 20000])
    expect(result.pixels).toEqual([RED, BLUE])
  })

  it('retains percentage geometry instead of resolving it against each window', async () => {
    const url = svg(18, 40001,
      '<rect width="100%" height="100%" fill="red"/><rect y="50%" width="100%" height="50%" fill="blue"/>'
    )
    const result = await inspectPng(await toBlob(url, { format: 'png', dpr: 1 }),
      [[9, 100], [9, 17000], [9, 25000], [9, 40000]])
    expect(result.size).toEqual([18, 40001])
    expect(result.pixels).toEqual([RED, RED, BLUE, BLUE])
  })

  it('keeps crop origin, fractional bounds and intrinsic density when width alone is set', async () => {
    const url = svg(40, 30000,
      '<rect width="20" height="30000" fill="red"/><rect y="22000" width="20" height="20" fill="blue"/>',
      '0 0 20 30000'
    )
    const result = await inspectPng(await toBlob(url, {
      format: 'png', width: 30, dpr: 1.5,
      crop: { x: 3.25, y: 10.5, width: 10.5, height: 22000.75 },
    }), [[22, 100], [22, 47140]])
    expect(result.size).toEqual([45, 47142])
    expect(result.pixels).toEqual([RED, BLUE])
  })

  it.each([[20000, 2], [12000, 4], [20000, 1]])('exports frozen content and asymmetric shadow bleed at height %i and scale %i', async (height, scale) => {
    const root = mount(`width:20px;height:${height}px;background:red;box-shadow:6px 9px 0 blue`)
    const captured = await snapdom(root, { dpr: 1, embedFonts: false, outerShadows: true })
    const { vbW, vbH, contentX, contentY } = captured.meta
    root.style.background = 'lime'
    root.style.boxShadow = 'none'
    const control = await captured.toCanvas({ crop: { x: 0, y: 0, width: vbW, height: 1000 }, scale })
    expect([...control.getContext('2d').getImageData(
      Math.floor((contentX + 24) * scale), Math.floor((contentY + 100) * scale), 1, 1
    ).data], 'existing crop path shadow').toEqual(BLUE)
    const result = await inspectPng(await captured.toBlob({ format: 'png', scale }), [
      [Math.floor((contentX + 10) * scale), Math.floor((contentY + 100) * scale)],
      [Math.floor((contentX + 24) * scale), Math.floor((contentY + 100) * scale)],
    ])
    expect(result.size).toEqual([Math.floor(vbW * scale), Math.floor(vbH * scale)])
    expect(result.pixels).toEqual([RED, BLUE])
  })

  it('preserves gradient color, exact alpha and seam markers across raster windows', async () => {
    const content = '<defs><linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">' +
      '<stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>' +
      '<rect x="30" y="30" width="540" height="71940" fill="url(#paint)" opacity="0.63"/>' +
      '<rect x="120" y="49134" width="360" height="36" fill="blue"/>' +
      '<rect x="300" y="49140" width="120" height="42" fill="lime" opacity="0.5"/>' +
      '<rect x="10%" y="80%" width="20%" height="10%" fill="lime"/>'
    const options = { format: 'png', width: 100, height: 12000, dpr: 1 }
    const reference = await toCanvas(svg(100, 12000, content, '0 0 600 72000'), options)
    const referencePixels = reference.getContext('2d').getImageData(0, 0, 100, 12000).data
    const { encodePng } = await import('../src/modules/png.js')
    const blobs = [
      await toBlob(svg(600, 72000, content), options),
      await new Promise(resolve => reference.toBlob(resolve, 'image/png')),
      await encodePng(100, 12000, (async function* () { yield referencePixels })()),
    ]
    const buffers = []
    for (const blob of blobs) {
      const url = URL.createObjectURL(blob)
      const image = new Image()
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve
          image.onerror = reject
          image.src = url
        })
        expect([image.naturalWidth, image.naturalHeight]).toEqual([100, 12000])
        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 12000
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        buffers.push(ctx.getImageData(0, 0, 100, 12000).data)
        canvas.width = canvas.height = 0
      } finally {
        image.src = ''
        URL.revokeObjectURL(url)
      }
    }
    let maximumDifference = 0
    let encoderDifference = 0
    let alphaDifference = 0
    for (let i = 0; i < buffers[0].length; i++) {
      const difference = Math.abs(buffers[0][i] - buffers[1][i])
      maximumDifference = Math.max(maximumDifference, difference)
      encoderDifference = Math.max(encoderDifference, Math.abs(buffers[2][i] - buffers[1][i]))
      if (i % 4 === 3) alphaDifference = Math.max(alphaDifference, difference)
    }
    // The same native canvas encoded through readback is exact. Separate SVG windows
    // change native gradient quantization: measured max RGB delta 2 in Chromium, 4 in
    // WebKit. Geometry, alpha and opaque boundary markers must still remain exact.
    expect(encoderDifference).toBe(0)
    expect(alphaDifference).toBe(0)
    expect(maximumDifference).toBeLessThanOrEqual(4)
    for (const [x, y, expected] of [[30, 8191, BLUE], [30, 8192, BLUE], [30, 8194, BLUE], [15, 10000, [0, 255, 0, 255]]]) {
      const at = (y * 100 + x) * 4
      expect([...buffers[0].slice(at, at + 4)]).toEqual(expected)
      expect([...buffers[1].slice(at, at + 4)]).toEqual(expected)
    }
  })

  it('does not paint author SVG background CSS a second time on the window wrapper', async () => {
    const content = '<style>svg{background:rgba(0,255,0,0.5)}</style>' +
      '<rect x="5" y="0" width="5" height="40000" fill="red"/>'
    const expected = await inspectPng(await toBlob(svg(20, 12000, content, '0 0 20 40000'), {
      format: 'png', dpr: 1,
    }), [[1, 100], [1, 10000]])
    const actual = await inspectPng(await toBlob(svg(20, 40000, content), {
      format: 'png', width: 20, height: 12000, dpr: 1,
    }), [[1, 100], [1, 10000]])
    expect(expected.pixels[0][1], 'native SVG background paints green').toBe(255)
    expect(expected.pixels[0][3], 'native SVG background is not empty').toBeGreaterThan(0)
    expect(actual.size).toEqual(expected.size)
    expect(actual.pixels).toEqual(expected.pixels)
  })

  it('applies author SVG opacity once while windowing the original capture', async () => {
    const content = '<style>svg{opacity:0.5}</style><rect width="20" height="40000" fill="red"/>'
    const expected = await inspectPng(await toBlob(svg(20, 12000, content, '0 0 20 40000'), {
      format: 'png', dpr: 1,
    }), [[10, 100], [10, 10000]])
    const actual = await inspectPng(await toBlob(svg(20, 40000, content), {
      format: 'png', width: 20, height: 12000, dpr: 1,
    }), [[10, 100], [10, 10000]])
    expect(expected.pixels[0][0]).toBe(255)
    expect(expected.pixels[0][3]).toBeGreaterThan(100)
    expect(expected.pixels[0][3]).toBeLessThan(150)
    expect(actual.size).toEqual(expected.size)
    expect(actual.pixels).toEqual(expected.pixels)
  })

  it('keeps captured SVG group styles off the raster-window wrapper', async () => {
    const root = mount('width:20px;height:20000px')
    root.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20000">' +
      '<style>g{opacity:0.5!important}</style><g><rect width="20" height="20000" fill="red"/></g></svg>'
    const captured = await snapdom(root, { dpr: 1, embedFonts: false })
    expect(decodeURIComponent(captured.url)).toContain('g{opacity:0.5!important}')
    const control = await captured.toCanvas({ crop: { x: 0, y: 0, width: 20, height: 1000 }, scale: 2 })
    const expected = [...control.getContext('2d').getImageData(10, 100, 1, 1).data]
    expect(expected[0]).toBe(255)
    expect(expected[3]).toBeGreaterThan(100)
    expect(expected[3]).toBeLessThan(150)
    const result = await inspectPng(await captured.toBlob({ format: 'png', scale: 2 }), [[10, 100], [10, 39900]])
    expect(result.size).toEqual([40, 40000])
    expect(result.pixels).toEqual([expected, expected])
  })

  it('downloads a full-resolution PNG with the existing DPR-one contract', async () => {
    let file
    let clicked
    const createObjectURL = URL.createObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      if (blob.type === 'image/png') file = blob
      return createObjectURL(blob)
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked = { filename: this.download, href: this.href }
    })
    await download(svg(16, 40000, '<rect width="16" height="40000" fill="red"/>'), {
      format: 'png', filename: 'long-page', scale: 1.5, dpr: 4,
    })
    expect(clicked).toEqual({ filename: 'long-page.png', href: expect.stringMatching(/^blob:/) })
    const result = await inspectPng(file, [[10, 59999]])
    expect(result.size).toEqual([24, 60000])
    expect(result.pixels).toEqual([RED])
  })
})
