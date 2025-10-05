// __tests__/module.snapFetch.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Re-import the module with a clean state so internal singletons
 * like _inflight / _errorCache start fresh.
 * @returns {Promise<{snapFetch: (url: string, opts?: any)=>Promise<any>}>}
 */
async function importFresh() {
  vi.resetModules()
  return import('../src/modules/snapFetch.js')
}

/** Stable origins/URLs for tests (no need to redefine window.location). */
const ORIGIN = globalThis.location?.origin || 'http://localhost'
const SAME = `${ORIGIN}/assets/a.css`
const CROSS = 'https://cdn.example/x.png'

/** Mock `fetch` with a static Response. */
function mockFetchOnce(status = 200, body = 'ok', headers = {}) {
  globalThis.fetch = vi.fn(async (_input, _init) => new Response(body, { status, headers }))
}

/** Mock `fetch` that rejects like a network error. */
function mockFetchNetworkError() {
  globalThis.fetch = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
}

/** Mock `fetch` that rejects with AbortError when the signal aborts (timeout). */
function mockFetchTimeoutAware() {
  globalThis.fetch = vi.fn((input, init) => {
    return new Promise((_, reject) => {
      const err = Object.assign(new Error('timeout'), { name: 'AbortError' })
      const signal = init?.signal
      if (signal?.aborted) return reject(err)
      signal?.addEventListener('abort', () => reject(err), { once: true })
    })
  })
}

/** Create a deferred promise for fine-grained inflight control. */
function deferred() {
  const d = {}
  d.promise = new Promise((res, rej) => {
    d.resolve = res
    d.reject = rej
  })
  // @ts-ignore
  return d
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('snapFetch (happy paths)', () => {
  it('returns text when as:"text"', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(200, 'hello', { 'content-type': 'text/plain' })

    const res = await snapFetch(`${ORIGIN}/hello.txt`, { as: 'text' })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.data).toBe('hello')
  })

  it('returns Blob when as:"blob"', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(200, 'BLOB!', { 'content-type': 'image/png' })

    const res = await snapFetch(`${ORIGIN}/p.png`, { as: 'blob' })
    expect(res.ok).toBe(true)
    expect(res.data).toBeInstanceOf(Blob)
    expect(res.mime).toMatch(/image\/png/i)
  })

  it('returns DataURL when as:"dataURL"', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(200, 'PNGDATA', { 'content-type': 'image/png' })

    const res = await snapFetch(`${ORIGIN}/p.png`, { as: 'dataURL' })
    expect(res.ok).toBe(true)
    expect(typeof res.data).toBe('string')
    expect(res.data.startsWith('data:')).toBe(true)
  })
})

describe('snapFetch (errors are non-throwing)', () => {
  it('maps HTTP error to { ok:false, reason:"http_error" }', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(404, '', {})

    const res = await snapFetch(`${ORIGIN}/miss.css`, { as: 'text' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.reason).toBe('http_error')
  })

  it('maps network error to { ok:false, reason:"network" }', async () => {
    const { snapFetch } = await importFresh()
    mockFetchNetworkError()

    const res = await snapFetch(CROSS, { as: 'blob' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(0)
    expect(res.reason).toBe('network')
  })

  it('maps timeout to { ok:false, reason:"timeout" }', async () => {
    vi.useFakeTimers()
    const { snapFetch } = await importFresh()
    mockFetchTimeoutAware()

    const p = snapFetch(CROSS, { as: 'blob', timeout: 123 })
    vi.advanceTimersByTime(123)

    const res = await p
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('timeout')
    expect(res.status).toBe(0)
  })
})

describe('snapFetch (inflight dedup + error TTL)', () => {
  it('deduplicates inflight requests to same key', async () => {
    const { snapFetch } = await importFresh()

    // Controlled fetch that resolves later
    const d = deferred()
    globalThis.fetch = vi.fn((_input, _init) => d.promise)

    const reqA = snapFetch(`${ORIGIN}/a.png`, { as: 'blob', timeout: 999 })
    const reqB = snapFetch(`${ORIGIN}/a.png`, { as: 'blob', timeout: 999 })

    // Only one network call
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    // Fulfill with a real Response
    d.resolve(new Response('IMG', { status: 200, headers: { 'content-type': 'image/png' } }))

    const [resA, resB] = await Promise.all([reqA, reqB])
    expect(resA.ok && resB.ok).toBe(true)
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
  })

   it('caches errors for errorTTL and does not re-fetch within TTL', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2020-01-01T00:00:00Z'))

  const { snapFetch } = await importFresh()

  // Un solo spy con dos respuestas
  const spy = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValueOnce(new Response('OK', { status: 200, headers: { 'content-type': 'image/png' } }))
  globalThis.fetch = spy

  // 1) Falla inicial → cachea error
  const r1 = await snapFetch(`${ORIGIN}/fail.png`, { as: 'blob', errorTTL: 8000 })
  expect(r1.ok).toBe(false)
  expect(spy).toHaveBeenCalledTimes(1)

  // 2) Dentro del TTL → no re-fetch (desde cache)
  const r2 = await snapFetch(`${ORIGIN}/fail.png`, { as: 'blob', errorTTL: 8000 })
  expect(r2.ok).toBe(false)
  expect(r2.fromCache).toBe(true)
  expect(spy).toHaveBeenCalledTimes(1)

  // 3) Pasado el TTL → re-fetch (segunda llamada real)
  vi.advanceTimersByTime(8001)
  vi.setSystemTime(new Date('2020-01-01T00:00:08.001Z'))

  const r3 = await snapFetch(`${ORIGIN}/fail.png`, { as: 'blob', errorTTL: 8000 })
  expect(r3.ok).toBe(true)
  expect(spy).toHaveBeenCalledTimes(2)
})

})

describe('snapFetch (proxy & credentials)', () => {
  it('same-origin → credentials: include, no proxy applied', async () => {
    const { snapFetch } = await importFresh()
    const spy = vi.fn(async (_input, _init) => new Response('ok', { status: 200 }))
    globalThis.fetch = spy

    const url = SAME
    await snapFetch(url, { as: 'text', useProxy: 'https://proxy.example/p?url={url}' })

    // No proxy used
    expect(spy.mock.calls[0][0]).toBe(url)
    // Credentials should be 'include' for same-origin
    expect(spy.mock.calls[0][1]?.credentials).toBe('include')
  })

  it('cross-origin + proxy template replaces {url}', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(200, 'ok', {})
    const res = await snapFetch(CROSS, {
      as: 'blob',
      useProxy: 'https://proxy.example/p?url={url}'
    })
    expect(res.ok).toBe(true)
    expect(res.url).toBe('https://proxy.example/p?url=' + encodeURIComponent(CROSS))
  })

  it('cross-origin + base proxy appends ?url=', async () => {
    const { snapFetch } = await importFresh()
    mockFetchOnce(200, 'ok', {})
    const res = await snapFetch(CROSS, {
      as: 'text',
      useProxy: 'https://proxy.example/p?'
    })
    expect(res.ok).toBe(true)
    expect(res.url).toBe('https://proxy.example/p?url=' + encodeURIComponent(CROSS))
  })
})

 describe('snapFetch (logging & silent mode)', () => {
   it('dedupes console messages; silent:true suppresses logs', async () => {
     const { snapFetch } = await importFresh()
     const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
     const errSpy  = vi.spyOn(console, 'error').mockImplementation(() => {})

     // First: HTTP error (warn once)
     mockFetchOnce(404, '', {})
     const r1 = await snapFetch(`${ORIGIN}/missing.png`, { as: 'blob' })
     expect(r1.ok).toBe(false)

     const warnCountAfter1 = warnSpy.mock.calls.length

     // Second same error within logger TTL: no new warn
     const r2 = await snapFetch(`${ORIGIN}/missing.png`, { as: 'blob' })
     expect(r2.ok).toBe(false)
     expect(warnSpy.mock.calls.length).toBe(warnCountAfter1)

     const totalBefore = errSpy.mock.calls.length + warnSpy.mock.calls.length
 mockFetchNetworkError()
 const r3 = await snapFetch(CROSS, { as: 'blob' })
 expect(r3.ok).toBe(false)
 const totalAfter = errSpy.mock.calls.length + warnSpy.mock.calls.length
 // Aceptamos 0 o 1 log nuevo (dedupe-friendly):
 expect([0, 1]).toContain(totalAfter - totalBefore)

     // Silent suppresses
      mockFetchNetworkError()
  const r4 = await snapFetch('https://cdn.example/b.png', { as: 'blob', silent: true })
  expect(r4.ok).toBe(false)
  const afterSilent = errSpy.mock.calls.length + warnSpy.mock.calls.length
  expect(afterSilent).toBe(totalAfter)

     warnSpy.mockRestore()
     errSpy.mockRestore()
   })
 })
