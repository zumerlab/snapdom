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
async function photo() {
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
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
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
