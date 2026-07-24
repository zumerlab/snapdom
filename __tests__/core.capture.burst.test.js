import { describe, it, expect, afterEach, vi } from 'vitest'
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
  // concurrently — it shares the global cache.session bucket, so racing captures
  // corrupt each other's node/style maps (see src/core/burst.js).
  it('serializes concurrent captures instead of racing on shared cache.session', async () => {
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

describe('burst advice — suggests burst:true for repeated captures that don\'t use it', () => {
  let el
  afterEach(() => el?.remove())

  it('warns once after 3 captures of the same element in a short window without burst:true', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      el = document.createElement('div')
      el.textContent = 'burst advice target'
      document.body.appendChild(el)

      await snapdom(el)
      expect(warn).not.toHaveBeenCalled()
      await snapdom(el)
      expect(warn).not.toHaveBeenCalled()
      await snapdom(el)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('burst: true')

      // Doesn't repeat on further captures of the same element.
      await snapdom(el)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('never warns once burst:true is already in use', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      el = document.createElement('div')
      el.textContent = 'already using burst'
      document.body.appendChild(el)
      for (let i = 0; i < 5; i++) await snapdom(el, { burst: true })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn for captures spread across different elements', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mounted = []
    try {
      for (let i = 0; i < 3; i++) {
        const e = document.createElement('div')
        e.textContent = `distinct ${i}`
        document.body.appendChild(e)
        mounted.push(e)
        await snapdom(e)
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      mounted.forEach((e) => e.remove())
    }
  })
})
