// Plugin-surface defects found by the v3 audit.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function box() {
  const el = document.createElement('div')
  el.style.cssText = 'width:40px;height:40px;background:#3af'
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

describe('an unnamed plugin', () => {
  // `name` exists for dedup and local-over-global override. A plugin that supplies neither
  // was dropped from the merged list with no error and no warning, so its hooks never ran —
  // indistinguishable from a plugin that does nothing.
  it('still runs its hooks', async () => {
    const seen = []
    await snapdom(box(), { embedFonts: false, plugins: [{ beforeSnap() { seen.push('before') } }] })
    expect(seen).toEqual(['before'])
  })

  it('does not collide with a second unnamed plugin', async () => {
    const seen = []
    await snapdom(box(), {
      embedFonts: false,
      plugins: [{ beforeSnap() { seen.push('a') } }, { beforeSnap() { seen.push('b') } }],
    })
    expect(seen.sort()).toEqual(['a', 'b'])
  })

  it('still lets a named local override a named global', async () => {
    const seen = []
    snapdom.plugins({ name: 'dup', beforeSnap() { seen.push('global') } })
    try {
      await snapdom(box(), { embedFonts: false, plugins: [{ name: 'dup', beforeSnap() { seen.push('local') } }] })
      expect(seen).toEqual(['local'])
    } finally {
      const { clearPlugins } = await import('../src/core/plugins.js')
      clearPlugins()
    }
  })
})

describe('ctx.options inside export-stage hooks', () => {
  // The self-reference is non-enumerable, and every export-stage context is a {...context}
  // spread, so `ctx.options` was undefined in defineExports/beforeExport/afterExport while
  // the same line worked in afterClone. types/snapdom.d.ts declares it required.
  it('is defined in beforeExport, afterExport and defineExports', async () => {
    const seen = {}
    const result = await snapdom(box(), {
      embedFonts: false,
      plugins: [{
        name: 'reads-ctx-options',
        defineExports(ctx) { seen.define = !!ctx.options; return {} },
        beforeExport(ctx) { seen.before = !!ctx.options },
        afterExport(ctx) { seen.after = !!ctx.options },
      }],
    })
    await result.toCanvas({ dpr: 1 })
    expect(seen).toEqual({ define: true, before: true, after: true })
  })

  it('points at the same normalized bag the pipeline read', async () => {
    let scaleSeen = null
    const result = await snapdom(box(), {
      embedFonts: false,
      scale: 2,
      plugins: [{ name: 'reads-scale', beforeExport(ctx) { scaleSeen = ctx.options.scale } }],
    })
    await result.toCanvas({ dpr: 1 })
    expect(scaleSeen).toBe(2)
  })
})

describe('the silent export facade (ctx.exports.*)', () => {
  // It called the core export directly, skipping normalizeExportOptions — so a format
  // passed through it was ignored and the format-specific defaults never applied.
  it('honours the format passed to ctx.exports.blob', async () => {
    let blob = null
    const result = await snapdom(box(), {
      embedFonts: false,
      plugins: [{
        name: 'uses-facade',
        defineExports(ctx) {
          return { probe: async () => { blob = await ctx.exports.blob({ format: 'png', dpr: 1 }); return blob } }
        },
      }],
    })
    await result.toProbe()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
  })
})
