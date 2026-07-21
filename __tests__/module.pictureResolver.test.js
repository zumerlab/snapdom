import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isPlaceholderSrc,
  quickProbeMayNeedPictureResolver,
  runPictureResolverBeforeClone,
  findLazySrcAttr,
  pictureResolver,
} from '../src/modules/pictureResolver.js'

describe('pictureResolver core', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () =>
          Promise.resolve(
            new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
          ),
      })
    )
  })

  afterEach(() => {
    document.body.removeChild(container)
    vi.restoreAllMocks()
  })

  it('isPlaceholderSrc detects data/blob/empty', () => {
    expect(isPlaceholderSrc('')).toBe(true)
    expect(isPlaceholderSrc('data:image/png;base64,xx')).toBe(true)
    expect(isPlaceholderSrc('blob:x')).toBe(true)
    expect(isPlaceholderSrc('https://cdn.example.com/a.jpg')).toBe(false)
  })

  it('quickProbeMayNeedPictureResolver returns false for empty subtree', () => {
    expect(quickProbeMayNeedPictureResolver(container, true)).toBe(false)
  })

  it('quickProbeMayNeedPictureResolver returns true when <picture> exists', () => {
    container.appendChild(document.createElement('picture'))
    expect(quickProbeMayNeedPictureResolver(container, true)).toBe(true)
  })

  it('quickProbeMayNeedPictureResolver returns true for lazy hints when resolveLazySrc', () => {
    const img = document.createElement('img')
    img.setAttribute('data-src', 'https://ex.com/hi.png')
    container.appendChild(img)
    expect(quickProbeMayNeedPictureResolver(container, true)).toBe(true)
    expect(quickProbeMayNeedPictureResolver(container, false)).toBe(false)
  })

  it('runPictureResolverBeforeClone returns null when probe is false (fast exit)', async () => {
    const r = await runPictureResolverBeforeClone(container, { useProxy: '' })
    expect(r).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('runPictureResolverBeforeClone resolves placeholder <picture> and undo restores', async () => {
    const picture = document.createElement('picture')
    const source = document.createElement('source')
    source.setAttribute('srcset', 'https://ex.com/real.png')
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    picture.appendChild(source)
    picture.appendChild(img)
    container.appendChild(picture)

    const undo = await runPictureResolverBeforeClone(container, {
      useProxy: '',
      pictureResolver: { timeout: 3000, concurrency: 2 },
    })
    expect(typeof undo).toBe('function')
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(img.getAttribute('src')?.startsWith('data:')).toBe(true)
    expect(picture.querySelectorAll('source').length).toBe(0)

    await undo()
    expect(img.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true)
    expect(picture.querySelectorAll('source').length).toBe(1)
  })

  it('findLazySrcAttr prefers data-src and reads data-srcset first candidate', () => {
    const a = document.createElement('img')
    a.setAttribute('data-src', 'https://ex.com/hi.png')
    expect(findLazySrcAttr(a)).toBe('https://ex.com/hi.png')

    const b = document.createElement('img')
    b.setAttribute('data-srcset', 'https://ex.com/1x.png 1x, https://ex.com/2x.png 2x')
    expect(findLazySrcAttr(b)).toBe('https://ex.com/1x.png')

    const c = document.createElement('img')
    c.setAttribute('data-src', 'data:image/gif;base64,zz') // placeholder → ignored
    expect(findLazySrcAttr(c)).toBeNull()
  })

  it('resolves a lazy data-src placeholder img and undo restores it', async () => {
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    img.setAttribute('data-src', 'https://ex.com/real-lazy.png')
    container.appendChild(img)

    const undo = await runPictureResolverBeforeClone(container, { useProxy: '' })
    expect(typeof undo).toBe('function')
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(img.getAttribute('src')?.startsWith('data:image/png')).toBe(true)

    await undo()
    expect(img.getAttribute('src')?.startsWith('data:image/png;base64,iVBOR')).toBe(true)
  })

  it('pictureResolver() plugin factory mutates on beforeClone and restores on afterClone', async () => {
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    img.setAttribute('data-src', 'https://ex.com/real-plugin.png')
    container.appendChild(img)

    const plugin = pictureResolver({ concurrency: 2 })
    expect(plugin.name).toBe('picture-resolver')

    const ctx = { element: container, options: {} }
    await plugin.beforeClone(ctx)
    const swapped = img.getAttribute('src')
    expect(swapped?.startsWith('data:image/png')).toBe(true)

    await plugin.afterClone(ctx)
    expect(img.getAttribute('src')?.startsWith('data:image/png;base64,iVBOR')).toBe(true)
  })

  // Minimal-code/fidelity punch-list: fetchAsDataUrl now delegates to snapFetch
  // instead of hand-rolling fetch+proxy+credentials, fixing two fidelity gaps.
  it('omits credentials for a cross-origin lazy src (was hardcoded "include")', async () => {
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    img.setAttribute('data-src', 'https://cross-origin.example.com/real-cred.png')
    container.appendChild(img)

    await runPictureResolverBeforeClone(container, { useProxy: '' })

    expect(globalThis.fetch).toHaveBeenCalled()
    const [, fetchOpts] = globalThis.fetch.mock.calls[0]
    expect(fetchOpts.credentials).toBe('omit')
  })

  it('proxies a cross-origin lazy src on the first request instead of only retrying on failure', async () => {
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    img.setAttribute('data-src', 'https://cross-origin.example.com/real-proxy.png')
    container.appendChild(img)

    await runPictureResolverBeforeClone(container, { useProxy: 'https://proxy.example.com/?url=' })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = globalThis.fetch.mock.calls[0]
    expect(calledUrl).toBe('https://proxy.example.com/?url=' + encodeURIComponent('https://cross-origin.example.com/real-proxy.png'))
  })

  it('respects resolvePicturePlaceholders: false', async () => {
    const picture = document.createElement('picture')
    const img = document.createElement('img')
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
    const src = document.createElement('source')
    src.setAttribute('srcset', 'https://ex.com/x.png')
    picture.appendChild(src)
    picture.appendChild(img)
    container.appendChild(picture)

    const r = await runPictureResolverBeforeClone(container, { resolvePicturePlaceholders: false })
    expect(r).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
