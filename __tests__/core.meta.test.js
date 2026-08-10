// Capture geometry contract (`context.meta` / `result.meta`): the render pass publishes
// an immutable geometry record that document exporters translate page windows against.
// The clip-specific shape is covered in core.clip.test.js; this file covers the plain
// capture shape, the write protection and the caller-owned-options reuse case.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { captureDOM } from '../src/core/capture.js'

const added = []
function mount(css = 'width:120px;height:60px;background:#fff') {
  const el = document.createElement('div')
  el.style.cssText = css
  el.textContent = 'META'
  document.body.appendChild(el)
  added.push(el)
  return el
}

afterEach(() => {
  while (added.length) added.pop().remove()
})

describe('capture geometry meta', () => {
  it('describes a plain (unclipped) capture', async () => {
    const el = mount()
    const result = await snapdom(el)

    expect(Object.isFrozen(result.meta)).toBe(true)
    expect(result.meta.clip).toBe(null)
    expect(result.meta.w0).toBeCloseTo(120, 3)
    expect(result.meta.h0).toBeCloseTo(60, 3)
    // The viewBox is the content box plus symmetric padding, and contentX/contentY
    // must land the content box back inside it.
    expect(result.meta.vbW).toBeGreaterThanOrEqual(result.meta.w0)
    expect(result.meta.vbH).toBeGreaterThanOrEqual(result.meta.h0)
    expect(result.meta.contentX).toBeGreaterThanOrEqual(0)
    expect(result.meta.contentY).toBeGreaterThanOrEqual(0)
    expect(result.meta.contentX + result.meta.w0).toBeLessThanOrEqual(result.meta.vbW)
    expect(result.meta.contentY + result.meta.h0).toBeLessThanOrEqual(result.meta.vbH)
  })

  it('rejects plain assignment on the capture context', async () => {
    const el = mount()
    const options = {}
    await captureDOM(el, options)

    expect(Object.isFrozen(options.meta)).toBe(true)
    // ESM is strict mode: a non-writable property rejects assignment loudly instead
    // of letting a hook silently desynchronise geometry from the serialized SVG.
    expect(() => { options.meta = { w0: 1 } }).toThrow(TypeError)
    expect(() => { options.meta.w0 = 999 }).toThrow(TypeError)
  })

  it('lets a reused options bag take a second capture geometry', async () => {
    // toPng/toJpg/toWebp forward their raw caller-owned opts straight to captureDOM,
    // so the same object legitimately reaches two captures. A non-configurable `meta`
    // would turn the second one into "Cannot redefine property: meta".
    const small = mount('width:120px;height:60px;background:#fff')
    const large = mount('width:240px;height:180px;background:#fff')
    const options = { scale: 1, dpr: 1 }

    await captureDOM(small, options)
    const first = options.meta
    expect(first.w0).toBeCloseTo(120, 3)

    await expect(captureDOM(large, options)).resolves.toMatch(/^data:image\/svg\+xml/)
    expect(options.meta).not.toBe(first)
    expect(options.meta.w0).toBeCloseTo(240, 3)
    expect(options.meta.h0).toBeCloseTo(180, 3)
    // Still protected after the redefinition.
    expect(Object.isFrozen(options.meta)).toBe(true)
    expect(() => { options.meta = null }).toThrow(TypeError)
    // ...and the first record is untouched, so anything holding it keeps valid geometry.
    expect(first.w0).toBeCloseTo(120, 3)
  })

  it('reaches plugin export hooks with the same values as result.meta', async () => {
    const el = mount()
    let seen = null
    const plugin = {
      name: 'meta-reader',
      defineExports: () => ({
        geometry: async (ctx) => { seen = ctx.meta; return 'ok' },
      }),
    }
    const result = await snapdom(el, { plugins: [plugin] })
    await result.toGeometry()

    expect(seen).toEqual(result.meta)
  })
})
