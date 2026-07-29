// Animation frame source: a running animation in a NESTED subtree no longer forces the
// full pipeline every frame — the animated target becomes a dirty root and the diff path
// serves the frame with freshly-snapshotted styles.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

describe('animated subtrees ride the diff path', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('nested WAAPI animation: frames serve via diff, memo never serves stale', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:300px;padding:10px'
    const wrap = document.createElement('div')
    const inner = document.createElement('div')
    inner.style.cssText = 'width:60px;height:40px;background:#3a5'
    inner.textContent = 'anim'
    wrap.appendChild(inner)
    host.appendChild(wrap)
    const sibling = document.createElement('p')
    sibling.textContent = 'estático'
    host.appendChild(sibling)
    document.body.appendChild(host)

    // Warm up: several static captures engage auto-burst and retain artifacts.
    let last
    for (let i = 0; i < 4; i++) last = await snapdom(host)
    const memoBefore = last

    const anim = inner.animate(
      [{ transform: 'translateX(0px)' }, { transform: 'translateX(80px)' }],
      { duration: 60000, iterations: Infinity }
    )
    try {
      const before = { ...__diffStats }
      const r1 = await snapdom(host)
      const r2 = await snapdom(host)
      // Never the stale memo, never each other (every animated frame is fresh)...
      expect(r1).not.toBe(memoBefore)
      expect(r2).not.toBe(r1)
      // ...and at least one frame was served by the differential path.
      expect(__diffStats.served).toBeGreaterThan(before.served)
    } finally {
      anim.cancel()
    }
  })
})
