// The live-DOM mutation resolver (runPictureResolverBeforeClone + plugin factory) was
// dissolved: lazy placeholders resolve on the CLONE in freezeImgSrcset and inlineImages
// fetches them like any source. This file covers the surviving pure URL helpers and the
// clone-path behavior that replaced the old machinery.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isPlaceholderSrc,
  pickSrcsetCandidate,
  findRealUrlForPicture,
  findLazySrcAttr,
} from '../src/modules/pictureResolver.js'
import { freezeImgSrcset } from '../src/utils/clone.helpers.js'

describe('picture/lazy URL helpers', () => {
  let container
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('isPlaceholderSrc detects data/blob/empty', () => {
    expect(isPlaceholderSrc('')).toBe(true)
    expect(isPlaceholderSrc('data:image/gif;base64,R0lGOD')).toBe(true)
    expect(isPlaceholderSrc('blob:http://x/abc')).toBe(true)
    expect(isPlaceholderSrc('https://example.com/real.jpg')).toBe(false)
  })

  it('findLazySrcAttr picks the first non-placeholder lazy attribute', () => {
    const img = document.createElement('img')
    img.setAttribute('data-src', 'https://example.com/lazy.jpg')
    expect(findLazySrcAttr(img)).toBe('https://example.com/lazy.jpg')
    const img2 = document.createElement('img')
    img2.setAttribute('data-src', 'data:image/gif;base64,tiny')
    img2.setAttribute('data-original', 'https://example.com/original.jpg')
    expect(findLazySrcAttr(img2)).toBe('https://example.com/original.jpg')
  })

  it('findLazySrcAttr falls back to the first data-srcset candidate', () => {
    const img = document.createElement('img')
    img.setAttribute('data-srcset', 'https://example.com/a-1x.jpg 1x, https://example.com/a-2x.jpg 2x')
    expect(findLazySrcAttr(img)).toBe('https://example.com/a-1x.jpg')
  })

  it('pickSrcsetCandidate picks a candidate from a plain srcset', () => {
    const img = document.createElement('img')
    const picked = pickSrcsetCandidate('https://example.com/1x.jpg 1x, https://example.com/2x.jpg 2x', img)
    expect(['https://example.com/1x.jpg', 'https://example.com/2x.jpg']).toContain(picked)
  })

  it('findRealUrlForPicture reads a matching <source> of the parent picture', () => {
    const picture = document.createElement('picture')
    const source = document.createElement('source')
    source.setAttribute('srcset', 'https://example.com/from-source.jpg')
    const img = document.createElement('img')
    picture.appendChild(source)
    picture.appendChild(img)
    container.appendChild(picture)
    expect(findRealUrlForPicture(img, picture)).toBe('https://example.com/from-source.jpg')
  })
})

describe('clone-path lazy resolution (replaces the live-DOM resolver)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('freezeImgSrcset resolves a lazy data-src placeholder onto the clone, source untouched', () => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    img.setAttribute('data-src', 'https://example.com/real-lazy.jpg')
    document.body.appendChild(img)
    const clone = img.cloneNode(false)
    freezeImgSrcset(img, clone, {})
    expect(clone.getAttribute('src')).toBe('https://example.com/real-lazy.jpg')
    // The live element is never mutated (no flicker, no undo dance).
    expect(img.getAttribute('src')).toBe('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
  })

  it('respects resolvePicturePlaceholders: false', () => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    img.setAttribute('data-src', 'https://example.com/real-lazy.jpg')
    document.body.appendChild(img)
    const clone = img.cloneNode(false)
    freezeImgSrcset(img, clone, { resolvePicturePlaceholders: false })
    expect(clone.getAttribute('src')).not.toBe('https://example.com/real-lazy.jpg')
  })
})
