// Exploratory local microbenchmarks. Use `npm run test:benchmark` for regression
// checks against published stable: that runner isolates the two compiled builds.
// Fixtures mount outside timing; burst:false measures the pipeline without memo hits.
import { bench, describe } from 'vitest'
import { snapdom } from '../src/index'

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
  { width: 2000, height: 1500, label: 'Large scroll area (2000x1500)' },
  { width: 4000, height: 2000, label: 'Very large element (4000x2000)' },
]

// Enough warmup for both arms to reach steady JIT and cache state before timing.
const OPTS = { time: 1000, warmupTime: 300 }

function buildComplex(size) {
  const container = document.createElement('div')
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
  return container
}

for (const size of sizes) {
  describe(`Benchmark complex node at ${size.label}`, () => {
    let container = null
    const hooks = {
      setup() {
        container = buildComplex(size)
        document.body.appendChild(container)
      },
      teardown() {
        container?.remove()
        container = null
      },
    }

    // toRaw ends at the SVG string: this is the pipeline without the raster stage. A raster
    // regression is invisible here and shows in category.benchmark.js, which ends at a PNG.
    bench('snapDOM current source', async () => {
      await snapdom.toRaw(container, { burst: false })
    }, { ...OPTS, ...hooks })
  })
}
