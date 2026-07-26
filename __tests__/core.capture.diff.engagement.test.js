import { it, expect } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

it('mutating poll: diff vs full', async () => {
  const warn = console.warn; console.warn = () => {}
  const el = document.createElement('div')
  el.style.cssText = 'width:1160px;padding:20px;background:white;font-family:Arial;color:#333'
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:10px'
  for (let i = 0; i < 48; i++) {
    const card = document.createElement('div')
    card.style.cssText = `padding:10px;border-radius:8px;background:${i % 2 ? '#e0eaff' : '#f0f0f0'};box-shadow:0 2px 5px rgba(0,0,0,0.1)`
    const title = document.createElement('h3'); title.textContent = `Card ${i}`; title.style.cssText = 'margin:0;font-size:14px'
    const text = document.createElement('p'); text.textContent = 'Value: 0'; text.style.cssText = 'font-size:12px;margin:0'
    card.append(title, text)
    grid.appendChild(card)
  }
  el.appendChild(grid); document.body.appendChild(el)
  const counter = el.querySelectorAll('p')[10]

  // FULL baseline: burst:false, mutate + capture x10
  let t = performance.now()
  for (let i = 0; i < 10; i++) { counter.textContent = `Value: ${i}`; await snapdom(el, { burst: false }) }
  const tFull = performance.now() - t

  // DIFF: engage burst, then mutate + capture x10
  for (let i = 0; i < 4; i++) await snapdom(el)
  __diffStats.served = 0
  t = performance.now()
  for (let i = 0; i < 10; i++) {
    counter.textContent = `Value: ${100 + i}`
    await new Promise((r) => setTimeout(r, 0))
    await snapdom(el)
  }
  const tDiff = performance.now() - t
  console.error(`FULL x10 = ${tFull.toFixed(1)}ms | DIFF x10 = ${tDiff.toFixed(1)}ms (${(tFull / tDiff).toFixed(1)}x) served=${__diffStats.served}/10`)
  console.warn = warn
  expect(__diffStats.served).toBe(10)
}, 60000)
