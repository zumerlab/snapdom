// Captures that settle without a task of their own (no decode, no fetch) must not chain into
// one long task, whether the burst queue runs them or the caller awaits them in a loop.
import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

let el
afterEach(() => el?.remove())

/** Count the page's tasks while `work` runs; a message channel ticks once per task. */
async function tasksDuring(work) {
  let ticks = 0
  let on = true
  const channel = new MessageChannel()
  channel.port1.onmessage = () => { if (on) { ticks++; channel.port2.postMessage(0) } }
  channel.port2.postMessage(0)
  const t0 = performance.now()
  await work()
  on = false
  return { ticks, ms: performance.now() - t0 }
}

it.each([
  ['queued at once', (scales) => Promise.all(scales.map((scale) => snapdom(el, { scale })))],
  ['awaited in a loop', async (scales) => { for (const scale of scales) await snapdom(el, { scale }) }],
  ['awaited without the memo', async (scales) => { for (const scale of scales) await snapdom(el, { scale, burst: false }) }],
])('hands the page a task once captures %s spend a slice', async (_, run) => {
  el = document.createElement('div')
  el.innerHTML = Array.from({ length: 300 }, (_, i) => `<div style="padding:2px;border:1px solid #ccc">row ${i} <b>b</b></div>`).join('')
  document.body.appendChild(el)
  await snapdom(el)
  // Each scale is a new option set, so every call is a fresh capture, not a memo hit.
  const { ticks, ms } = await tasksDuring(() => run(Array.from({ length: 12 }, (_, i) => 1 + (i + 1) / 100)))
  expect(ms).toBeGreaterThan(40)
  expect(ticks).toBeGreaterThan(0)
})
