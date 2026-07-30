// Plugin contract vs the fast paths: auto-burst must NOT serve memos when a
// render-affecting plugin is present (its hooks would be skipped), unless the plugin
// declares itself pure. Export-only plugins keep the speedup.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

function makeEl() {
  const el = document.createElement('div')
  el.textContent = 'contenido'
  document.body.appendChild(el)
  return el
}

describe('auto-burst × plugins', () => {
  afterEach(() => { document.body.innerHTML = '' })

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
    for (let i = 0; i < 8; i++) {
      await snapdom(el, { plugins: [plugin] })
    }
    // Auto-burst engages after the 3-capture window: later repeats serve the memo.
    expect(hookRuns).toBeLessThan(8)
  })

  it('an export-only plugin keeps the auto speedup', async () => {
    const el = makeEl()
    const plugin = { name: 'exporter-only', defineExports() { return { noop: async () => 'x' } } }
    const results = []
    for (let i = 0; i < 8; i++) {
      results.push(await snapdom(el, { plugins: [plugin] }))
    }
    // Memo engaged: at least one later result IS the memoized result object.
    const memoized = results.some((r, i) => i > 0 && r === results[i - 1])
    expect(memoized).toBe(true)
  })
})
