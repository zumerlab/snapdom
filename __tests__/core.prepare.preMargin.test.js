import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const OPTS = { dpr: 1, scale: 1, embedFonts: false }
let host

afterEach(() => host?.remove())

function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;font:14px/20px Arial,sans-serif'
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild
}

/** First canvas row whose pixel at `x` is closer to `rgb` than to anything else painted. */
async function firstRowOf(root, x, [r, g, b]) {
  const canvas = await (await snapdom(root, OPTS)).toCanvas()
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < height; y++) {
    const i = (y * width + x) * 4
    if (Math.abs(data[i] - r) < 40 && Math.abs(data[i + 1] - g) < 40 && Math.abs(data[i + 2] - b) < 40) return y
  }
  return -1
}

const offsetIn = (el, root) => Math.round(el.getBoundingClientRect().top - root.getBoundingClientRect().top)

describe('a <pre> keeps its top margin', () => {
  it('edited in place, the differential frame keeps the margin too', async () => {
    const root = mount(`<div style="width:300px;padding:10px;background:#fff"><div>
      <div style="height:20px;background:#f00"></div>
      <pre style="margin:24px 0;height:20px;background:#0a0;overflow:hidden">before</pre>
      <div id="after" style="height:20px;background:#00f"></div></div></div>`)
    const after = root.querySelector('#after')
    const opts = { ...OPTS, burst: true }
    await snapdom(root, opts)
    root.querySelector('pre').textContent = 'after'
    const canvas = await (await snapdom(root, opts)).toCanvas()
    const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let row = -1
    for (let y = 0; y < canvas.height && row < 0; y++) {
      const i = (y * width + 50) * 4
      if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] > 215) row = y
    }
    expect(row).toBe(offsetIn(after, root))
  })

  it('between two blocks, the block after it stays where the page has it', async () => {
    const root = mount(`<div style="width:300px;padding:10px;background:#fff">
      <div style="height:20px;background:#f00"></div>
      <pre style="margin:24px 0;height:20px;background:#0a0"></pre>
      <div id="after" style="height:20px;background:#00f"></div></div>`)
    const after = root.querySelector('#after')
    expect(await firstRowOf(root, 50, [0, 0, 255])).toBe(offsetIn(after, root))
  })

  it('as the capture root, its last line is inside the image (#75)', async () => {
    const root = mount('<pre style="margin:32px 0;width:200px;background:#fff;color:#fff">a\nb\n<span id="last" style="display:inline-block;width:100px;height:20px;background:#00f"></span></pre>')
    const last = root.querySelector('#last')
    expect(await firstRowOf(root, 50, [0, 0, 255])).toBe(offsetIn(last, root))
  })

  it('as the first child of the root, its last line is inside the image (#75)', async () => {
    const root = mount(`<div style="width:200px;background:#fff"><pre style="margin:32px 0 0;color:#fff">a
b
<span id="last" style="display:inline-block;width:100px;height:20px;background:#00f"></span></pre></div>`)
    const last = root.querySelector('#last')
    expect(await firstRowOf(root, 50, [0, 0, 255])).toBe(offsetIn(last, root))
  })
})
