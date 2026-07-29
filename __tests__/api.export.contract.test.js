// v3 export contract: `format` is the one option name (type = legacy alias), and ONE
// sizing rule across exporters — width/height absolute win, scale only when neither set.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

function makeEl(w = 100, h = 50) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;background:#345`
  document.body.appendChild(el)
  return el
}

describe('format option unification', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('toBlob defaults to svg; format selects an image codec; legacy type still works', async () => {
    const res = await snapdom(makeEl(), { cache: 'disabled' })
    const svgBlob = await res.toBlob()
    expect(svgBlob.type).toBe('image/svg+xml')
    const pngBlob = await res.toBlob({ format: 'png' })
    expect(pngBlob.type).toBe('image/png')
    const legacy = await res.toBlob({ type: 'webp' })
    expect(legacy.type).toBe('image/webp')
  })
})

describe('one sizing rule across exporters', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('width wins over scale in toCanvas (same geometry as toImg)', async () => {
    const res = await snapdom(makeEl(100, 50), { cache: 'disabled' })
    const canvas = await res.toCanvas({ width: 300, scale: 2, dpr: 1 })
    // Old behavior multiplied: 300×2=600. New rule: width is absolute.
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(150) // aspect preserved from 100x50
  })

  it('scale applies when neither width nor height is set', async () => {
    const res = await snapdom(makeEl(100, 50), { cache: 'disabled' })
    const canvas = await res.toCanvas({ scale: 2, dpr: 1 })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
  })
})
