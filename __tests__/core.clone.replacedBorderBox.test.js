import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { isSafari } from '../src/utils/browser.js'

const OPTS = { dpr: 1, scale: 1, embedFonts: false }
const POSTER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0a0"/></svg>')
let host

afterEach(() => host?.remove())

/** Mounts `html` followed by a blue marker and returns the marker's row, live and captured. */
async function markerRows(html) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;width:300px;background:#fff'
  host.innerHTML = html + '<div id="marker" style="height:20px;background:#00f"></div>'
  document.body.appendChild(host)
  // Firefox gives an <object> no box until its data has loaded.
  const object = host.querySelector('object')
  if (object) await new Promise((resolve) => { object.addEventListener('load', resolve, { once: true }); setTimeout(resolve, 1000) })
  const live = Math.round(host.querySelector('#marker').getBoundingClientRect().top - host.getBoundingClientRect().top)
  const canvas = await (await snapdom(host, OPTS)).toCanvas()
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let captured = -1
  for (let y = 0; y < canvas.height && captured < 0; y++) {
    const i = (y * width + 250) * 4
    if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] > 215) captured = y
  }
  return { live, captured }
}

describe('a replaced element with a border keeps its box', () => {
  it('content-box <canvas>', async () => {
    const { live, captured } = await markerRows('<canvas width="100" height="50" style="display:block;width:100px;height:50px;border:10px solid #f00;padding:5px"></canvas>')
    expect(captured).toBe(live)
  })

  it('border-box <canvas>', async () => {
    const { live, captured } = await markerRows('<canvas width="100" height="50" style="display:block;box-sizing:border-box;width:100px;height:50px;border:10px solid #f00"></canvas>')
    expect(captured).toBe(live)
  })

  it('content-box <object> holding an image', async () => {
    const { live, captured } = await markerRows(`<object data="${POSTER}" type="image/svg+xml" style="display:block;width:100px;height:50px;border:10px solid #f00;padding:5px"></object>`)
    expect(captured).toBe(live)
  })

  it('content-box <video> showing its poster', async () => {
    const { live, captured } = await markerRows(`<video poster="${POSTER}" style="display:block;width:100px;height:50px;border:10px solid #f00;padding:5px"></video>`)
    expect(captured).toBe(live)
  })
})

// Not on WebKit: its downsample softens every hard edge at 2:1, border or not, so a compressed
// capture never matches a plain one there.
describe.skipIf(isSafari())('a <canvas> with a border under compress', () => {
  /** Share of pixels that differ between a compressed capture and a plain one. */
  async function compressDrift(style) {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:260px;background:#fff'
    host.innerHTML = `<canvas width="400" height="240" style="display:block;width:200px;height:120px;${style}"></canvas>`
    document.body.appendChild(host)
    const ctx = host.firstChild.getContext('2d')
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 400, 240)
    // Hard edges on even backing pixels: crisp at the 2:1 the page shows.
    ctx.fillStyle = '#fbbf24'
    for (let i = 0; i < 9; i++) ctx.fillRect(20 + i * 40, 20, 20, 200)
    const pixels = async (compress) => {
      const canvas = await (await snapdom(host, { ...OPTS, compress, cache: 'disabled' })).toCanvas()
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    }
    const [a, b] = [await pixels(false), await pixels(true)]
    let off = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 48) off++
    return off / (a.length / 4)
  }

  // Downsampled to the border box and then scaled into the content box, every edge moved.
  it('is resampled once, to its content box', async () => {
    expect(await compressDrift('border:1px solid #999')).toBeLessThan(0.005)
    expect(await compressDrift('padding:10px')).toBeLessThan(0.005)
  })

  it('without a border it already was', async () => {
    expect(await compressDrift('')).toBeLessThan(0.005)
  })
})
