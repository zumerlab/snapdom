// The Worker is compress's preferred path, but the SYNC fallback is what actually runs
// wherever blob workers are CSP-blocked or OffscreenCanvas is missing. Nothing exercised
// it, so a broken fallback meant silently uncompressed captures for those users.
//
// Deliberately its own file: compress.js must NOT be imported at module scope here, or its
// `_worker` latch initialises against the real Worker before the stub lands and these tests
// silently exercise the worker path instead (verified — they then pass even with the sync
// fallback removed).
import { describe, it, expect, afterEach, vi } from 'vitest'

function bigPhoto(w, h, seed = 1) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`)
  g.addColorStop(1, `hsl(${(seed * 47 + 120) % 360} 80% 35%)`)
  x.fillStyle = g; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 200; i++) {
    x.beginPath(); x.arc((i * 97 + seed * 13) % w, (i * 53) % h, ((i * 11) % 60) + 5, 0, Math.PI * 2)
    x.fillStyle = `hsla(${(i * 17) % 360} 90% 70% / .35)`; x.fill()
  }
  return c.toDataURL('image/png')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('downsampleDataURL — sync fallback', () => {
  it('downsamples with no Worker at all', async () => {
    const src = bigPhoto(1200, 900, 7)
    vi.stubGlobal('Worker', undefined)
    const { downsampleDataURL } = await import('../src/modules/compress.js')
    const out = await downsampleDataURL(src, 200, 150)
    expect(typeof out).toBe('string')
    expect(out.length).toBeLessThan(src.length)
    expect(out.startsWith('data:image/png')).toBe(true) // codec preserved on this path too
  })

  it('a Worker that errors falls through to the sync path', async () => {
    const src = bigPhoto(1200, 900, 8)
    class BrokenWorker {
      constructor() { setTimeout(() => this.onerror && this.onerror(new Event('error')), 0) }
      postMessage() { /* never answers — onerror drives the fallback */ }
      terminate() { }
    }
    vi.stubGlobal('Worker', BrokenWorker)
    const { downsampleDataURL } = await import('../src/modules/compress.js')
    const out = await downsampleDataURL(src, 200, 150)
    expect(typeof out).toBe('string')
    expect(out.length).toBeLessThan(src.length)
  })
})
