// __tests__/category.benchmark.js
// Steady-state comparison of every element-to-image library in the category.
//
// Fairness rules (differences from snapdom.benchmark.js are deliberate):
//   - ONE output stage for everyone: PNG data URL. The size scenarios in
//     snapdom.benchmark.js compare snapdom `toRaw` (SVG string) against raster
//     output of the others; here every library pays for rasterization + encode.
//   - Defaults profile only (scale 1). Configured/extended profiles (e.g.
//     html2canvas `foreignObjectRendering`) belong in a separate describe.
//   - Competitors pinned to the versions verified in the capability matrix
//     (see category.capabilities.test.js).
//   - tinybench measures steady state (warm). Cold first-capture cost is
//     measured in category.capabilities.test.js instead.
//
// Run:  npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false
//       BROWSER=all npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false

import { bench, describe, afterEach } from 'vitest'
import { loadLibs } from './helpers/category.libs.js'

// Adapters live in helpers/category.libs.js so category.capabilities.test.js can share them:
// importing THIS file from a test run would throw, because bench() only exists under
// `vitest bench`. Competitors unreachable from this machine are simply absent.
const LIBS = await loadLibs()

// ── Scenarios ───────────────────────────────────────────────────────────────

export function complexCardHTML() {
  let items = ''
  for (let i = 0; i < 12; i++) {
    items += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px dashed #d8d6cc">
      <div style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%, #ff8800, #cc00cc);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>
      <div style="flex:1"><b style="letter-spacing:.02em">Item ${i} 🚀</b><br><span style="color:#6b7069;font-size:11px">detail with <i>emphasis</i> and <code style="background:#eee;border-radius:3px;padding:0 3px">code</code></span></div>
      <span style="transform:rotate(${i * 3}deg);display:inline-block;background:linear-gradient(135deg,#0f5c48,#0a3d30);color:#fff;border-radius:10px;padding:2px 8px;font-size:10px">tag${i}</span>
    </div>`
  }
  return `<div class="hero" style="position:relative;border-radius:14px;padding:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border:1px solid #d8d6cc">
    <h2 style="margin:0 0 4px">Complex card</h2>
    <svg width="80" height="24" viewBox="0 0 80 24" style="display:block;margin:4px 0"><rect x="0" y="4" width="80" height="16" rx="8" fill="#0f5c48"/><circle cx="14" cy="12" r="6" fill="#ff8800"/><text x="28" y="16" font-size="10" fill="#fff">inline svg</text></svg>
    <div style="transform:rotate(-1.5deg) scale(.98);border:2px solid #0f5c48;border-radius:10px;overflow:hidden;background:linear-gradient(180deg,#fff,#f4f4ee)">${items}</div>
    <p style="margin:10px 0 0;column-count:2;column-gap:14px;font-size:11px">Two-column text to force non-trivial layout. Shadows, gradients, transforms, inline SVG, emoji and mixed typography in one viewport-sized subtree.</p>
  </div>`
}

export function bigTableHTML(rows = 500) {
  let trs = ''
  for (let i = 0; i < rows; i++) {
    trs += `<tr style="background:${i % 2 ? '#f4f4ee' : '#fff'}"><td style="padding:4px 8px;border:1px solid #d8d6cc;font-weight:600">#${i}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;color:#0f5c48">item-${(i * 7919) % 10000}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;background:linear-gradient(90deg,#e8e8e0,#fff)">${(i * 13.37).toFixed(2)}</td><td style="padding:4px 8px;border:1px solid #d8d6cc"><span style="border-radius:8px;background:#a85e00;color:#fff;padding:1px 6px">tag${i % 9}</span></td></tr>`
  }
  return `<table style="border-collapse:collapse;width:100%">${trs}</table>`
}

const scenarios = [
  { label: 'Complex card (viewport)', width: 520, html: complexCardHTML(), opts: { warmupIterations: 2, iterations: 8, time: 0 } },
  { label: 'Big table (500 rows, ~11.5k px tall)', width: 640, html: bigTableHTML(500), opts: { warmupIterations: 1, iterations: 3, time: 0 } },
  { label: 'Simple node, page view (1200x800)', width: 1200, height: 800, html: '<h1>Page view (1200x800)</h1>', opts: { warmupIterations: 2, iterations: 8, time: 0 } },
]

for (const scenario of scenarios) {
  describe(`Category benchmark: ${scenario.label}`, () => {
    let container

    async function setupContainer() {
      if (container && document.body.contains(container)) return
      container = document.createElement('div')
      container.style.width = `${scenario.width}px`
      if (scenario.height) container.style.height = `${scenario.height}px`
      container.style.background = scenario.height ? 'linear-gradient(to right, red, blue)' : '#f6f5f0'
      container.style.padding = scenario.height ? '0' : '20px'
      container.style.fontFamily = 'Arial, sans-serif'
      container.style.fontSize = '13px'
      container.innerHTML = scenario.html
      document.body.appendChild(container)
    }

    afterEach(() => {
      if (container) {
        container.remove()
        container = null
      }
    })

    for (const [name, capture] of Object.entries(LIBS)) {
      bench(name, async () => {
        await setupContainer()
        await capture(container)
      }, scenario.opts)
    }
  })
}
