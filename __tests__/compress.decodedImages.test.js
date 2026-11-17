// The page has already decoded its <img> elements: an oversized one is drawn to its visible
// size from the live element, instead of being read again, turned into megabytes of base64,
// written to the clone and decoded a second time (compress.js, drawDecodedImages).
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const OPTS = { dpr: 1, scale: 1, embedFonts: false, burst: false, cache: 'disabled' }
let host
const urls = []

afterEach(() => { host?.remove(); for (const u of urls.splice(0)) URL.revokeObjectURL(u) })

/** A 1600x800 PNG: two colour marks on top, one-pixel black and white columns in a band,
 *  noise everywhere else so the file weighs megabytes, like a photo. */
async function photo(type = 'image/png') {
  const c = document.createElement('canvas')
  c.width = 1600; c.height = 800
  const x = c.getContext('2d')
  const noise = x.createImageData(1600, 800)
  let seed = 7
  for (let i = 0; i < noise.data.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise.data[i] = i % 4 === 3 ? 255 : seed >> 16 & 255 }
  x.putImageData(noise, 0, 0)
  for (let i = 0; i < 1600; i++) { x.fillStyle = i % 2 ? '#fff' : '#000'; x.fillRect(i, 300, 1, 200) }
  x.fillStyle = '#f00'; x.fillRect(0, 0, 800, 100)
  x.fillStyle = '#00f'; x.fillRect(800, 0, 800, 100)
  const blob = await new Promise((resolve) => c.toBlob(resolve, type, 0.9))
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return url
}

async function mount(src) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;width:400px;background:#fff'
  host.innerHTML = `<img src="${src}" style="display:block;width:400px;height:200px">`
  document.body.appendChild(host)
  await host.firstChild.decode()
  return host
}

/** The longest string written to an attribute while `run` works. */
async function longestWrite(run) {
  const own = Element.prototype.setAttribute
  let longest = 0
  Element.prototype.setAttribute = function (name, value) { longest = Math.max(longest, String(value).length); return own.call(this, name, value) }
  try { return { result: await run(), longest } } finally { Element.prototype.setAttribute = own }
}

describe('an oversized <img> the page has decoded', () => {
  it('reaches the clone at its visible size, with no megabyte string written on the way', async () => {
    const root = await mount(await photo())
    const { result, longest } = await longestWrite(() => snapdom(root, OPTS))
    const canvas = await result.toCanvas()
    const at = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))
    expect(at(100, 10)[0]).toBeGreaterThan(200)
    expect(at(300, 10)[2]).toBeGreaterThan(200)
    // The original is megabytes of base64; what is written is the 400x200 image drawn from it.
    expect(longest).toBeLessThan(700000)
  })

  it('exports at a higher scale later as sharp as the original, even with its URL gone', async () => {
    const url = await photo()
    const root = await mount(url)
    const result = await snapdom(root, OPTS)
    root.firstChild.removeAttribute('src')
    URL.revokeObjectURL(url)
    const canvas = await result.toCanvas({ scale: 4 })
    expect(canvas.width).toBe(1600)
    // One-pixel columns survive only from the 1600px original: from the 400px image they are grey.
    const row = canvas.getContext('2d').getImageData(0, 400, 1600, 1).data
    let crisp = 0
    for (let i = 0; i < row.length; i += 4) if (row[i] < 40 || row[i] > 215) crisp++
    expect(crisp).toBeGreaterThan(1400)
  })

  it('is left to the original bytes when compress is off', async () => {
    const root = await mount(await photo())
    const result = await snapdom(root, { ...OPTS, compress: false })
    const canvas = await result.toCanvas({ scale: 4 })
    const row = canvas.getContext('2d').getImageData(0, 400, 1600, 1).data
    let crisp = 0
    for (let i = 0; i < row.length; i += 4) if (row[i] < 40 || row[i] > 215) crisp++
    expect(crisp).toBeGreaterThan(1400)
  })
})

describe('an image the decoded path must leave to the passes', () => {
  /** Every value written to an img `src` while the element is captured, and the canvas. */
  async function srcWrites(html, opts = OPTS) {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:400px;background:#fff'
    host.innerHTML = html
    document.body.appendChild(host)
    await host.querySelector('img').decode().catch(() => {})
    const own = Element.prototype.setAttribute
    const writes = []
    Element.prototype.setAttribute = function (name, value) { if (name === 'src' && this.localName === 'img') writes.push(String(value)); return own.call(this, name, value) }
    let canvas
    try { canvas = await (await snapdom(host, opts)).toCanvas() } finally { Element.prototype.setAttribute = own }
    const at = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))
    return { writes, at }
  }
  const drawn = (writes) => writes.filter((v) => /^data:image\/(?:png|jpeg|webp)/.test(v))

  it('an SVG stays vector', async () => {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="800" height="800" fill="#f00"/><rect x="800" width="800" height="800" fill="#00f"/></svg>')
    const { writes, at } = await srcWrites(`<img src="${svg}" style="display:block;width:400px;height:200px">`)
    expect(drawn(writes)).toEqual([])
    expect(at(100, 100)[0]).toBeGreaterThan(200)
    expect(at(300, 100)[2]).toBeGreaterThan(200)
  })

  // Left to compress, which has always turned an oversized GIF into a still of its first frame.
  it('a GIF is still captured', async () => {
    const { at } = await srcWrites('<img src="data:image/gif;base64,R0lGODdhQABAAIEAAP8AAAAA/wAAAAAAACwAAAAAQABAAEAI2AABCBxIsKDBgwQDKFzIsKHDhwwRSpxYEKLFiw0papSIsaPFjSArehwZMaRJkigDmDyZcuTKkC1dvtwY0+NMmjUx3tSYU+fOiT0v/gQaFOJQjkUfHkWYVOlSg00dPoUateTUgVWtXgWQdeFWrF1VfuUadizZrmbDiv2qNm3ZsW3hvmU7d2tcumjl5sWb1e1eu3Wv3gX8V3DgqYMNF0Z8+GlixosdN176WHJkypOPVsZ8WXPmoZs9dwb9+Wdo0qNNl955WnVq1qtvtob9WnbsmbNt18Z9+6XagAA7" style="display:block;width:16px;height:16px">')
    expect(at(3, 8)[0]).toBeGreaterThan(200)
    expect(at(12, 8)[2]).toBeGreaterThan(200)
  })

  it('an SVG behind a blob: URL stays vector', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="800" height="800" fill="#f00"/><rect x="800" width="800" height="800" fill="#00f"/></svg>'
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    urls.push(url)
    const { writes, at } = await srcWrites(`<img src="${url}" style="display:block;width:400px;height:200px">`)
    expect(drawn(writes)).toEqual([])
    expect(writes.some((v) => v.startsWith('data:image/svg+xml'))).toBe(true)
    expect(at(100, 100)[0]).toBeGreaterThan(200)
    expect(at(300, 100)[2]).toBeGreaterThan(200)
  })

  it('a JPEG behind a blob: URL is drawn as a JPEG', async () => {
    const { writes, at } = await srcWrites(`<img src="${await photo('image/jpeg')}" style="display:block;width:400px;height:200px">`)
    expect(drawn(writes).length).toBe(1)
    expect(drawn(writes)[0].startsWith('data:image/jpeg')).toBe(true)
    expect(at(100, 10)[0]).toBeGreaterThan(200)
    expect(at(300, 10)[2]).toBeGreaterThan(200)
  })

  it('object-fit: none keeps the file at its own size', async () => {
    const { writes } = await srcWrites(`<img src="${await photo()}" style="display:block;width:400px;height:200px;object-fit:none">`)
    // The box crops the 1600x800 file: a 400x200 copy would show it whole.
    expect(writes.filter((v) => v.startsWith('data:image') && v.length < 700000)).toEqual([])
  })

  it('a yielding capture draws no live image in its own task', async () => {
    const own = CanvasRenderingContext2D.prototype.drawImage
    const html = async () => `<img src="${await photo()}" style="display:block;width:400px;height:200px">`
    let live = 0
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) { if (image?.localName === 'img' && image.isConnected && image.closest('div') === host) live++; return own.call(this, image, ...rest) }
    try {
      await srcWrites(await html())
      expect(live).toBe(1)
      host.remove()
      live = 0
      await srcWrites(await html(), { ...OPTS, fast: false })
      expect(live).toBe(0)
    } finally { CanvasRenderingContext2D.prototype.drawImage = own }
  })

  it('an image shown at its own size is not redrawn', async () => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 200
    const x = c.getContext('2d')
    x.fillStyle = '#f00'; x.fillRect(0, 0, 200, 200)
    x.fillStyle = '#00f'; x.fillRect(200, 0, 200, 200)
    const src = c.toDataURL('image/png')
    const { writes, at } = await srcWrites(`<img src="${src}" style="display:block;width:400px;height:200px">`)
    expect(writes.filter((v) => v !== src)).toEqual([])
    expect(at(100, 100)[0]).toBeGreaterThan(200)
    expect(at(300, 100)[2]).toBeGreaterThan(200)
  })

  it('a canvas that cannot be read falls back, and the image is still captured', async () => {
    const own = HTMLCanvasElement.prototype.toDataURL
    let refused = 0
    // What a cross-origin image without CORS does to the canvas it was drawn on.
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (!refused && this.width === 400 && this.height === 200) { refused++; throw new DOMException('Tainted canvases may not be exported.', 'SecurityError') }
      return own.apply(this, args)
    }
    try {
      const { at } = await srcWrites(`<img src="${await photo()}" style="display:block;width:400px;height:200px">`)
      expect(refused).toBe(1)
      expect(at(100, 10)[0]).toBeGreaterThan(200)
      expect(at(300, 10)[2]).toBeGreaterThan(200)
    } finally { HTMLCanvasElement.prototype.toDataURL = own }
  })
})
