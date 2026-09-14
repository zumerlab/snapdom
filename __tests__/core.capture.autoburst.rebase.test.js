// Auto-burst must re-engage when the caller's options settle on a new signature after earlier
// captures used different options (adaptive baseline) — without this, a mixed
// history (e.g. one cold capture config, then a polling loop) made every poll a one-off
// forever and the memo never served.
import { it, expect, afterEach } from 'vitest'

afterEach(() => { document.body.innerHTML = '' })
import { snapdom } from '../src/api/snapdom.js'

function buildScene(width, height) {
  const container = document.createElement('div')
  container.style.cssText = `width:${width}px;height:${height}px;padding:20px;overflow:auto;background:white;border:2px solid black;font-family:Arial;color:#333;position:relative`
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px'
  for (let i = 0; i < Math.floor((width * height) / 20000); i++) {
    const card = document.createElement('div')
    card.style.cssText = 'padding:10px;border-radius:8px;background:#e0eaff;box-shadow:0 2px 5px rgba(0,0,0,0.1)'
    card.textContent = `Card ${i}`
    grid.appendChild(card)
  }
  container.appendChild(grid)
  document.body.appendChild(container)
  return container
}

it('grid scene memoizes under mixed-option history', async () => {
  const warn = console.warn; console.warn = () => {}
  const el = buildScene(1200, 800)
  await new Promise((r) => requestAnimationFrame(r))
  // mixed history: earlier cold calls establish a different option baseline
  for (let i = 0; i < 3; i++) await snapdom(el, { cache: 'disabled' })
  // then a plain polling loop — must re-engage the memo (adaptive baseline)
  await snapdom(el); await snapdom(el) // 2 consecutive '{}' → rebase + fresh
  const t = performance.now()
  const urls = []
  for (let i = 0; i < 10; i++) urls.push((await snapdom(el)).url)
  const poll10 = performance.now() - t
  console.error(`poll10 after mixed history = ${poll10.toFixed(1)}ms`)
  expect(urls[9]).toBe(urls[0]) // memoized identity
  expect(poll10).toBeLessThan(30) // ~memo speed, not 10 pipelines (~40ms+)
  console.warn = warn
})
