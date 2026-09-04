// Memoization engages on an element's FIRST capture: there is no "three captures in two
// seconds" threshold any more (burst.js, MAX_LIVE_MEMOS). What the threshold guarded is
// guarded otherwise: a cap on live memos with LRU teardown, the :hover chain compared on
// every serve, and the canvas exclusion that never left.
//
// A memo hit reads no computed style: the getComputedStyle spy is the witness.
// Proven to fail: restoring a threshold turns the first test red; dropping touchMemo's
// eviction turns the cap test red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove(); vi.restoreAllMocks() })

function card(text = 'card') {
  const el = document.createElement('div')
  el.style.cssText = 'width:160px;padding:8px;background:#fff;border:1px solid #ccc;font:13px Arial'
  el.innerHTML = `<b>${text}</b><p style="margin:4px 0 0">text</p>`
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

describe('burst from the first capture', () => {
  it('the second capture of an unchanged element is a memo hit, whenever it comes', async () => {
    const el = card()
    const first = await snapdom(el)
    const reads = vi.spyOn(window, 'getComputedStyle')
    const second = await snapdom(el)
    expect(reads).not.toHaveBeenCalled()
    expect(second.url).toBe(first.url)
  })

  it('a change between the two captures is reflected, as before', async () => {
    const el = card()
    await snapdom(el)
    el.querySelector('p').textContent = 'changed'
    await new Promise((r) => setTimeout(r, 0))
    const res = await snapdom(el)
    expect(decodeURIComponent(res.url.split(',')[1])).toContain('changed')
  })

  it('past 64 live memos the least recently served one is torn down and captures fresh', async () => {
    const first = card('first')
    await snapdom(first)
    for (let i = 0; i < 64; i++) await snapdom(card('n' + i))
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(first)
    expect(reads).toHaveBeenCalled()
    // and it is memoized again from there
    reads.mockClear()
    await snapdom(first)
    expect(reads).not.toHaveBeenCalled()
  }, 30_000)

  it('serving keeps a memo alive: a served element is not the one evicted', async () => {
    const kept = card('kept')
    await snapdom(kept)
    for (let i = 0; i < 63; i++) await snapdom(card('m' + i))
    await snapdom(kept) // served: bumped to the back of the line
    await snapdom(card('one more')) // evicts the oldest, which is no longer `kept`
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(kept)
    expect(reads).not.toHaveBeenCalled()
  }, 30_000)
})
