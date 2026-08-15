import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { registerPlugins, clearPlugins, getGlobalPlugins } from '../src/core/plugins.js'

function makeEl() {
  const el = document.createElement('div')
  el.style.cssText = 'width:40px;height:40px;background:#eee'
  el.innerHTML = '<p style="margin:0">hi</p>'
  document.body.appendChild(el)
  return el
}

describe('a GLOBAL plugin may not lower the capture stage', () => {
  afterEach(() => { clearPlugins() })

  it('rejects registration and names the plugin', async () => {
    expect(() => registerPlugins({ name: 'annotator', needs: 'clone' }))
      .toThrow(/annotator/)
    expect(() => registerPlugins({ name: 'annotator', needs: 'clone' }))
      .toThrow(/global plugin/)
    expect(() => registerPlugins({ name: 'mapper', needs: 'clone' }))
      .toThrow(/mapper/)
    // and it never reaches the registry, so no later capture can be lowered by it
    expect(getGlobalPlugins()).toEqual([])

    // the harm this prevents, measured: an unrelated call site keeps its pixels
    const el = makeEl()
    const res = await snapdom(el)
    expect(res.needs).toBe('render')
    const canvas = await res.toCanvas()
    expect(canvas.width).toBeGreaterThan(0)
    el.remove()
  })

  it('rejects a typo too, rather than letting it buy the default', () => {
    expect(() => registerPlugins({ name: 'typo', needs: 'renderr' })).toThrow(/"renderr"/)
    expect(getGlobalPlugins()).toEqual([])
  })

  it('still accepts a global plugin that runs the whole pipeline', async () => {
    registerPlugins({ name: 'plain' }, { name: 'explicit', needs: 'render' })
    expect(getGlobalPlugins().map((p) => p.name)).toEqual(['plain', 'explicit'])

    // the real point: an unrelated call site keeps its pixels
    const el = makeEl()
    const res = await snapdom(el)
    expect(res.needs).toBe('render')
    expect(res.url).toMatch(/^data:image\/svg\+xml/)
    const canvas = await res.toCanvas()
    expect(canvas.width).toBeGreaterThan(0)
    el.remove()
  })

  it('the SAME plugin passed per capture still lowers that one capture', async () => {
    const el = makeEl()
    const lowering = { name: 'annotator', needs: 'clone' }
    const res = await snapdom(el, { plugins: [lowering] })
    expect(res.needs).toBe('clone')
    expect(() => res.url).toThrow(/annotator/)

    // and the next capture, which did not ask for it, is untouched
    const plain = await snapdom(el)
    expect(plain.needs).toBe('render')
    expect(plain.url).toMatch(/^data:image\/svg\+xml/)
    el.remove()
  })
})
