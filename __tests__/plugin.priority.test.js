import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'

function makeEl() {
  const el = document.createElement('div')
  el.style.cssText = 'width:40px;height:40px;background:#eee'
  document.body.appendChild(el)
  return el
}

describe('plugin export priority', () => {
  afterEach(() => {
    clearPlugins()
  })

  it('local plugin overrides core png export', async () => {
    const el = makeEl()
    const SENTINEL = Symbol('plugin-png')
    const plugin = {
      name: 'override-png-local',
      defineExports: () => ({ png: async () => SENTINEL })
    }
    const result = await snapdom(el, { plugins: [plugin] })
    expect(await result.toPng()).toBe(SENTINEL)
    expect(await result.to('png')).toBe(SENTINEL)
    document.body.removeChild(el)
  })

  it('global plugin overrides core jpeg export', async () => {
    const el = makeEl()
    const SENTINEL = Symbol('plugin-jpeg')
    snapdom.plugins({
      name: 'override-jpeg-global',
      defineExports: () => ({ jpeg: async () => SENTINEL })
    })
    const result = await snapdom(el)
    expect(await result.toJpg()).toBe(SENTINEL)
    expect(await result.to('jpeg')).toBe(SENTINEL)
    document.body.removeChild(el)
  })

  it('local plugin beats global plugin when both define the same export (local-first)', async () => {
    const el = makeEl()
    const GLOBAL = Symbol('global-png')
    const LOCAL = Symbol('local-png')
    snapdom.plugins({
      name: 'dup-global',
      defineExports: () => ({ png: async () => GLOBAL })
    })
    const localPlugin = {
      name: 'dup-local',
      defineExports: () => ({ png: async () => LOCAL })
    }
    const result = await snapdom(el, { plugins: [localPlugin] })
    expect(await result.toPng()).toBe(LOCAL)
    document.body.removeChild(el)
  })

  it('plugin can add a new export format exposed as to<Name>', async () => {
    const el = makeEl()
    const plugin = {
      name: 'pdf-stub',
      defineExports: () => ({ pdf: async (_ctx, opts) => ({ kind: 'pdf', opts }) })
    }
    const result = await snapdom(el, { plugins: [plugin] })
    const out = await result.toPdf({ foo: 1 })
    expect(out.kind).toBe('pdf')
    expect(out.opts.foo).toBe(1)
    expect((await result.to('pdf')).kind).toBe('pdf')
    document.body.removeChild(el)
  })

  it('gives plugin exports the exact frozen raw option bag', async () => {
    const el = makeEl()
    const plugin = {
      name: 'raw-export-options',
      defineExports: () => ({
        contract: async (ctx) => ({
          requested: ctx.export.requestedOptions,
          normalized: ctx.export.options,
          element: ctx.element,
        }),
      }),
    }
    const result = await snapdom(el, { plugins: [plugin] })

    // null is also the capture default. Presence must survive even when comparing
    // merged values could not distinguish this call from an omitted option.
    const explicit = await result.toContract({ backgroundColor: null })
    expect(Object.hasOwn(explicit.requested, 'backgroundColor')).toBe(true)
    expect(explicit.requested.backgroundColor).toBe(null)
    expect(Object.isFrozen(explicit.requested)).toBe(true)
    expect(explicit.normalized.backgroundColor).toBe(null)
    expect(explicit.element).toBe(el)

    const omitted = await result.toContract()
    expect(Object.hasOwn(omitted.requested, 'backgroundColor')).toBe(false)
    expect(Object.isFrozen(omitted.requested)).toBe(true)
    document.body.removeChild(el)
  })

  it('snapshots raw options before a queued export can observe later mutation', async () => {
    const el = makeEl()
    let release
    const gate = new Promise(resolve => { release = resolve })
    let calls = 0
    const plugin = {
      name: 'queued-raw-options',
      defineExports: () => ({
        contract: async (ctx) => {
          if (++calls === 1) await gate
          return ctx.export.requestedOptions.label
        },
      }),
    }
    const result = await snapdom(el, { plugins: [plugin] })
    const first = result.toContract({ label: 'first' })
    const laterOptions = { label: 'queued' }
    const second = result.toContract(laterOptions)
    laterOptions.label = 'mutated-after-call'
    release()

    expect(await first).toBe('first')
    expect(await second).toBe('queued')
    document.body.removeChild(el)
  })
})
