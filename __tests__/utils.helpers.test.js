import { describe, it, expect } from 'vitest'
import { extractURL, stripTranslate, safeEncodeURI, resolveURL, resolveImageSetURL } from '../src/utils'

describe('image-set candidate boundaries', () => {
  it('keeps commas inside quoted URLs when choosing the requested density', () => {
    const value = 'image-set(url("hero,small.png") 1x, url("hero,large.png") 2x)'
    expect(resolveImageSetURL(value, 1)).toBe('hero,small.png')
    expect(resolveImageSetURL(value, 2)).toBe('hero,large.png')
  })

  it('keeps the complete data URL instead of splitting its payload', () => {
    const small = 'data:image/png;base64,AAAA'
    const large = 'data:image/png;base64,BBBB'
    const value = `image-set(url("${small}") 1x, url("${large}") 2x)`
    expect(resolveImageSetURL(value, 2)).toBe(large)
  })

  it('does not treat a comma in an unquoted url() as a candidate separator', () => {
    expect(resolveImageSetURL('image-set(url(hero,small.png) 1x, url(hero,large.png) 2x)', 2))
      .toBe('hero,large.png')
  })
})

describe('resolveURL', () => {
  it('resolves relative URL against base', () => {
    expect(resolveURL('bg_body.png', 'https://example.com/page')).toBe('https://example.com/bg_body.png')
    expect(resolveURL('img/a.png', 'https://example.com/page/')).toBe('https://example.com/page/img/a.png')
  })
  it('returns data/blob/about URLs unchanged', () => {
    expect(resolveURL('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
    expect(resolveURL('blob:https://x/123')).toBe('blob:https://x/123')
  })
})

describe('extractURL', () => {
  it('extracts the URL from background-image', () => {
    expect(extractURL('url("https://test.com/img.png")')).toBe('https://test.com/img.png')
    expect(extractURL('none')).toBeNull()
  })
})

describe('stripTranslate', () => {
  it('removes translate transforms', () => {
    expect(stripTranslate('translateX(10px) scale(2)')).toBe('scale(2)')
  })
  it('stripTranslate removes matrix and matrix3d', () => {
    expect(stripTranslate('matrix(1,0,0,1,10,20)')).not.toContain('10,20')
    expect(stripTranslate('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1)')).not.toContain('10,20,30')
  })
})

describe('safeEncodeURI', () => {
  it('returns an encoded string', () => {
    expect(typeof safeEncodeURI('https://test.com/á')).toBe('string')
  })
  it('safeEncodeURI handles invalid URIs gracefully', () => {
    expect(typeof safeEncodeURI('%E0%A4%A')).toBe('string')
  })
})

describe('stripTranslate edge cases', () => {
  it('returns empty string for empty or none', () => {
    expect(stripTranslate('')).toBe('')
    expect(stripTranslate('none')).toBe('')
  })
  it('returns original for malformed matrix', () => {
    expect(stripTranslate('matrix(1,2,3)')).toBe('matrix(1,2,3)')
    expect(stripTranslate('matrix3d(1,2,3)')).toBe('matrix3d(1,2,3)')
  })
})
