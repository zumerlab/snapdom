// snapFetch memoizes failures so a broken URL is not retried in a storm, but nothing ever
// revisits a key that is never requested again: the map only grew. These tests pin the bound
// and, just as important, pin WHICH entry is dropped, because dropping a live entry to keep
// expired garbage would defeat the cache's whole purpose.
//
// Deliberately its own file with NO top-level import of snapFetch: the error cache is module
// state, so every test needs a fresh module instance (resetModules + dynamic import).
import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** Global fetch that always fails, counting the calls it actually receives. */
function stubFailingFetch() {
  const calls = []
  vi.stubGlobal('fetch', (u) => { calls.push(String(u)); return Promise.reject(new TypeError('boom')) })
  return calls
}

const OPTS = { as: 'text', silent: true }

describe('snapFetch error cache', () => {
  it('serves a memoized failure without re-fetching', async () => {
    const calls = stubFailingFetch()
    const { snapFetch } = await import('../src/modules/snapFetch.js')

    const first = await snapFetch('http://localhost:9/a', OPTS)
    const second = await snapFetch('http://localhost:9/a', OPTS)

    expect(first.ok).toBe(false)
    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('is bounded: flooding distinct failures evicts the oldest entry', async () => {
    const calls = stubFailingFetch()
    const { snapFetch } = await import('../src/modules/snapFetch.js')

    await snapFetch('http://localhost:9/oldest', OPTS)
    // Well past any sane cap. All of these are still live, so nothing can be swept and the
    // bound has to evict in FIFO order.
    for (let i = 0; i < 120; i++) await snapFetch(`http://localhost:9/f${i}`, OPTS)

    const recent = await snapFetch('http://localhost:9/f119', OPTS)
    expect(recent.fromCache).toBe(true) // a recent entry is still served

    const before = calls.length
    const evicted = await snapFetch('http://localhost:9/oldest', OPTS)
    expect(evicted.fromCache).toBe(false) // the oldest one is gone, so it hit the network again
    expect(calls.length).toBe(before + 1)
  })

  it('sweeps expired entries before touching a live one', async () => {
    const calls = stubFailingFetch()
    const { snapFetch } = await import('../src/modules/snapFetch.js')

    // One long-lived entry, inserted FIRST so pure FIFO eviction would drop exactly it.
    await snapFetch('http://localhost:9/live', { ...OPTS, errorTTL: 60_000 })
    // Then enough already-expired entries to push the map past its cap. The pause makes each
    // one genuinely stale by the time the next insertion checks the cap.
    for (let i = 0; i < 120; i++) {
      await snapFetch(`http://localhost:9/dead${i}`, { ...OPTS, errorTTL: 1 })
      await new Promise(r => setTimeout(r, 2))
    }

    const before = calls.length
    const live = await snapFetch('http://localhost:9/live', { ...OPTS, errorTTL: 60_000 })
    expect(live.fromCache).toBe(true)
    expect(calls.length).toBe(before)
  })
})
