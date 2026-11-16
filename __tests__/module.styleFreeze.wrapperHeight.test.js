import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const OPTS = { dpr: 1, scale: 1, embedFonts: false }
let host

afterEach(() => host?.remove())

/** The blue marker's row in the capture and its live offset inside the root, in the root's px. */
async function markerRows(inner, zoom = '') {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;' + (zoom && `zoom:${zoom}`)
  host.innerHTML = `<div id="root" style="position:relative;width:200px;background:#fff;font:14px/20px Arial,sans-serif;padding:1px 0">
    ${inner}<div id="marker" style="height:6px;background:#00f"></div></div>`
  document.body.appendChild(host)
  const root = host.querySelector('#root')
  const live = root.querySelector('#marker').offsetTop
  const canvas = await (await snapdom(root, OPTS)).toCanvas()
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let captured = -1
  for (let y = 0; y < canvas.height && captured < 0; y++) {
    const i = (y * width + 100) * 4
    if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) captured = y
  }
  return { live, captured }
}

const P = '<p style="margin:16px 0">text</p>'

describe('a wrapper with an authored height keeps it', () => {
  it('under a rotated ancestor, where its rect is as tall as it is wide', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0'
    host.innerHTML = `<style>.tall{height:120px}</style><div id="root" style="width:300px;height:300px;background:#fff">
      <div style="transform:rotate(90deg);transform-origin:150px 150px;width:300px">
        <div class="tall" style="width:200px"><div style="height:20px;background:#f00"></div></div>
        <div style="height:20px;background:#00f"></div></div></div>`
    document.body.appendChild(host)
    const canvas = await (await snapdom(host.querySelector('#root'), OPTS)).toCanvas()
    const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    // Rotated a quarter turn, the blue block is a column 120px from the right edge.
    let blue = -1
    for (let x = width - 1; x >= 0 && blue < 0; x--) { const i = (150 * width + x) * 4; if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) blue = width - 1 - x }
    expect(Math.abs(blue - 120)).toBeLessThanOrEqual(2)
  })
})

describe('a wrapper whose child margins collapse through it keeps an auto height', () => {
  it('plain wrapper', async () => {
    const { live, captured } = await markerRows(`<div>${P}</div>`)
    expect(Math.abs(captured - live)).toBeLessThanOrEqual(1)
  })

  it('wrapper whose only child is display: contents', async () => {
    const { live, captured } = await markerRows(`<div><span style="display:contents">${P}</span></div>`)
    expect(Math.abs(captured - live)).toBeLessThanOrEqual(1)
  })

  it('plain wrapper under an ancestor with zoom', async () => {
    const { live, captured } = await markerRows(`<div>${P}</div>`, '1.3125')
    expect(Math.abs(captured - live)).toBeLessThanOrEqual(1)
  })
})
