import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveBlobUrlsInTree } from '../src/utils/clone.helpers.js'

const urls = []
afterEach(() => { vi.restoreAllMocks(); for (const url of urls.splice(0)) URL.revokeObjectURL(url) })
function makeURL(index) {
  const url = URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${index + 1}" height="1"/>`], { type: 'image/svg+xml' }))
  urls.push(url)
  return url
}

describe('blob conversion overlaps independent resources with bounded concurrency', () => {
  it('starts four distinct reads before waiting, dedupes consumers, and converts all resources', async () => {
    const root = document.createElement('div')
    const unique = Array.from({ length: 8 }, (_, i) => makeURL(i))
    for (const url of unique) {
      const image = document.createElement('img')
      image.setAttribute('src', url)
      root.appendChild(image)
    }
    const styled = document.createElement('div')
    styled.style.backgroundImage = `url("${unique[0]}"),url("${unique[1]}")`
    root.appendChild(styled)
    const originalFetch = globalThis.fetch.bind(globalThis)
    const waiting = []
    let active = 0, peak = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      active++
      peak = Math.max(peak, active)
      return new Promise(resolve => waiting.push(async () => {
        const response = await originalFetch(url)
        active--
        resolve(response)
      }))
    })
    const done = resolveBlobUrlsInTree(root)
    // This is a scheduling assertion with manually held responses, not a timing benchmark.
    expect(waiting.length).toBe(4)
    await Promise.all(waiting.splice(0).map(release => release()))
    await vi.waitFor(() => expect(waiting.length).toBe(4))
    await Promise.all(waiting.splice(0).map(release => release()))
    await done
    expect(fetchSpy).toHaveBeenCalledTimes(8)
    expect(peak).toBe(4)
    expect([...root.querySelectorAll('img')].every(image => image.src.startsWith('data:'))).toBe(true)
    expect(styled.style.backgroundImage).not.toContain('blob:')
  })

  it('keeps failed URLs, completes other consumers, and retries failures on the next call', async () => {
    const root = document.createElement('div')
    const good = makeURL(0), retry = makeURL(1)
    root.innerHTML = `<img src="${good}"><img src="${retry}"><svg><image href="${good}"/></svg><video poster="${good}"></video>`
    const originalFetch = globalThis.fetch.bind(globalThis)
    let shouldFail = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => url === retry && shouldFail ? Promise.reject(new Error('temporary failure')) : originalFetch(url))
    await resolveBlobUrlsInTree(root)
    expect(root.querySelectorAll('img')[0].getAttribute('src')).toMatch(/^data:/)
    expect(root.querySelectorAll('img')[1].getAttribute('src')).toBe(retry)
    expect(root.querySelector('image').getAttribute('href')).toMatch(/^data:/)
    expect(root.querySelector('video').getAttribute('poster')).toMatch(/^data:/)
    shouldFail = false
    await resolveBlobUrlsInTree(root)
    expect(root.querySelectorAll('img')[1].getAttribute('src')).toMatch(/^data:/)
  })
})
