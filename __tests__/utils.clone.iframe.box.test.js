// A captured iframe is replaced by a wrapper that carries its box and a bitmap of its
// document. The wrapper took the iframe's border-box size as its content size, so a bordered
// iframe came out wider and taller by its borders: as the capture root it lost its right and
// bottom border (live parity, d41-iframe-pseudo, 1.3% on three engines), and inside a page it
// pushed what follows.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

const mount = async () => {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;background:#fff'
  host.innerHTML = '<div id="row" style="display:inline-block;font-size:0"><iframe srcdoc="<body style=\'margin:0;background:#fff\'></body>" ' +
    'style="width:100px;height:50px;border:10px solid rgb(255,0,0);display:block"></iframe>' +
    '<div style="height:10px;background:rgb(0,0,255)"></div></div>'
  document.body.appendChild(host)
  const frame = host.querySelector('iframe')
  if (frame.contentDocument?.readyState !== 'complete' || !frame.contentDocument.body) await new Promise((r) => frame.addEventListener('load', r, { once: true }))
  return frame
}
const pixels = async (el) => {
  const canvas = await (await snapdom(el, { scale: 1, dpr: 1, embedFonts: false, burst: false })).toCanvas()
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  return { size: [canvas.width, canvas.height], at: (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)).join(',') }
}

describe('a bordered iframe keeps its box', () => {
  it('as the capture root: all four borders', async () => {
    const frame = await mount()
    const { size, at } = await pixels(frame)
    expect(size).toEqual([120, 70])
    expect([at(5, 35), at(115, 35), at(60, 5), at(60, 65)]).toEqual(['255,0,0', '255,0,0', '255,0,0', '255,0,0'])
  })

  it('inside a page: what follows it stays where it is', async () => {
    await mount()
    const { size, at } = await pixels(host.querySelector('#row'))
    expect(size).toEqual([120, 80])
    expect([at(115, 35), at(60, 65), at(60, 75)]).toEqual(['255,0,0', '255,0,0', '0,0,255'])
  })
})
