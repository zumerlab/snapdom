import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { cache } from '../src/core/cache.js'
import { compressClonedImages, compressClonedBackgrounds, compressClonedSvgImages, restoreCompressedAssets, snapshotCompressedAssets } from '../src/modules/compress.js'

afterEach(() => { vi.restoreAllMocks(); cache.compress.clear() })

function stripes(size = 400) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  for (let x = 0; x < size; x++) {
    ctx.fillStyle = x % 2 ? '#fff' : '#000'
    ctx.fillRect(x, 0, 1, size)
  }
  return canvas.toDataURL()
}

const options = { dpr: 1, burst: false, embedFonts: false }
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data

async function compare(host, extra = {}) {
  const before = await snapdom.toCanvas(host, { ...options, ...extra, compress: false })
  const after = await snapdom.toCanvas(host, { ...options, ...extra })
  expect([after.width, after.height]).toEqual([before.width, before.height])
  const a = pixels(before), b = pixels(after)
  let difference = 0
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i])
  expect(difference).toBe(0)
}

describe('compression uses output resolution', () => {
  it.each([{ width: 400 }, { height: 400 }, { width: 400, scale: 0.25 }])('preserves pixels for output sizing %j', async extra => {
    const host = document.createElement('div')
    host.style.cssText = 'width:100px;height:100px'
    const img = document.createElement('img')
    img.src = stripes()
    img.style.cssText = 'display:block;width:100px;height:100px'
    host.append(img)
    document.body.append(host)
    try { await img.decode(); await compare(host, extra) } finally { host.remove() }
  })

  it.each(['viewBox', 'transform', 'css-size'])('preserves SVG image detail through %s scaling', async kind => {
    const host = document.createElement('div')
    host.style.cssText = 'width:400px;height:400px'
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 ${kind === 'viewBox' ? 100 : 400} ${kind === 'viewBox' ? 100 : 400}"><image width="100" height="100" ${kind === 'transform' ? 'transform="scale(4)"' : kind === 'css-size' ? 'style="width:400px;height:400px"' : ''}/></svg>`
    host.querySelector('image').setAttribute('href', stripes())
    document.body.append(host)
    try { await compare(host) } finally { host.remove() }
  })

  it.each(['transform:scale(4)', 'scale:4'])('preserves image detail under CSS %s', async transform => {
    const host = document.createElement('div')
    host.style.cssText = 'width:400px;height:400px'
    const img = document.createElement('img')
    img.src = stripes()
    img.style.cssText = `display:block;width:100px;height:100px;transform-origin:top left;${transform}`
    host.append(img)
    document.body.append(host)
    try { await img.decode(); await compare(host) } finally { host.remove() }
  })

  it.each([true, false])('uses the smaller transformed root box for explicit output size (outerTransforms=%s)', async outerTransforms => {
    const host = document.createElement('div')
    host.style.cssText = 'width:100px;height:100px;transform:scale(0.5);transform-origin:top left'
    const img = document.createElement('img')
    img.src = stripes()
    img.style.cssText = 'display:block;width:100px;height:100px'
    host.append(img)
    document.body.append(host)
    try { await img.decode(); await compare(host, { width: 400, outerTransforms }) } finally { host.remove() }
  })

  it('keeps enough pixels for a background larger than its clipping box', async () => {
    const host = document.createElement('div')
    host.style.cssText = `width:100px;height:100px;background-image:url("${stripes()}");background-size:400% 400%;background-repeat:no-repeat`
    document.body.append(host)
    try { await compare(host) } finally { host.remove() }
  })

  it('deduplicates real decode/encode work for identical images in one batch', async () => {
    const source = stripes()
    expect(source.length).toBeLessThan(64 * 1024) // real synchronous fallback, no Worker mock
    const clone = document.createElement('div')
    for (let i = 0; i < 6; i++) {
      const img = document.createElement('img')
      img.src = source
      img.dataset.snapdomWidth = img.dataset.snapdomHeight = '100'
      clone.append(img)
    }
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode')
    const stats = await compressClonedImages(clone, { compress: true, dpr: 1, scale: 1 })
    expect(decode).toHaveBeenCalledTimes(1)
    expect(stats.count).toBe(6)
    expect(clone.firstChild.getAttribute('src').length).toBeLessThan(source.length)
  })

  it('snapshots frozen originals without retaining removed nodes or overwriting plugin changes', async () => {
    const clone = document.createElement('div')
    const img = document.createElement('img')
    const source = stripes()
    img.src = source
    img.dataset.snapdomWidth = img.dataset.snapdomHeight = '100'
    clone.append(img)
    const context = { compress: true, dpr: 1, scale: 1 }
    await compressClonedImages(clone, context)
    const snapshot = snapshotCompressedAssets(clone, context.__compressedAssets)
    expect(snapshot.size).toBe(1)
    const url = () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>')}`
    const restored = restoreCompressedAssets(url(), snapshot)
    const parsed = new DOMParser().parseFromString(decodeURIComponent(restored.slice(restored.indexOf(',') + 1)), 'image/svg+xml')
    expect(parsed.querySelector('img').getAttribute('src')).toBe(source)
    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'
    expect(restoreCompressedAssets(url(), snapshot)).toBe(url())
    img.remove()
    expect(snapshotCompressedAssets(clone, context.__compressedAssets).size).toBe(0)
    expect(snapshot.size).toBe(1) // prior results retain their own immutable instant
  })

  it.each(['img', 'background', 'svg'])('restores captured %s pixels for a later larger scale', async kind => {
    const host = document.createElement('div')
    host.style.cssText = 'width:100px;height:100px'
    const source = stripes()
    if (kind === 'background') host.style.cssText += `;background-image:url("${source}");background-size:cover;background-repeat:no-repeat`
    else if (kind === 'svg') {
      host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image width="100" height="100"/></svg>'
      host.querySelector('image').setAttribute('href', source)
    } else {
      const img = document.createElement('img')
      img.src = source
      img.style.cssText = 'display:block;width:100px;height:100px'
      host.append(img)
      await img.decode()
    }
    document.body.append(host)
    try {
      const plain = await snapdom(host, { ...options, compress: false })
      const compressed = await snapdom(host, options)
      expect(compressed.url.length).toBeLessThan(plain.url.length)
      const a = pixels(await plain.toCanvas({ scale: 4 }))
      const b = pixels(await compressed.toCanvas({ scale: 4 }))
      let difference = 0
      for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i])
      expect(difference).toBe(0)
    } finally { host.remove() }
  })

  it('keeps background priority while compressing and restoring its frozen value', async () => {
    const original = document.createElement('div')
    original.id = 'compression-important-background'
    original.style.cssText = 'width:100px;height:100px;background-size:cover;background-repeat:no-repeat'
    const source = stripes()
    original.style.setProperty('background-image', `url("${source}")`, 'important')
    document.body.append(original)
    try {
      const clone = original.cloneNode(true)
      const context = { compress: true, dpr: 1, scale: 1, element: original }
      const stats = await compressClonedBackgrounds(clone, context, new Map([[clone, original]]))
      expect(stats.count).toBe(1)
      expect(clone.style.getPropertyPriority('background-image')).toBe('important')
      const snapshot = snapshotCompressedAssets(clone, context.__compressedAssets)
      const serialized = '<svg xmlns="http://www.w3.org/2000/svg"><style>#compression-important-background{background-image:none!important}</style><foreignObject>' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>'
      const restored = restoreCompressedAssets(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`, snapshot)
      const parsed = new DOMParser().parseFromString(decodeURIComponent(restored.slice(restored.indexOf(',') + 1)), 'image/svg+xml')
      const div = parsed.querySelector('div')
      expect(div.style.backgroundImage).toBe(original.style.backgroundImage)
      expect(div.style.getPropertyPriority('background-image')).toBe('important')
    } finally { original.remove() }
  })

  it('restores legacy SVG xlink:href with its namespace intact', async () => {
    const ns = 'http://www.w3.org/2000/svg'
    const xlink = 'http://www.w3.org/1999/xlink'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '100')
    svg.setAttribute('height', '100')
    const image = document.createElementNS(ns, 'image')
    const source = stripes()
    image.setAttributeNS(xlink, 'xlink:href', source)
    image.setAttribute('width', '100')
    image.setAttribute('height', '100')
    svg.append(image)
    const context = { compress: true, dpr: 1, scale: 1 }
    expect((await compressClonedSvgImages(svg, context)).count).toBe(1)
    const snapshot = snapshotCompressedAssets(svg, context.__compressedAssets)
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    const restored = restoreCompressedAssets(url, snapshot)
    const parsed = new DOMParser().parseFromString(decodeURIComponent(restored.slice(restored.indexOf(',') + 1)), 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.querySelector('image').getAttributeNS(xlink, 'href')).toBe(source)
    expect(parsed.querySelector('image').getAttribute('href')).toBe(source)
  })

  it('keeps distinct originals per node when their compressed URLs are identical', async () => {
    const clone = document.createElement('div')
    const source = stripes()
    const sources = [source, source.replace(';base64,', ';name=second;base64,')]
    for (const src of sources) {
      const img = document.createElement('img')
      img.src = src
      img.dataset.snapdomWidth = img.dataset.snapdomHeight = '100'
      clone.append(img)
    }
    const context = { compress: true, dpr: 1, scale: 1 }
    expect((await compressClonedImages(clone, context)).count).toBe(2)
    expect(clone.children[0].getAttribute('src')).toBe(clone.children[1].getAttribute('src'))
    const snapshot = snapshotCompressedAssets(clone, context.__compressedAssets)
    const serialized = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>'
    const restored = restoreCompressedAssets(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`, snapshot)
    const parsed = new DOMParser().parseFromString(decodeURIComponent(restored.slice(restored.indexOf(',') + 1)), 'image/svg+xml')
    expect([...parsed.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(sources)
  })
})
