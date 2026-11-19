// An <embed> exposes no contentDocument, so a text/html embed captured as an empty box while
// the same document in an <object> rasterized. And a frame's wrapper was always a block: the
// second of two inline frames dropped below the first, out of a capture of their line.
// Both found on html2pdf.js's all-tags reference page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
const urls = []
afterEach(() => {
  host?.remove(); host = null
  while (urls.length) URL.revokeObjectURL(urls.pop())
})

function htmlUrl(background) {
  const url = URL.createObjectURL(new Blob([`<!doctype html><body style="margin:0;background:${background}">`], { type: 'text/html' }))
  urls.push(url)
  return url
}

const loaded = (el) => new Promise((resolve) => {
  el.addEventListener('load', resolve, { once: true })
  setTimeout(resolve, 1500)
})

const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]

describe('a same-origin document in an <embed>', () => {
  it('rasterizes like the one in an <object>', async () => {
    host = document.createElement('div')
    host.style.cssText = 'width:60px;height:40px;background:white;line-height:0'
    const embed = document.createElement('embed')
    embed.type = 'text/html'
    embed.style.cssText = 'width:60px;height:40px;border:0'
    const ready = loaded(embed)
    embed.src = htmlUrl('rgb(0,128,0)')
    host.appendChild(embed)
    document.body.appendChild(host)
    await ready

    const res = await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).not.toContain('<embed')
    const [r, g, b] = pixel(await res.toCanvas(), 30, 20)
    expect(g).toBeGreaterThan(100)
    expect(r).toBeLessThan(60)
    expect(b).toBeLessThan(60)
  })
})

describe('two inline frames in one line', () => {
  it('stay side by side', async () => {
    host = document.createElement('div')
    host.style.cssText = 'width:200px;background:white;line-height:0;font-size:0'
    const frames = ['rgb(200,0,0)', 'rgb(0,0,200)'].map((background) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'width:60px;height:40px;border:0'
      frame.srcdoc = `<body style="margin:0;background:${background}">`
      host.appendChild(frame)
      return frame
    })
    document.body.appendChild(host)
    await Promise.all(frames.map(loaded))

    const canvas = await (await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })).toCanvas()
    expect(canvas.height).toBe(40)
    const left = pixel(canvas, 30, 20), right = pixel(canvas, 90, 20)
    expect(left[0]).toBeGreaterThan(150)
    expect(left[2]).toBeLessThan(60)
    expect(right[2]).toBeGreaterThan(150)
    expect(right[0]).toBeLessThan(60)
  })
})
