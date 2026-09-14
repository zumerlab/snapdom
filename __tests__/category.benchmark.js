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
// The adapters and scenarios live in ./category.libs.js — a plain module, so the
// capability test can import them without executing these bench() calls.
//
// Run:  npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false
//       BROWSER=all npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false

import { bench, describe, afterEach } from 'vitest'
import { loadLibs, SCENARIOS as scenarios } from './category.libs.js'

const LIBS = await loadLibs()

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
