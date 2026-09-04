// NOTE: burst:false pins these benches to the cold pipeline — the memo would
// otherwise memoize the repeated iterations and measure the cache hit instead.
import { bench, describe, afterEach } from 'vitest'
import { snapdom as sd } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@1.9.9/dist/snapdom.mjs'
import { snapdom as sd216 } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@2.16.0/dist/snapdom.mjs'
// The v2 line's latest release: the "what does upgrading to v3 buy me" arm. Pinned, like the
// two above, so a run months from now still measures the same baseline — bump it by hand when
// v2 ships. It takes no `burst` option on purpose: v2 only bursts when explicitly asked
// (`if (context.burst)` in its snapdom.js, it just warns otherwise), so this IS its cold
// pipeline, which is what `burst: false` pins the current version to.
import { snapdom as sd2 } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@2.24.12/dist/snapdom.mjs'
import { snapdom } from '../src/index'

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
  { width: 2000, height: 1500, label: 'Large scroll area (2000x1500)' },
  { width: 4000, height: 2000, label: 'Very large element (4000x2000)' },
]

for (const size of sizes) {
  describe(`Benchmark complex node at ${size.label}`, () => {
    let container

  async function setupContainer() {
        if (container && document.body.contains(container)) return

        container = document.createElement('div')
        container.style.width = `${size.width}px`
        container.style.height = `${size.height}px`
        container.style.padding = '20px'
        container.style.overflow = 'auto'
        container.style.background = 'white'
        container.style.border = '2px solid black'
        container.style.fontFamily = 'Arial, sans-serif'
        container.style.color = '#333'
        container.style.position = 'relative'

        const grid = document.createElement('div')
        grid.style.display = 'grid'
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))'
        grid.style.gap = '10px'

        for (let i = 0; i < Math.floor((size.width * size.height) / 20000); i++) {
          const card = document.createElement('div')
          card.style.padding = '10px'
          card.style.borderRadius = '8px'
          card.style.background = i % 2 === 0 ? '#f0f0f0' : '#e0eaff'
          card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'
          card.style.display = 'flex'
          card.style.flexDirection = 'column'
          card.style.alignItems = 'center'

          const title = document.createElement('h3')
          title.textContent = `Card ${i + 1}`
          title.style.margin = '0 0 10px 0'
          title.style.fontSize = '14px'

          const icon = document.createElement('div')
          icon.style.width = '30px'
          icon.style.height = '30px'
          icon.style.borderRadius = '50%'
          icon.style.background = i % 2 === 0 ? 'red' : 'blue'
          icon.style.marginBottom = '10px'

          const text = document.createElement('p')
          text.textContent = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
          text.style.fontSize = '12px'
          text.style.textAlign = 'center'

          card.appendChild(icon)
          card.appendChild(title)
          card.appendChild(text)
          grid.appendChild(card)
        }

        container.appendChild(grid)
        document.body.appendChild(container)

      }

    afterEach (async () => {
      if (container) {
        container.remove()
        container = null
      }

       document.body.innerHTML = ''
    })

    bench('snapDOM current version', async () => {
      await setupContainer()
      await snapdom.toRaw(container, { burst: false })
    })

    bench('snapDOM 2.24.12 (latest v2)', async () => {
      await setupContainer()
      await sd2.toRaw(container)
    })

    bench('snapDOM 2.16.0', async () => {
      await setupContainer()
      await sd216.toRaw(container)
    })

     bench('snapDOM V1.9.9', async () => {
      await setupContainer()
      await sd.toRaw(container)
    })

    // Cross-library arms live in category.benchmark.js, where every library ends at the SAME
    // output stage (PNG data URL). Here snapdom ended at toRaw — an SVG string — against
    // competitors' rasterized PNG, which flatters snapdom and hides raster-stage regressions
    // (the category bench is what caught the encode-route win). This file is the VERSION
    // LINEAGE bench: current vs 2.24.12 vs 2.16.0 vs 1.9.9, all at toRaw, which is fair.
  })
}
