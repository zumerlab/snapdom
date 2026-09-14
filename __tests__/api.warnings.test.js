// result.warnings: a programmatic "did this capture degrade" answer — flat array fed by
// the curated failure branches, empty in the common case.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

describe('result.warnings', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('clean capture → empty array', async () => {
    const el = document.createElement('div')
    el.textContent = 'ok'
    document.body.appendChild(el)
    const res = await snapdom(el, { cache: 'disabled' })
    expect(Array.isArray(res.warnings)).toBe(true)
    expect(res.warnings.length).toBe(0)
  })

  it('failed image → placeholder records image-fallback', async () => {
    const el = document.createElement('div')
    const img = document.createElement('img')
    img.src = 'http://localhost:1/inexistente-404.png'
    img.width = 40; img.height = 40
    el.appendChild(img)
    document.body.appendChild(el)
    const res = await snapdom(el, { cache: 'disabled' })
    expect(res.warnings.some(w => w.code === 'image-fallback')).toBe(true)
    expect(res.warnings[0]).toHaveProperty('message')
  })

  it('oversized export records canvas-clamp (console.warn stays unconditional)', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:200px;height:100px;background:#234'
    document.body.appendChild(el)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await snapdom(el, { cache: 'disabled' })
    await res.toCanvas({ width: 30000, height: 20000, dpr: 1 })
    expect(res.warnings.some(w => w.code === 'canvas-clamp')).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
