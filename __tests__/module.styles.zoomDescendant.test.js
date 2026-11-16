import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const OPTS = { dpr: 1, scale: 1, embedFonts: false }
let host, sheet

afterEach(() => { host?.remove(); sheet?.remove() })

/** The marker's row and the zoomed box's painted width, live and in the capture. */
async function measure(boxAttrs) {
  sheet = document.createElement('style')
  sheet.textContent = '.zoomed{zoom:1.5}'
  document.head.appendChild(sheet)
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;width:400px;background:#fff'
  host.innerHTML = `<div ${boxAttrs} id="box"></div><div id="marker" style="height:20px;background:#00f"></div>`
  document.body.appendChild(host)
  const top = host.getBoundingClientRect().top
  // The box's painted width is 150 everywhere; WebKit's getBoundingClientRect reports 100.
  const live = { marker: Math.round(host.querySelector('#marker').getBoundingClientRect().top - top), width: 150 }
  const canvas = await (await snapdom(host, OPTS)).toCanvas()
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const at = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  let marker = -1
  for (let y = 0; y < canvas.height && marker < 0; y++) { const [r, g, b] = at(390, y); if (r < 40 && g < 40 && b > 215) marker = y }
  let w = 0
  for (let x = 0; x < width; x++) { const [r, g, b] = at(x, 5); if (r > 215 && g < 40 && b < 40) w = x + 1 }
  return { live, captured: { marker, width: w } }
}

describe('zoom on a descendant of the capture root', () => {
  it('set by a class rule', async () => {
    const { live, captured } = await measure('class="zoomed" style="width:100px;height:40px;background:#f00"')
    expect(live.marker).toBe(60)
    expect(captured).toEqual(live)
  })

  it('set by a class rule on a box with an auto width', async () => {
    const { live, captured } = await measure('class="zoomed" style="height:40px;background:#f00"')
    expect(captured).toEqual({ marker: live.marker, width: 400 })
  })

  it('set inline', async () => {
    const { live, captured } = await measure('style="zoom:1.5;width:100px;height:40px;background:#f00"')
    expect(captured).toEqual(live)
  })
})
