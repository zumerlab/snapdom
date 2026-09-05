// Plugin contract vs the fast paths: auto-burst must NOT serve memos when a
// render-affecting plugin is present (its hooks would be skipped), unless the plugin
// declares itself pure. Export-only plugins keep the speedup.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'

function makeEl() {
  const el = document.createElement('div')
  el.textContent = 'contenido'
  document.body.appendChild(el)
  return el
}

describe('auto-burst × plugins', () => {
  afterEach(() => { clearPlugins(); document.body.innerHTML = ''; vi.restoreAllMocks() })

  it('a render-affecting plugin suspends the auto memo (hook runs every capture)', async () => {
    const el = makeEl()
    let hookRuns = 0
    const plugin = { name: 'stamp', afterClone(state) { hookRuns++; return state } }
    for (let i = 0; i < 6; i++) {
      await snapdom(el, { plugins: [plugin] })
    }
    // Without the gate, captures 4+ would serve the memo and skip the hook.
    expect(hookRuns).toBe(6)
  })

  it('pure: true re-enables the auto memo', async () => {
    const el = makeEl()
    let hookRuns = 0
    const plugin = { name: 'pure-stamp', pure: true, afterClone(state) { hookRuns++; return state } }
    const first = await snapdom(el, { plugins: [plugin] })
    const second = await snapdom(el, { plugins: [plugin] })
    expect(second).toBe(first)
    expect(hookRuns).toBe(1)
  })

  it('an export-only plugin keeps the auto speedup', async () => {
    const el = makeEl()
    const plugin = { name: 'exporter-only', defineExports() { return { noop: async () => 'x' } } }
    const results = []
    for (let i = 0; i < 8; i++) {
      results.push(await snapdom(el, { plugins: [plugin] }))
    }
    expect(results[1]).toBe(results[0])
  })

  it('never serves a result built against an older global plugin registry', async () => {
    const el = makeEl()
    const initial = await snapdom(el)
    expect(await snapdom(el)).toBe(initial)

    snapdom.plugins({
      name: 'global-export-revision',
      defineExports() { return { marker: async () => 'global marker' } },
    })
    const withPlugin = await snapdom(el)
    expect(withPlugin).not.toBe(initial)
    expect(await withPlugin.toMarker()).toBe('global marker')

    clearPlugins()
    const cleared = await snapdom(el)
    expect(cleared).not.toBe(withPlugin)
    expect(cleared.toMarker).toBeUndefined()
  })

  it('keys the memo by plugins attached before the Safari font wait', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let entered
    const waiting = new Promise((resolve) => { entered = resolve })
    vi.spyOn(document.fonts, 'ready', 'get').mockImplementationOnce(() => { entered(); return gate })
    const el = makeEl()
    const options = { embedFonts: true }
    const pending = snapdom(el, options)
    await waiting // preparation now runs inside burst's same-element queue
    try {
      snapdom.plugins({
        name: 'registered-during-font-wait',
        defineExports() { return { marker: async () => 'registered after attachment' } },
      })
    } finally {
      release()
    }

    const beforeRegistration = await pending
    expect(beforeRegistration.toMarker).toBeUndefined()
    const afterRegistration = await snapdom(el, options)
    expect(afterRegistration).not.toBe(beforeRegistration)
    expect(await afterRegistration.toMarker()).toBe('registered after attachment')
  })
})
