import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapFetch } from '../src/modules/snapFetch.js'

afterEach(() => vi.restoreAllMocks())

describe('asset fetch request identity and proxy routing', () => {
  it('keeps simultaneous requests with different authorization headers separate', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      new Response(new Headers(init.headers).get('authorization')))
    const url = `${location.origin}/audit-auth-resource`
    const [a, b] = await Promise.all([
      snapFetch(url, { as: 'text', headers: { Authorization: 'Bearer first' } }),
      snapFetch(url, { as: 'text', headers: { Authorization: 'Bearer second' } }),
    ])
    expect([a.data, b.data]).toEqual(['Bearer first', 'Bearer second'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not reuse an unauthenticated failure for a credentialed retry', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      new Response(init.credentials === 'include' ? 'private image' : '', {
        status: init.credentials === 'include' ? 200 : 401,
      }))
    const url = `${location.origin}/audit-credentials-resource`
    const first = await snapFetch(url, { as: 'text', credentials: 'omit', silent: true })
    const second = await snapFetch(url, { as: 'text', credentials: 'include', silent: true })
    expect(first.status).toBe(401)
    expect(second.data).toBe('private image')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('expands a path proxy containing only the documented {urlRaw} token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'))
    const result = await snapFetch('https://assets.example/image name.png', {
      as: 'text', useProxy: 'https://proxy.example/{urlRaw}',
    })
    expect(result.url).toBe('https://proxy.example/https://assets.example/image%20name.png')
  })

  it.each(['url', 'target'])('proxies an ordinary cross-origin asset with a %s query parameter', async (key) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'))
    const url = `https://assets.example/resize?${key}=source.png`
    const result = await snapFetch(url, { as: 'text', useProxy: 'https://proxy.example/?url={url}' })
    expect(result.url).toBe('https://proxy.example/?url=' + encodeURIComponent(url))
  })

  it('returns a failed result for a malformed URL with logging enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Invalid URL'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(snapFetch('https://', { errorTTL: 0 })).resolves.toMatchObject({ ok: false, reason: 'network' })
  })

  it('does not throw if an error observer throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(snapFetch(`${location.origin}/audit-callback-resource`, {
      silent: true,
      onError: () => { throw new Error('observer failed') },
    })).resolves.toMatchObject({ ok: false, status: 404, reason: 'http_error' })
  })
})
