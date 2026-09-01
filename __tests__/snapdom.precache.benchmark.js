// preCache warm-vs-cold timing. Formerly snapdom.precache.perf.test.js — a *test* whose only
// assertions were expect(true).toBe(true), so it could never fail and `npm test` paid three
// full-size captures purely to print timings. The project routes timing to *.benchmark.js
// (excluded from the normal run); bench() also gives real statistics instead of one sample.
import { bench, describe, afterEach, beforeEach } from 'vitest'
import { snapdom, preCache } from '../src/index'
import { cache } from '../src/core/cache'

const sizes = [
  { width: 200, height: 100, label: 'Small element (200x100)' },
  { width: 400, height: 300, label: 'Modal size (400x300)' },
  { width: 1200, height: 800, label: 'Page view (1200x800)' },
]
function createContainer(size) {
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

  const cardCount = Math.floor((size.width * size.height) / 20000)
  for (let i = 0; i < cardCount; i++) {
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

function waitForNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}
beforeEach(() => {
  cache.image.clear()
  cache.background.clear()
  cache.resource.clear()
})
for (const size of sizes) {
  describe(`preCache warm vs cold - ${size.label}`, () => {
    let container

    afterEach( () => {
      container?.remove()
      container = null
      document.body.innerHTML = ''

    })

    bench('capture without preCache', async () => {
      container = createContainer(size)
      document.body.appendChild(container)
      await waitForNextFrame()
      await snapdom.toRaw(container, { burst: false })
    })

    bench('capture after preCache', async () => {
      container = createContainer(size)
      document.body.appendChild(container)
      await waitForNextFrame()
      await preCache()
      await snapdom.toRaw(container, { burst: false })
    })

  })
}
