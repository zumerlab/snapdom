import { describe, it, expect } from 'vitest'
import { extractURL, isIconFont, stripTranslate, safeEncodeURI, resolveURL } from '../src/utils'

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

describe('isIconFont', () => {
  it('detects icon fonts', () => {
    expect(isIconFont('Font Awesome')).toBe(true)
    expect(isIconFont('Arial')).toBe(false)
  })
})

describe('stripTranslate', () => {
  it('removes translate transforms', () => {
    expect(stripTranslate('translateX(10px) scale(2)')).toContain('scale(2)')
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
