import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('snapdom.session', () => {
  let el
  afterEach(() => el?.remove())

  function makeEl(text = 'session-content') {
    el = document.createElement('div')
    el.style.cssText = 'width:180px;padding:6px;background:#def'
    el.textContent = text
    document.body.appendChild(el)
    return el
  }

  it('returns the memoized result while nothing changed', async () => {
    const s = snapdom.session(makeEl())
    const r1 = await s.capture()
    const r2 = await s.capture()
    expect(r2).toBe(r1)
    s.dispose()
  })

  // Speed/correctness punch-list: two capture() calls fired without awaiting the
  // first must not run captureDOM concurrently — it shares the global
  // cache.session bucket, so racing captures corrupt each other's node/style maps.
  it('serializes concurrent capture() calls instead of racing on shared cache.session', async () => {
    const s = snapdom.session(makeEl())
    const [r1, r2] = await Promise.all([s.capture(), s.capture()])
    expect(r2).toBe(r1)
    s.dispose()
  })

  it('recaptures after a subtree mutation', async () => {
    const s = snapdom.session(makeEl('before-text'))
    const r1 = await s.capture()
    el.textContent = 'after-text'
    const r2 = await s.capture()
    expect(r2).not.toBe(r1)
    expect(decodeURIComponent(r2.url)).toContain('after-text')
    s.dispose()
  })

  it('dirty reflects pending mutations', async () => {
    const s = snapdom.session(makeEl())
    await s.capture()
    expect(s.dirty).toBe(false)
    el.setAttribute('data-changed', '1')
    await new Promise(r => setTimeout(r, 0))
    expect(s.dirty).toBe(true)
    s.dispose()
  })

  it('per-call overrides bypass the memo without poisoning it', async () => {
    const s = snapdom.session(makeEl())
    const r1 = await s.capture()
    const rScaled = await s.capture({ scale: 2 })
    expect(rScaled).not.toBe(r1)
    const r2 = await s.capture()
    expect(r2).toBe(r1)
    s.dispose()
  })

  // Closes the MutationObserver-only staleness gap: canvas pixel draws and programmatic
  // CSSOM edits touch no DOM attribute, so the automatic tracking can't see them either —
  // invalidate() is the documented manual escape hatch for those.
  it('invalidate() manually flags the session dirty for changes automatic tracking cannot see', async () => {
    const s = snapdom.session(makeEl())
    const r1 = await s.capture()
    expect(s.dirty).toBe(false)
    s.invalidate()
    expect(s.dirty).toBe(true)
    const r2 = await s.capture()
    expect(r2).not.toBe(r1)
    s.dispose()
  })

  // <video> frame changes (seek, playback) produce no DOM mutation, so they were part of
  // the same staleness gap — now tracked directly via timeupdate/seeked listeners.
  it('tracks <video> frame changes that produce no DOM mutation', async () => {
    el = document.createElement('div')
    el.style.cssText = 'width:180px;padding:6px'
    const video = document.createElement('video')
    el.appendChild(video)
    document.body.appendChild(el)

    const s = snapdom.session(el)
    await s.capture()
    expect(s.dirty).toBe(false)
    video.dispatchEvent(new Event('timeupdate'))
    expect(s.dirty).toBe(true)
    s.dispose()
  })

  it('dispose prevents further captures', async () => {
    const s = snapdom.session(makeEl())
    await s.capture()
    s.dispose()
    await expect(s.capture()).rejects.toThrow(/disposed/)
  })
})
