// A transient fetch failure of a background-image URL must not outlive snapFetch's own error
// memo (errorTTL, 8 s): the layer paints again once the URL recovers.
//
// fetch is stubbed by wrapping globalThis.fetch at runtime. snapFetch reads the global `fetch`
// per call, so the static import of snapdom does not latch the real one.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { for (const n of mounted.splice(0)) n.remove() })

async function redPng() {
  const c = document.createElement('canvas')
  c.width = 40; c.height = 40
  const g = c.getContext('2d')
  g.fillStyle = 'rgb(255,0,0)'
  g.fillRect(0, 0, 40, 40)
  return await new Promise((r) => c.toBlob(r, 'image/png'))
}

/** Wrap fetch: URLs containing `marker` fail while `state.fail` is true, else serve `blob`. */
function stubFetch(marker, blob, state) {
  const orig = globalThis.fetch
  globalThis.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    if (url.includes(marker)) {
      state.calls++
      if (state.fail) throw new TypeError('Failed to fetch (repro)')
      return new Response(blob, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    return orig.call(this, input, init)
  }
  return () => { globalThis.fetch = orig }
}

async function countRed(res) {
  const canvas = await res.toCanvas({ dpr: 1, scale: 1 })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++
  return n
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe('a background whose fetch failed once', () => {
  it('a background that failed once paints once the URL recovers (past errorTTL)', async () => {
    const marker = `__repro_bgD_${Math.random().toString(36).slice(2)}.png`
    const state = { fail: true, calls: 0 }
    const restore = stubFetch(marker, await redPng(), state)
    try {
      const host = document.createElement('div')
      host.innerHTML = `<div class="rdbg-box" style="width:40px;height:40px;background-color:#fff;background-image:url('/${marker}');background-size:40px 40px"></div>`
      document.body.appendChild(host); mounted.push(host)
      const el = host.firstChild

      const first = await snapdom(el, { burst: false })
      const redFirst = await countRed(first)
      const callsAfterFirst = state.calls

      state.fail = false
      await wait(8600) // past snapFetch's errorTTL of 8000 ms

      const second = await snapdom(el, { burst: false })
      const redSecond = await countRed(second)
      const msg = `first: red=${redFirst} fetches=${callsAfterFirst}; second: red=${redSecond} fetches=${state.calls - callsAfterFirst}`
      expect(redFirst, msg).toBe(0) // control: the failing capture really painted nothing
      expect(redSecond, msg).toBeGreaterThan(1500) // 40x40 = 1600
    } finally { restore() }
  }, 30000)

  it('positive control: the same background, never failed, paints; cache:disabled recovers it', async () => {
    const marker = `__repro_bgD_ok_${Math.random().toString(36).slice(2)}.png`
    const state = { fail: false, calls: 0 }
    const restore = stubFetch(marker, await redPng(), state)
    try {
      const host = document.createElement('div')
      host.innerHTML = `<div class="rdbg-ok" style="width:40px;height:40px;background-color:#fff;background-image:url('/${marker}');background-size:40px 40px"></div>`
      document.body.appendChild(host); mounted.push(host)
      expect(await countRed(await snapdom(host.firstChild, { burst: false }))).toBeGreaterThan(1500)

      // Same failure as above, then recovery read with cache:'disabled': paints.
      const marker2 = `__repro_bgD_dis_${Math.random().toString(36).slice(2)}.png`
      const s2 = { fail: true, calls: 0 }
      const restore2 = stubFetch(marker2, await redPng(), s2)
      try {
        const host2 = document.createElement('div')
        host2.innerHTML = `<div class="rdbg-dis" style="width:40px;height:40px;background-color:#fff;background-image:url('/${marker2}');background-size:40px 40px"></div>`
        document.body.appendChild(host2); mounted.push(host2)
        expect(await countRed(await snapdom(host2.firstChild, { burst: false }))).toBe(0)
        s2.fail = false
        await wait(8600)
        expect(await countRed(await snapdom(host2.firstChild, { burst: false, cache: 'disabled' }))).toBeGreaterThan(1500)
      } finally { restore2() }
    } finally { restore() }
  }, 30000)

  it('control: an <img> that failed once paints once the URL recovers (past errorTTL)', async () => {
    const marker = `__repro_imgD_${Math.random().toString(36).slice(2)}.png`
    const state = { fail: true, calls: 0 }
    const restore = stubFetch(marker, await redPng(), state)
    try {
      const host = document.createElement('div')
      host.innerHTML = `<div class="rdimg-box" style="width:40px;height:40px;background:#fff"><img src="/${marker}" width="40" height="40" style="display:block;width:40px;height:40px" alt=""></div>`
      document.body.appendChild(host); mounted.push(host)
      const el = host.firstChild

      const first = await snapdom(el, { burst: false, placeholders: false })
      const redFirst = await countRed(first)
      const callsAfterFirst = state.calls

      state.fail = false
      await wait(8600)

      const second = await snapdom(el, { burst: false, placeholders: false })
      const redSecond = await countRed(second)
      const msg = `first: red=${redFirst} fetches=${callsAfterFirst}; second: red=${redSecond} fetches=${state.calls - callsAfterFirst}`
      expect(redFirst, msg).toBe(0)
      expect(redSecond, msg).toBeGreaterThan(1500)
    } finally { restore() }
  }, 30000)
})
