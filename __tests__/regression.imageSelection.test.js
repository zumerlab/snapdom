import { describe, it, expect, afterEach } from 'vitest'
import { findRealUrlForPicture, pickSrcsetCandidate } from '../src/modules/pictureResolver.js'
import { resolveImageSetURL } from '../src/utils/helpers.js'
import { snapdom } from '../src/api/snapdom.js'

// The browser's own selection algorithms (srcset descriptors, <source type>, image-set
// type()) out-rank source order — the resolver used to freeze the FIRST candidate,
// capturing an asset the live page never displayed.

function stubUnresolved(img) {
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => '' })
}

describe('srcset candidate selection', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('pickSrcsetCandidate honors w descriptors against the layout width', () => {
    const img = document.createElement('img')
    img.style.cssText = 'width:800px;height:10px'
    document.body.appendChild(img)
    // 400w/800px = 0.5x, 1600w/800px = 2x → at DPR>=1 the 1600w asset is what the browser shows
    expect(pickSrcsetCandidate('a-400.jpg 400w, a-1600.jpg 1600w', img)).toBe('a-1600.jpg')
  })

  it('pickSrcsetCandidate falls back to the largest density when none reaches DPR', () => {
    expect(pickSrcsetCandidate('lo.png 0.2x, hi.png 0.5x')).toBe('hi.png')
  })

  it('findRealUrlForPicture picks by descriptor inside a matching media source', () => {
    const picture = document.createElement('picture')
    const source = document.createElement('source')
    source.setAttribute('media', '(min-width: 0px)')
    source.setAttribute('srcset', 'bh-400.png 400w, bh-1600.png 1600w')
    const img = document.createElement('img')
    img.style.cssText = 'width:800px;height:10px'
    picture.append(source, img)
    document.body.appendChild(picture)
    stubUnresolved(img)
    expect(findRealUrlForPicture(img, picture)).toBe('bh-1600.png')
  })

  it('findRealUrlForPicture skips <source> types no engine decodes', () => {
    const picture = document.createElement('picture')
    const jxl = document.createElement('source')
    jxl.setAttribute('type', 'image/jxl')
    jxl.setAttribute('srcset', 'a.jxl')
    const webp = document.createElement('source')
    webp.setAttribute('type', 'image/webp')
    webp.setAttribute('srcset', 'a.webp')
    const img = document.createElement('img')
    picture.append(jxl, webp, img)
    document.body.appendChild(picture)
    stubUnresolved(img)
    expect(findRealUrlForPicture(img, picture)).toBe('a.webp')
  })
})

describe('image-set() type() specifiers', () => {
  it('resolveImageSetURL skips candidates with undecodable type()', () => {
    const v = 'image-set(url("bg.jxl") type("image/jxl") 1x, url("bg.png") type("image/png") 1x)'
    expect(resolveImageSetURL(v, 1)).toBe('bg.png')
  })

  it('resolveImageSetURL still picks by resolution when no type() present', () => {
    const v = 'image-set(url("a.png") 1x, url("b.png") 2x)'
    expect(resolveImageSetURL(v, 2)).toBe('b.png')
  })
})

describe('srcset-only <img> captured before load', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('freezes a candidate instead of exporting a source-less <img>', async () => {
    const wrap = document.createElement('div')
    const img = document.createElement('img')
    img.setAttribute('srcset', '/__tests__/fixtures/bh-1x.svg 1x, /__tests__/fixtures/bh-2x.svg 2x')
    img.width = 40
    img.height = 40
    wrap.appendChild(img)
    document.body.appendChild(wrap)

    // Capture immediately: Chromium leaves currentSrc empty until the candidate loads
    const result = await snapdom(wrap)
    const svg = decodeURIComponent(result.url.split(',')[1])
    const bare = (svg.match(/<img(?![^>]*src=)[^>]*>/g) || []).length
    expect(bare).toBe(0)
    expect(svg).toMatch(/<img[^>]*src="data:image\/svg\+xml/)
  })
})

describe('element-level content: url() replacement on <img>', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('captures the content-replaced image, not the src fallback', async () => {
    const green = new Blob(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="rgb(0,255,0)"/></svg>'],
      { type: 'image/svg+xml' }
    )
    const blobUrl = URL.createObjectURL(green)
    const style = document.createElement('style')
    style.textContent = `img.bh-content-repro { content: url("${blobUrl}"); }`
    document.head.appendChild(style)

    const img = document.createElement('img')
    img.className = 'bh-content-repro'
    // red 1x1 png as the src fallback the live page does NOT display
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    document.body.appendChild(img)
    await new Promise((r) => { const probe = new Image(); probe.onload = r; probe.onerror = r; probe.src = blobUrl })

    try {
      const result = await snapdom(img)
      const canvas = await result.toCanvas()
      const ctx = canvas.getContext('2d')
      const px = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
      expect(px[1]).toBeGreaterThan(200) // green: the content-replacement image
      expect(px[0]).toBeLessThan(100)
    } finally {
      style.remove()
      URL.revokeObjectURL(blobUrl)
    }
  })
})
