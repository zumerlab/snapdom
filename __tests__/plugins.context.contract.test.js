// The plugin contract, held to the runtime: ONE capture context per capture (normalized
// options at the TOP level, mutable in beforeSnap and actually read afterwards), and export
// hooks that take (ctx, payload) and only OBSERVE.
// Every assertion here is on what PAINTS (pixels) or on real geometry, never on res.url.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

afterEach(() => { document.body.innerHTML = '' })

function box(css) {
  const el = document.createElement('div')
  el.style.cssText = css
  document.body.appendChild(el)
  return el
}

function px(canvas, x, y) {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

describe('one capture context for every hook', () => {
  it('hands the same object to every capture hook, with the options at the top level', async () => {
    const el = box('width:40px;height:20px;background:#123456')
    const seen = new Set()
    const first = []
    const probe = {
      name: 'ctx-probe',
      beforeSnap(ctx) {
        seen.add(ctx)
        first.push(ctx.scale, ctx.backgroundColor, ctx.element === el, ctx.options === ctx)
      },
      beforeClone(ctx) { seen.add(ctx) },
      afterClone(ctx) { seen.add(ctx); first.push(!!ctx.clone) },
      beforeRender(ctx) { seen.add(ctx) },
      afterRender(ctx) { seen.add(ctx); first.push(typeof ctx.dataURL, typeof ctx.svgString, typeof ctx.meta.vbW) },
    }
    await snapdom(el, { plugins: [probe], scale: 3, backgroundColor: '#abcdef', cache: 'disabled' })
    expect(seen.size).toBe(1)
    // ctx.scale was undefined inside beforeSnap while hooks got a private wrapper.
    expect(first).toEqual([3, '#abcdef', true, true, true, 'string', 'string', 'number'])
  })

  it('beforeSnap can set backgroundColor and scale, and both reach the pixels', async () => {
    const el = box('width:40px;height:20px')
    const probe = {
      name: 'set-bg-scale',
      beforeSnap(ctx) { ctx.backgroundColor = '#00ff00'; ctx.scale = 2 },
    }
    const canvas = await (await snapdom(el, { plugins: [probe], cache: 'disabled' })).toCanvas({ dpr: 1 })
    expect([canvas.width, canvas.height]).toEqual([80, 40])
    expect(px(canvas, 5, 5)).toEqual([0, 255, 0, 255])
  })

  it('beforeSnap can turn outerShadows on: same geometry as passing the option, shadow paints', async () => {
    const css = 'width:40px;height:20px;background:#0000ff;box-shadow:30px 0 0 0 #ff0000'
    const plain = await (await snapdom(box(css), { cache: 'disabled' })).toCanvas({ dpr: 1 })
    expect(plain.width).toBe(40) // stripped: no bleed

    const asOption = await (await snapdom(box(css), { outerShadows: true, cache: 'disabled' })).toCanvas({ dpr: 1 })
    const probe = { name: 'set-outer-shadows', beforeSnap(ctx) { ctx.outerShadows = true } }
    const asHook = await (await snapdom(box(css), { plugins: [probe], cache: 'disabled' })).toCanvas({ dpr: 1 })

    expect(asHook.width).toBe(asOption.width)
    expect(asHook.width).toBeGreaterThan(plain.width)
    // The shadow itself: the element box is offset 30px right of the bled origin.
    expect(px(asHook, 80, 10)).toEqual([255, 0, 0, 255])
  })

  it('beforeSnap can turn outerTransforms off: the root rotation is dropped from the bbox', async () => {
    const css = 'width:100px;height:20px;background:#0000ff;transform:rotate(45deg)'
    const rotated = await (await snapdom(box(css), { cache: 'disabled' })).toCanvas({ dpr: 1 })
    // Rotated 100x20 bbox is ~84.85 square (plus padding).
    expect(rotated.height).toBeGreaterThan(80)

    const asOption = await (await snapdom(box(css), { outerTransforms: false, cache: 'disabled' })).toCanvas({ dpr: 1 })
    const probe = { name: 'set-outer-transforms', beforeSnap(ctx) { ctx.outerTransforms = false } }
    const asHook = await (await snapdom(box(css), { plugins: [probe], cache: 'disabled' })).toCanvas({ dpr: 1 })
    expect([asHook.width, asHook.height]).toEqual([asOption.width, asOption.height])
    expect(asHook.height).toBeLessThan(40)
    expect(asHook.width).toBeGreaterThan(95)
  })

  it('beforeSnap can set clip: the capture is windowed to the rect it chose', async () => {
    const el = box('display:flex;width:100px;height:60px')
    el.appendChild(box('width:50px;height:60px;background:#ff0000'))
    el.appendChild(box('width:50px;height:60px;background:#0000ff'))
    const r = el.getBoundingClientRect()
    const probe = {
      name: 'set-clip',
      beforeSnap(ctx) {
        ctx.clip = { x: r.left + window.scrollX + 5, y: r.top + window.scrollY + 5, width: 20, height: 10 }
      },
    }
    const canvas = await (await snapdom(el, { plugins: [probe], cache: 'disabled' })).toCanvas({ dpr: 1 })
    expect([canvas.width, canvas.height]).toEqual([20, 10])
    expect(px(canvas, 10, 5)).toEqual([255, 0, 0, 255])
  })
})

describe('export hooks: two arguments, observational', () => {
  it('receive (ctx, payload) with the documented shape, and steer only through payload.options', async () => {
    const el = box('width:40px;height:20px')
    let before = null
    let after = null
    // Runs FIRST and returns junk: a chained runner would hand THAT to the next plugin
    // instead of the payload.
    const noisy = { name: 'noisy', beforeExport() { return 'junk' }, afterExport() { return 'junk' } }
    const probe = {
      name: 'export-probe',
      beforeExport(ctx, payload) {
        before = { payload, ctxExport: ctx.export }
        payload.options.backgroundColor = '#00ff00'
        return 'ignored'
      },
      afterExport(ctx, payload) { after = payload; return 'ignored too' },
    }
    const res = await snapdom(el, { plugins: [noisy, probe], cache: 'disabled' })
    const canvas = await res.toCanvas({ dpr: 1 })

    expect(before.payload.format).toBe('canvas')
    expect(before.payload.options.dpr).toBe(1)      // what this call passed
    expect(before.payload.options.scale).toBe(1)    // merged capture default
    expect(before.ctxExport.type).toBe('canvas')
    expect(before.ctxExport.url).toBe(res.url)
    expect(typeof before.ctxExport.svgString).toBe('function')
    expect(Object.keys(before.ctxExport.requestedOptions)).toEqual(['dpr'])

    // payload.options IS the object the exporter receives: the mutation painted.
    expect(px(canvas, 5, 5)).toEqual([0, 255, 0, 255])

    // afterExport observes: it sees the exporter's result, and its return is not the caller's.
    expect(after.format).toBe('canvas')
    expect(after.options).toBe(before.payload.options)
    expect(after.result).toBe(canvas)
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })
})

describe('the single context survives the differential recapture', () => {
  it('serves a mutation through the diff path without losing the context', async () => {
    const el = box('width:300px;padding:10px;background:white;font:12px Arial')
    // Nested: the diff path bails when a dirty root is a direct child of the capture root.
    const list = box('display:block')
    el.appendChild(list)
    for (let i = 0; i < 6; i++) {
      const row = document.createElement('p')
      row.textContent = `row ${i}`
      row.style.cssText = 'margin:0;padding:4px;background:#eee'
      list.appendChild(row)
    }
    for (let i = 0; i < 4; i++) await snapdom(el) // engage burst + retain artifacts

    el.querySelectorAll('p')[2].textContent = 'CHANGED'
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res = await snapdom(el)
    // The diff path really ran (otherwise this test proves nothing about the fold).
    expect(__diffStats.served).toBe(served0 + 1)
    // And it produced the same bytes as a full capture of the same DOM state.
    const full = await snapdom(el, { burst: false })
    expect(res.url).toBe(full.url)
  })
})
