import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('burst:true — memoizes repeated captures of an unchanged element', () => {
  let el
  afterEach(() => el?.remove())

  function makeEl(text = 'burst-content') {
    el = document.createElement('div')
    el.style.cssText = 'width:180px;padding:6px;background:#def'
    el.textContent = text
    document.body.appendChild(el)
    return el
  }

  it('returns the memoized result while nothing changed', async () => {
    makeEl()
    const r1 = await snapdom(el, { burst: true })
    const r2 = await snapdom(el, { burst: true })
    expect(r2).toBe(r1)
  })

  // Two capture() calls fired without awaiting the first must not run captureDOM
  // concurrently — racing captures of the same element would corrupt its retained
  // burst/diff state (see src/core/burst.js).
  it('serializes concurrent captures of the same element', async () => {
    makeEl()
    const [r1, r2] = await Promise.all([
      snapdom(el, { burst: true }),
      snapdom(el, { burst: true }),
    ])
    expect(r2).toBe(r1)
  })

  it('recaptures after a subtree mutation', async () => {
    makeEl('before-text')
    const r1 = await snapdom(el, { burst: true })
    el.textContent = 'after-text'
    const r2 = await snapdom(el, { burst: true })
    expect(r2).not.toBe(r1)
    expect(decodeURIComponent(r2.url)).toContain('after-text')
  })

  it('a one-off call with different options bypasses the memo without poisoning it', async () => {
    makeEl()
    const r1 = await snapdom(el, { burst: true })
    const rScaled = await snapdom(el, { burst: true, scale: 2 })
    expect(rScaled).not.toBe(r1)
    const r2 = await snapdom(el, { burst: true })
    expect(r2).toBe(r1)
  })

  // Closes the MutationObserver-only staleness gap: canvas pixel draws and programmatic
  // CSSOM edits touch no DOM attribute, so automatic tracking can't see them either —
  // { burst: true, invalidate: true } is the documented manual escape hatch for those.
  it('invalidate:true forces a fresh capture for changes automatic tracking cannot see', async () => {
    makeEl()
    const r1 = await snapdom(el, { burst: true })
    const r2 = await snapdom(el, { burst: true, invalidate: true })
    expect(r2).not.toBe(r1)
    // and the memo resumes normally afterward
    const r3 = await snapdom(el, { burst: true })
    expect(r3).toBe(r2)
  })

  // <video> frame changes (seek, playback) produce no DOM mutation, so they were part of
  // the same staleness gap — tracked directly via timeupdate/seeked listeners.
  it('tracks <video> frame changes that produce no DOM mutation', async () => {
    el = document.createElement('div')
    el.style.cssText = 'width:180px;padding:6px'
    const video = document.createElement('video')
    el.appendChild(video)
    document.body.appendChild(el)

    const r1 = await snapdom(el, { burst: true })
    video.dispatchEvent(new Event('timeupdate'))
    const r2 = await snapdom(el, { burst: true })
    expect(r2).not.toBe(r1)
  })
})

describe('auto-burst — repeated captures enable memoization without the option', () => {
  let el
  afterEach(() => el?.remove())

  it('memoizes from the 3rd rapid capture of the same element on', async () => {
    el = document.createElement('div')
    el.textContent = 'auto burst target'
    document.body.appendChild(el)

    const a = (await snapdom(el)).url
    const b = (await snapdom(el)).url
    const c = (await snapdom(el)).url // threshold hit: memoized from here
    const d = (await snapdom(el)).url
    expect(a).toBe(b) // identical input -> identical output either way
    expect(c).toBe(d) // and the memo keeps serving it
  })

  it('does not accumulate counts across different elements', async () => {
    const mounted = []
    try {
      for (let i = 0; i < 4; i++) {
        const e = document.createElement('div')
        e.textContent = `distinct ${i}`
        document.body.appendChild(e)
        mounted.push(e)
        const res = await snapdom(e)
        expect(decodeURIComponent(res.url.split(',')[1])).toContain(`distinct ${i}`)
      }
    } finally {
      mounted.forEach((e) => e.remove())
    }
  })
})

describe('an <img> load that lands mid-capture', () => {
  // Image loads change layout and paint with NO mutation record. The `once` listener raised
  // state.dirty, but the commit block clears dirty unconditionally and the finally's tear
  // check only judges MutationRecords and state.torn — so a load that landed WHILE the
  // capture ran was committed as a clean frame built from pre-load layout, and `once`
  // de-arming itself meant every later capture served it. Same class as onMediaDirty, which
  // has always set torn.
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  let host, img
  afterEach(() => host?.remove())

  function makeHost() {
    host = document.createElement('div')
    host.style.cssText = 'width:120px;padding:4px;background:#eef'
    img = document.createElement('img')
    // Stands in for an image still in flight: trackPendingImages arms a listener only on
    // an incomplete <img>, and a real one would settle before the capture we want to tear.
    Object.defineProperty(img, 'complete', { get: () => false })
    img.src = PIXEL
    host.appendChild(img)
    host.appendChild(document.createTextNode('caption'))
    document.body.appendChild(host)
    return host
  }

  it('is not memoized as a clean frame', async () => {
    makeHost()
    // The SAME options on every call, so all three share one burst signature — a call whose
    // options differ is treated as a one-off that never commits to the memo, and the
    // assertion below would then hold for a reason that has nothing to do with tearing.
    const fireMidCapture = {
      name: 'fire-img-load-mid-capture',
      beforeRender() { img.dispatchEvent(new Event('load')) },
    }
    const opts = { burst: true, plugins: [fireMidCapture] }

    const torn = await snapdom(host, opts)   // load fires while state.capturing is true
    const next = await snapdom(host, opts)

    expect(next).not.toBe(torn)
  })

  it('still memoizes when nothing lands mid-capture', async () => {
    makeHost()
    const r1 = await snapdom(host, { burst: true })
    const r2 = await snapdom(host, { burst: true })
    expect(r2).toBe(r1)
  })
})
