// "current" is this checkout; the published npm `latest` runs alongside as the baseline.
// That arm is UNPINNED on purpose: the question is always what this checkout buys over
// what users install today, so it follows the tag instead of a version bumped by hand
// (the fixed 1.9.9 / 2.16.0 / 2.24.12 arms were dropped on 2026-09-04). burst: false pins
// both arms to the cold pipeline: the memo would otherwise serve the repeated iterations
// and measure the hit instead (session.static / session.mutating measure that on purpose);
// v2 only bursts when the flag is true, and once v3 is `latest` the flag keeps it cold too.
//
// Scenes are built in each bench's `setup` and removed in `teardown`, and the arm order
// alternates per size. The reasons, and the measurement that exposed them, are in the header
// of snapdom.benchmark.js.
import { bench, describe } from 'vitest'
import { snapdom as published } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@latest/dist/snapdom.mjs'
import { snapdom } from '../src/index'

// The published build carries no version export; the report needs the number.
const PUBLISHED = await fetch('https://cdn.jsdelivr.net/npm/@zumer/snapdom@latest/package.json')
  .then((r) => r.json()).then((p) => p.version).catch(() => 'unknown version')

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

for (const [index, size] of sizes.entries()) {
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
    const arms = [
      ['snapDOM current version', () => snapdom.toRaw(container, { burst: false })],
      [`snapDOM ${PUBLISHED} (npm latest)`, () => published.toRaw(container, { burst: false })],
    ]
    if (index % 2) arms.reverse()
    for (const [name, run] of arms) bench(name, run, { ...OPTS, ...hooks })
  })
}
