// The selection reaches the pixels, not just the clone. Companion to module.selection.test.js
// (imported from @frostin/snapdom), which covers the DOM the clone pass produces.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted
afterEach(() => {
  window.getSelection().removeAllRanges()
  mounted?.remove()
  mounted = null
})

function mountText(css = '') {
  mounted = document.createElement('div')
  mounted.style.cssText = `width:240px;background:white;font:16px Arial;${css}`
  mounted.textContent = 'SELECT THIS TEXT'
  document.body.appendChild(mounted)
  return mounted
}

function selectAll(el) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Pixels within 40 of the given rgb. */
function hits(canvas, [r, g, b]) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 40 && Math.abs(data[i + 1] - g) < 40 && Math.abs(data[i + 2] - b) < 40) n++
  }
  return n
}

describe('a selected run reaches the raster', () => {
  it('paints an authored ::selection background', async () => {
    const style = document.createElement('style')
    style.textContent = '.sel-fixture::selection { background: rgb(255, 0, 102); color: rgb(255,255,255) }'
    document.head.appendChild(style)
    try {
      const el = mountText()
      el.classList.add('sel-fixture')
      selectAll(el)
      const canvas = await snapdom.toCanvas(el, { dpr: 1, embedFonts: false, captureSelection: true })
      expect(hits(canvas, [255, 0, 102])).toBeGreaterThan(200)
    } finally {
      style.remove()
    }
  })

  it('paints nothing extra when the option is off', async () => {
    const style = document.createElement('style')
    style.textContent = '.sel-fixture::selection { background: rgb(255, 0, 102) }'
    document.head.appendChild(style)
    try {
      const el = mountText()
      el.classList.add('sel-fixture')
      selectAll(el)
      const canvas = await snapdom.toCanvas(el, { dpr: 1, embedFonts: false })
      expect(hits(canvas, [255, 0, 102])).toBe(0)
    } finally {
      style.remove()
    }
  })

  it('leaves an unselected capture identical with the option on', async () => {
    const el = mountText()
    const off = await snapdom.toRaw(el, { embedFonts: false })
    const on = await snapdom.toRaw(el, { embedFonts: false, captureSelection: true })
    expect(on).toBe(off)
  })

  it('paints a focused field selection into the raster', async () => {
    mounted = document.createElement('div')
    mounted.style.cssText = 'width:240px;background:white;padding:8px'
    mounted.innerHTML = '<input value="SELECTED VALUE" style="font:16px Arial;width:200px">'
    document.body.appendChild(mounted)
    const style = document.createElement('style')
    style.textContent = 'input::selection { background: rgb(255, 0, 102) }'
    document.head.appendChild(style)
    try {
      const input = mounted.querySelector('input')
      input.focus()
      input.setSelectionRange(0, input.value.length)
      const canvas = await snapdom.toCanvas(mounted, { dpr: 1, embedFonts: false, captureSelection: true })
      expect(hits(canvas, [255, 0, 102])).toBeGreaterThan(200)
    } finally {
      style.remove()
    }
  })
})
