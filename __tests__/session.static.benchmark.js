import { bench, describe, afterEach } from 'vitest'
import { snapdom } from '../src/index'

// Simulates dashboard polling: same element captured repeatedly, unchanged. `burst: true`
// memoizes the result while the subtree is untouched, so a "capture" is just a
// MutationObserver.takeRecords() check instead of a full pipeline run.
//
// Kept in its own file (not alongside the 1-in-4-mutate scenario) so this run doesn't
// inherit warm module-level caches/JIT state from the other scenario — vitest's browser
// mode isolates each test file in its own page, giving each scenario a controlled baseline.
const REPEATS = 20

function buildDashboard() {
  const el = document.createElement('div')
  el.style.cssText = 'width:360px;padding:16px;background:#fff;font-family:Arial,sans-serif;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.15)'
  el.innerHTML = `
    <h2 style="margin:0 0 8px;color:#222">Live metrics</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${Array.from({ length: 6 }, (_, i) => `
        <div style="padding:10px;border-radius:8px;background:${i % 2 ? '#eef' : '#efe'}">
          <div style="font-size:12px;color:#666">Metric ${i + 1}</div>
          <div style="font-size:20px;font-weight:bold">${(i + 1) * 137}</div>
        </div>`).join('')}
    </div>
  `
  document.body.appendChild(el)
  return el
}

describe(`Benchmark burst:true vs plain capture (${REPEATS}x, unchanged element)`, () => {
  let el

  afterEach(() => {
    if (el) { el.remove(); el = null }
  })

  bench('plain snapdom() called 20x', async () => {
    el = buildDashboard()
    for (let i = 0; i < REPEATS; i++) {
      await snapdom.toRaw(el)
    }
  })

  bench('snapdom(el, { burst: true }) called 20x (memoized)', async () => {
    el = buildDashboard()
    for (let i = 0; i < REPEATS; i++) {
      await snapdom(el, { burst: true })
    }
  })
})
