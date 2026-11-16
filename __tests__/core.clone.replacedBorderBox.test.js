import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

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
