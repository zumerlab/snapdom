import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { resolveStage, stageReaches, STAGES } from '../src/core/stages.js'

function makeEl() {
  const el = document.createElement('div')
  el.style.cssText = 'width:40px;height:40px;background:#eee'
  el.innerHTML = '<p style="margin:0">hi <b>there</b></p>'
  document.body.appendChild(el)
  return el
}

/** Records which stages actually ran, by hooking one per stage. */
function tracer(needs) {
  const seen = []
  return {
    plugin: {
      name: `tracer-${needs || 'default'}`,
      ...(needs ? { needs } : {}),
      beforeClone: () => { seen.push('beforeClone') },
      afterClone: () => { seen.push('afterClone') },
      beforeRender: () => { seen.push('beforeRender') },
      afterRender: () => { seen.push('afterRender') },
    },
    seen,
  }
}

describe('capture stages (plugin `needs`)', () => {
  afterEach(() => { clearPlugins() })

  it('resolves to the deepest stage declared, defaulting to render', () => {
    expect(resolveStage({}).stage).toBe('render')
    expect(resolveStage({ plugins: [] }).stage).toBe('render')
    expect(resolveStage({ plugins: [{ name: 'a', needs: 'dom' }] }).stage).toBe('dom')
    expect(resolveStage({ plugins: [{ name: 'a', needs: 'clone' }] }).stage).toBe('clone')
    // an undeclared plugin keeps the whole pipeline: adding one never removes an artifact
    expect(resolveStage({ plugins: [{ name: 'a', needs: 'dom' }, { name: 'b' }] }).stage).toBe('render')
    expect(resolveStage({ plugins: [{ name: 'a', needs: 'dom' }, { name: 'b', needs: 'clone' }] }).stage).toBe('clone')
    expect(STAGES).toEqual(['dom', 'clone', 'render'])
    expect(stageReaches('clone', 'render')).toBe(false)
    expect(stageReaches('render', 'dom')).toBe(true)
  })

  it('rejects an unknown needs value instead of silently taking the default', () => {
    expect(() => resolveStage({ plugins: [{ name: 'typo', needs: 'renderr' }] }))
      .toThrow(/needs: "renderr"/)
  })

  it('needs:"dom" stops before the clone', async () => {
    const el = makeEl()
    const { plugin, seen } = tracer('dom')
    const result = await snapdom(el, { plugins: [plugin] })
    expect(seen).toEqual(['beforeClone'])
    expect(result.needs).toBe('dom')
    el.remove()
  })

  it('needs:"clone" runs the clone and stops before the render', async () => {
    const el = makeEl()
    const { plugin, seen } = tracer('clone')
    let cloned = null
    plugin.afterClone = (ctx) => { cloned = ctx.clone; seen.push('afterClone') }
    const result = await snapdom(el, { plugins: [plugin] })
    expect(seen).toEqual(['beforeClone', 'afterClone'])
    expect(cloned).toBeTruthy()
    expect(cloned.textContent).toContain('there')
    expect(result.needs).toBe('clone')
    el.remove()
  })

  it('a capture with no plugins is unchanged', async () => {
    const el = makeEl()
    const result = await snapdom(el)
    expect(result.needs).toBe('render')
    expect(result.url.startsWith('data:image/svg+xml')).toBe(true)
    expect(result.toRaw()).toBe(result.url)
    el.remove()
  })

  it('one undeclared plugin restores the full pipeline', async () => {
    const el = makeEl()
    const { plugin: live } = tracer('dom')
    const { plugin: full, seen } = tracer(null)
    const result = await snapdom(el, { plugins: [live, full] })
    expect(seen).toContain('afterRender')
    expect(result.needs).toBe('render')
    expect(typeof result.url).toBe('string')
    el.remove()
  })

  describe('absent artifacts fail loud', () => {
    const doors = [
      ['url', (r) => r.url],
      ['toRaw()', (r) => r.toRaw()],
      ['toPng()', (r) => r.toPng()],
      ['toCanvas()', (r) => r.toCanvas()],
      ['toBlob()', (r) => r.toBlob()],
      ['toSvg()', (r) => r.toSvg()],
      ['download()', (r) => r.download()],
    ]

    for (const [name, open] of doors) {
      it(`${name} throws, naming the plugin that lowered the stage`, async () => {
        const el = makeEl()
        const result = await snapdom(el, { plugins: [{ name: 'oracle-ish', needs: 'dom', beforeClone() {} }] })
        await expect(async () => open(result)).rejects.toThrow(/oracle-ish/)
        await expect(async () => open(result)).rejects.toThrow(/stopped at 'dom'/)
        el.remove()
      })
    }

    it('never re-captures silently: the message says so', async () => {
      const el = makeEl()
      const result = await snapdom(el, { plugins: [{ name: 'oracle-ish', needs: 'dom' }] })
      expect(() => result.url).toThrow(/different instant/)
      el.remove()
    })
  })

  it('plugin exports still work at a shallower stage', async () => {
    const el = makeEl()
    // hooks are invoked unbound (runHook pulls the function off the instance), so a
    // plugin keeps its own state in the factory closure, not on `this`
    let count = 0
    const plugin = {
      name: 'semantic-only',
      needs: 'dom',
      beforeClone(ctx) { count = ctx.element.querySelectorAll('*').length },
      defineExports() { return { changes: async () => ({ nodes: count }) } },
    }
    const result = await snapdom(el, { plugins: [plugin] })
    expect(await result.toChanges()).toEqual({ nodes: 2 })
    // ...and the pixel doors are still closed
    await expect(result.toPng()).rejects.toThrow(/semantic-only/)
    el.remove()
  })

  describe('the `needs` option is the same knob on every plugin', () => {
    it('contextExport({ needs: "dom" }) captures no clone and still exports', async () => {
      const { contextExport } = await import('../packages/plugins/context-export.js')
      const el = makeEl()
      const res = await snapdom(el, { plugins: [contextExport({ needs: 'dom' })] })
      expect(res.needs).toBe('dom')
      expect(String(await res.toContext())).toContain('there')
      await expect(res.toPng()).rejects.toThrow(/context-export/)
      el.remove()
    })

    it('contextExport() still pairs picture and text by default', async () => {
      const { contextExport } = await import('../packages/plugins/context-export.js')
      const el = makeEl()
      const res = await snapdom(el, { plugins: [contextExport()] })
      expect(res.needs).toBe('render')
      expect(typeof res.url).toBe('string')
      expect(String(await res.toContext())).toContain('there')
      el.remove()
    })

    it('agentMap({ image: false, needs: "clone" }) maps without rendering', async () => {
      const { agentMap } = await import('../packages/plugins/agent-map.js')
      const el = makeEl()
      el.innerHTML = '<button>Act</button><a href="#x">Go</a>'
      const res = await snapdom(el, { plugins: [agentMap({ image: false, needs: 'clone' })] })
      expect(res.needs).toBe('clone')
      const out = await res.toAgentMap()
      expect(out.map.length).toBe(2)
      expect(out.image).toBeUndefined()
      el.remove()
    })

    it('agentMap rejects a stage it cannot honor instead of mapping nothing', async () => {
      const { agentMap } = await import('../packages/plugins/agent-map.js')
      // Without a clone there is no afterClone, so the map would come back EMPTY and look
      // like a page with no interactive elements. Fail at construction instead.
      expect(() => agentMap({ needs: 'dom' })).toThrow(/cannot run at stage 'dom'/)
    })

    it('agentMap rejects asking for an image it cannot produce', async () => {
      const { agentMap } = await import('../packages/plugins/agent-map.js')
      expect(() => agentMap({ needs: 'clone' })).toThrow(/image: false/)
    })
  })

  it('a result with no image can still be logged, spread and serialized', async () => {
    // The absent url is a THROWING getter; if it were enumerable, the code trying to
    // report the problem (a logger, JSON.stringify, a spread) would crash on it.
    const el = makeEl()
    const result = await snapdom(el, { plugins: [{ name: 'oracle-ish', needs: 'dom' }] })
    expect(() => ({ ...result })).not.toThrow()
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(JSON.parse(JSON.stringify(result)).needs).toBe('dom')
    // ...and reading it directly still fails loud
    expect(() => result.url).toThrow(/oracle-ish/)
    el.remove()
  })

  describe('assertNeeds (for plugin authors)', () => {
    it('defaults to the deepest stage the plugin supports', async () => {
      const { assertNeeds } = await import('../src/core/stages.js')
      expect(assertNeeds('p', undefined)).toBe('render')
      expect(assertNeeds('p', undefined, ['dom', 'clone'])).toBe('clone')
      expect(assertNeeds('p', 'dom')).toBe('dom')
    })

    it('rejects unknown stages and stages the plugin cannot honor', async () => {
      const { assertNeeds } = await import('../src/core/stages.js')
      expect(() => assertNeeds('p', 'nope')).toThrow(/one of dom, clone, render/)
      expect(() => assertNeeds('p', 'dom', ['clone', 'render'])).toThrow(/cannot run at stage 'dom'/)
    })

    it('travels with the plugin API surface', async () => {
      const mod = await import('../src/core/plugins.js')
      expect(mod.STAGES).toEqual(['dom', 'clone', 'render'])
      expect(mod.DEFAULT_STAGE).toBe('render')
      expect(mod.assertNeeds).toBeTypeOf('function')
    })
  })

  it('a plugin export that reaches for the missing artifact fails with the same reason', async () => {
    const el = makeEl()
    const plugin = {
      name: 'wants-pixels-but-said-dom',
      needs: 'dom',
      defineExports() { return { ascii: async (ctx) => ctx.export.url } },
    }
    const result = await snapdom(el, { plugins: [plugin] })
    await expect(result.toAscii()).rejects.toThrow(/wants-pixels-but-said-dom/)
    el.remove()
  })
})
