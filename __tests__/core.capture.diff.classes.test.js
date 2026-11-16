// A differential frame that brings no new style key keeps the class numbering and the class
// CSS of the frame before, and renames only the clones it rebuilt or read again. A frame
// with a new key numbers everything again.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

let host, sheet
afterEach(() => { host?.remove(); sheet?.remove() })

const O = { scale: 1, dpr: 1, embedFonts: false }
/** How many pixels of the capture are red, blue and green, and its class CSS. */
const look = async (el) => {
  const res = await snapdom(el, O)
  const canvas = await res.toCanvas()
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const n = { red: 0, blue: 0, green: 0 }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) n.red++
    else if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) n.blue++
    else if (data[i] < 60 && data[i + 1] > 100 && data[i + 2] < 60) n.green++
  }
  const svg = decodeURIComponent(res.url)
  return { ...n, classes: (svg.match(/\.c\d+\{/g) || []).length }
}

describe('differential frame and class numbering', () => {
  it('renames only what changed, and numbers again when a key is new', async () => {
    sheet = document.createElement('style')
    sheet.textContent = '.kr{background:rgb(255,0,0)}.kb{background:rgb(0,0,255)}.kg{background:rgb(0,128,0)}.kbox{width:40px;height:20px}'
    document.head.appendChild(sheet)
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px;background:#fff'
    host.innerHTML = '<div style="height:100px"><div><p style="margin:0;height:20px"><span>label 0</span></p></div>' +
      '<div><div id="a" class="kbox kr"></div></div><div><div id="b" class="kbox kg"></div></div></div>'
    document.body.appendChild(host)
    for (let i = 0; i < 3; i++) await snapdom(host, O)
    const served = () => __diffStats.served
    const first = await look(host)
    expect([first.red, first.blue, first.green]).toEqual([800, 0, 800])

    // No new key: the rebuilt text keeps its class, the boxes keep theirs.
    let s = served()
    host.querySelector('span').textContent = 'label 1'
    const text = await look(host)
    expect(served()).toBe(s + 1)
    expect([text.red, text.blue, text.green, text.classes]).toEqual([800, 0, 800, first.classes])

    // A key nothing held before: every class is numbered again.
    s = served()
    host.querySelector('#a').className = 'kbox kb'
    const blue = await look(host)
    expect(served()).toBe(s + 1)
    expect([blue.red, blue.blue, blue.green]).toEqual([0, 800, 800])

    // Back to a key the CSS still holds, and onto one another box already has.
    s = served()
    host.querySelector('#a').className = 'kbox kg'
    const green = await look(host)
    expect(served()).toBe(s + 1)
    expect([green.red, green.blue, green.green]).toEqual([0, 0, 1600])

    // A full capture agrees.
    const full = await (async () => { const c = await (await snapdom(host, { ...O, burst: false })).toCanvas(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let g = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] > 100 && d[i + 2] < 60) g++; return g })()
    expect(full).toBe(1600)
  })
})
