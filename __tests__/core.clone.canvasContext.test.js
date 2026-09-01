// Capturing must never bind a rendering context to the page's own canvas.
//
// cloneCanvas used to open with node.getContext('2d'), which on a canvas the page has not
// initialized yet does not merely answer the question: it CREATES the context and fixes the
// element's mode for good, so the application's later getContext('webgl') returns null and its
// renderer never starts. A screenshot library breaking the page it screenshots is a different
// class of defect from capturing it wrong.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function host(build) {
  const el = document.createElement('div')
  el.style.cssText = 'width:80px;height:60px;background:#fff'
  document.body.appendChild(el)
  mounted.push(el)
  const canvas = document.createElement('canvas')
  canvas.width = 60
  canvas.height = 40
  el.appendChild(canvas)
  if (build) build(canvas)
  return { el, canvas }
}

describe('capturing a canvas the page has not initialized', () => {
  it('leaves it free to take a WebGL context afterwards', async () => {
    const { el, canvas } = host(null)
    await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false })
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    expect(gl).not.toBeNull()
  })

  it('leaves it free to take a 2d context afterwards', async () => {
    const { el, canvas } = host(null)
    await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false })
    expect(canvas.getContext('2d')).not.toBeNull()
  })

  it('still captures a canvas that HAS been drawn into', async () => {
    const { el, canvas } = host((c) => {
      const ctx = c.getContext('2d')
      ctx.fillStyle = 'rgb(0,0,255)'
      ctx.fillRect(0, 0, 60, 40)
    })
    const out = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false })
    const d = out.getContext('2d').getImageData(10, 10, 1, 1).data
    expect(d[2]).toBeGreaterThan(180)
    expect(d[0]).toBeLessThan(80)
    // and the source keeps working
    expect(canvas.getContext('2d')).not.toBeNull()
  })
})
