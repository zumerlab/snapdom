import { bench, describe } from 'vitest'
import { snapdom } from '../src/index'

// Warm dashboard polling, ending at a raw SVG URL in both arms. Each arm mounts and
// primes its own element outside timing. The isolated stable runner covers first capture.
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

describe(`Warm polling: memo on vs off (${REPEATS}x, unchanged element, raw SVG)`, () => {
  let el

  for (const burst of [false, true]) {
    bench(`snapdom.toRaw, burst:${burst}, ${REPEATS} warm captures`, async () => {
      for (let i = 0; i < REPEATS; i++) await snapdom.toRaw(el, { burst })
    }, {
      async setup() {
        el = buildDashboard()
        await snapdom.toRaw(el, { burst })
      },
      teardown() {
        el.remove()
        el = null
      },
    })
  }
})
