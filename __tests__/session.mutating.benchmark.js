import { bench, describe } from 'vitest'
import { snapdom } from '../src/index'

// Warm polling: one metric changes every fourth tick. Both arms end at a raw SVG URL,
// and each arm mounts and primes its own element outside timing. Mutation values never
// repeat, so every dirty tick changes the metric, including between benchmark iterations.
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
          <div class="metric-value" style="font-size:20px;font-weight:bold">${(i + 1) * 137}</div>
        </div>`).join('')}
    </div>
  `
  document.body.appendChild(el)
  return el
}

describe('Warm polling: memo on vs off (20x, 1-in-4 ticks mutate, raw SVG)', () => {
  let el
  let metric
  let tick

  for (const burst of [false, true]) {
    bench(`snapdom.toRaw, burst:${burst}, ${REPEATS} warm captures`, async () => {
      for (let i = 0; i < REPEATS; i++, tick++) {
        if (tick % 4 === 0) metric.textContent = String(1000 + tick)
        await snapdom.toRaw(el, { burst })
      }
    }, {
      async setup() {
        el = buildDashboard()
        metric = el.querySelector('.metric-value')
        tick = 0
        await snapdom.toRaw(el, { burst })
      },
      teardown() {
        el.remove()
        el = null
      },
    })
  }
})
