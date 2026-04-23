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
})
