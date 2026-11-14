import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { cache } from '../src/core/cache.js'
import { compressCloneAssets } from '../src/modules/compress.js'

afterEach(() => cache.compress.clear())

/** A 64x64 PNG of noise seeded by `i`, as a data URL: every call yields different bytes. */
function noisePng(i) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(64, 64)
  let seed = i * 7919 + 1
  for (let p = 0; p < image.data.length; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    image.data[p] = p % 4 === 3 ? 255 : seed & 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

async function gallery(from, count) {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px;line-height:0'
  for (let i = from; i < from + count; i++) {
    const img = document.createElement('img')
    img.src = noisePng(i)
    img.style.cssText = 'width:8px;height:8px'
    host.appendChild(img)
  }
  document.body.appendChild(host)
  await Promise.all(Array.from(host.children, (img) => img.decode()))
  return host
}

describe('compress cache across captures', () => {
  it('serves a page with more images than the entry bound from the cache', async () => {
    const host = await gallery(0, 60)
    try {
      await snapdom(host, { burst: false, dpr: 1 })
      const first = new Set(cache.compress.values())
      expect(first.size).toBe(60)
      await snapdom(host, { burst: false, dpr: 1 })
      // A miss stores a new record: every record still being the first capture's is 60 hits.
      expect(cache.compress.size).toBe(60)
      for (const entry of cache.compress.values()) expect(first.has(entry)).toBe(true)
    } finally {
      host.remove()
    }
  })

  it('drops the previous page once another one fills the cache', async () => {
    const before = await gallery(100, 60)
    await snapdom(before, { burst: false, dpr: 1 })
    const old = new Set(cache.compress.values())
    before.remove()
    const after = await gallery(200, 60)
    try {
      await snapdom(after, { burst: false, dpr: 1 })
      expect(cache.compress.size).toBe(60)
      for (const entry of cache.compress.values()) expect(old.has(entry)).toBe(false)
    } finally {
      after.remove()
    }
  })

  it('one replaced image costs one miss, not the images after it', async () => {
    const host = await gallery(300, 60)
    try {
      await snapdom(host, { burst: false, dpr: 1 })
      const first = Array.from(cache.compress.values())
      host.firstElementChild.src = noisePng(999)
      await host.firstElementChild.decode()
      await snapdom(host, { burst: false, dpr: 1 })
      const now = new Set(cache.compress.values())
      expect(now.size).toBe(60)
      expect(now.has(first[0])).toBe(false)
      expect(first.slice(1).every((entry) => now.has(entry))).toBe(true)
    } finally {
      host.remove()
    }
  })

  it('applies the character bound when a pass that stored something ends', async () => {
    // A real 10x10 PNG header followed by filler: the header alone answers "no gain" for a
    // 100x100 box, so each image stores its 12M-character source without decoding anything.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 10
    const real = canvas.toDataURL('image/png')
    const head = real.slice(0, real.indexOf(',') + 1 + 64)
    const [a, b, c, d] = [0, 1, 2, 3].map((i) => head + 'A'.repeat(12 * 1024 * 1024 + i * 4))
    const pass = (sources) => {
      const clone = document.createElement('div')
      for (const source of sources) {
        const img = document.createElement('img')
        img.style.cssText = 'width:100px;height:100px'
        img.setAttribute('src', source)
        clone.appendChild(img)
      }
      return compressCloneAssets(clone, { compress: true }, new Map())
    }
    const sources = () => Array.from(cache.compress.values(), (entry) => entry.source)
    await pass([a, b, c])
    // 36M characters, over the 32M bound, all used by the pass that stored them.
    expect(sources()).toEqual([a, b, c])
    await pass([a])
    // Nothing stored, nothing trimmed.
    expect(sources()).toEqual([a, b, c])
    await pass([a, d])
    expect(sources()).toEqual([a, d])
  })
})
