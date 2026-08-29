import { describe, it, expect } from 'vitest'
import { getStyle, parseContent, snapshotComputedStyle, stripTranslate, shouldIgnoreProp } from '../src/utils'
import { splitBackgroundImage, getStyleKey } from '../src/utils/css.js'

describe('getStyle', () => {
  it('returns a CSSStyleDeclaration', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const style = getStyle(el)
    expect(style).toBeInstanceOf(CSSStyleDeclaration)
    document.body.removeChild(el)
  })

  it('never returns undefined for elements', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const style = getStyle(el)
    expect(style).not.toBeUndefined()
    document.body.removeChild(el)
  })

  it('never returns undefined for pseudos', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const pseudoStyle = getStyle(el, '::before')
    expect(pseudoStyle).not.toBeUndefined()
    document.body.removeChild(el)
  })
})

describe('parseContent', () => {
  it('parses CSS content correctly', () => {
    expect(parseContent('"★"')).toBe('★')
    expect(parseContent('\\2605')).toBe('★')
  })
})

describe('parseContent edge cases', () => {
  it('returns \u0000 if parseInt fails (not hex)', () => {
    expect(parseContent('\\nothex')).toBe('\u0000')
  })
  it('returns clean if String.fromCharCode throws', () => {
    const orig = String.fromCharCode
    String.fromCharCode = () => { throw new Error('fail') }
    expect(parseContent('\\2605')).toBe('\\2605')
    String.fromCharCode = orig
  })
})

describe('snapshotComputedStyle', () => {
  it('returns a style snapshot', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const style = getComputedStyle(el)
    const snap = snapshotComputedStyle(style)
    expect(typeof snap).toBe('object')
    document.body.removeChild(el)
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

describe('shouldIgnoreProp (#348)', () => {
  it('ignores CSS custom properties (--*)', () => {
    expect(shouldIgnoreProp('--my-var')).toBe(true)
    expect(shouldIgnoreProp('--theme-color')).toBe(true)
  })
  it('does not ignore paint-affecting props', () => {
    expect(shouldIgnoreProp('color')).toBe(false)
    expect(shouldIgnoreProp('background-color')).toBe(false)
  })
  // #369: CSS zoom — getComputedStyle() already returns post-zoom layout values for
  // width/height, so capturing zoom in the class would double-zoom elements inside
  // SVG foreignObject → blank sections. zoom must be excluded from the snapshot.
  it('ignores zoom (#369)', () => {
    expect(shouldIgnoreProp('zoom')).toBe(true)
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

describe('splitBackgroundImage', () => {
  it('returns a single layer unchanged', () => {
    expect(splitBackgroundImage('url(a.png)')).toEqual(['url(a.png)'])
  })

  it('splits top-level layers but keeps commas inside functions intact', () => {
    const bg = 'url(a.png), linear-gradient(90deg, red, blue)'
    const parts = splitBackgroundImage(bg)
    expect(parts).toEqual(['url(a.png)', 'linear-gradient(90deg, red, blue)'])
  })

  it('handles nested parentheses across several layers', () => {
    const bg = 'linear-gradient(rgba(0,0,0,0.5), rgba(255,255,255,0.2)), url(b.png)'
    const parts = splitBackgroundImage(bg)
    expect(parts).toHaveLength(2)
    expect(parts[1]).toBe('url(b.png)')
  })
})

describe('getStyleKey – width softening (#429/#434/#436)', () => {
  it('returns "" for tags that must not produce a class', () => {
    expect(getStyleKey({ display: 'block' }, 'path')).toBe('')
  })

  it('nudges a fractional frozen width past the serialization error for non-softened tags', () => {
    // block div is never softened → width is frozen, and a sub-pixel value gains the epsilon that
    // clears the ≤0.0005px computed-style rounding error. Kept at 1/1000 on purpose (#491): a
    // coarser bump is paid by every box in an inline row but only once by the parent holding them.
    const key = getStyleKey({ display: 'block', width: '100.03px' }, 'div')
    expect(key).toContain('width:100.031px') // ceil((100.03 + 0.001) * 1000) / 1000
  })

  it('drops the used width and synthesizes a min-width floor for a table cell', () => {
    const key = getStyleKey({ display: 'table-cell', width: '113.484px' }, 'td')
    expect(key).toContain('min-width:113.484px')
    expect(key).not.toMatch(/(^|;)width:/) // the hard used width longhand must not be frozen
  })

  it('keeps an authored min-width verbatim and suppresses the synthesized floor', () => {
    const key = getStyleKey({ display: 'table-cell', 'min-width': '50px', width: '80px' }, 'td')
    expect(key).toContain('min-width:50px')
    expect(key.match(/min-width:/g)).toHaveLength(1) // no duplicate synthesized floor
  })

  it('never synthesizes a floor for a flex/grid item (#406)', () => {
    const key = getStyleKey({ display: 'table-cell', width: '80px' }, 'td', true, true)
    expect(key).not.toContain('min-width')
  })

  it('keeps the width verbatim when the box is NOT sized by content (#433)', () => {
    // inline-block span sized by a CSS class → width must be preserved, not softened.
    const key = getStyleKey({ display: 'inline-block', width: '80px' }, 'span', false)
    expect(key).toContain('width:80px')
  })
})

// Computed-style enumeration lists both the physical and the logical form of every box
// property, so the generated class re-stated most of a box twice. A logical declaration is
// dropped only when it says exactly what its physical twin already says.
describe('getStyleKey — redundant logical properties (element-mirror import)', () => {
  it('drops a logical longhand that duplicates its physical twin', () => {
    const key = getStyleKey({
      display: 'block',
      width: '200px', 'inline-size': '200px',
      height: '80px', 'block-size': '80px',
      'padding-left': '12px', 'padding-inline-start': '12px',
      'border-top-width': '1px', 'border-block-start-width': '1px',
    }, 'div')
    expect(key).toContain('width:200px')
    expect(key).toContain('height:80px')
    expect(key).not.toContain('inline-size')
    expect(key).not.toContain('block-size')
    expect(key).not.toContain('padding-inline-start')
    expect(key).not.toContain('border-block-start-width')
  })

  it('keeps a logical longhand whose value differs from the physical one', () => {
    // Chrome resolves min-width:auto to 0px while min-inline-size still reports auto: the
    // logical declaration is load-bearing there and dropping it changed flex/grid layout.
    const key = getStyleKey({ display: 'flex', 'min-width': '0px', 'min-inline-size': 'auto' }, 'div')
    expect(key).toContain('min-inline-size:auto')
  })

  it('keeps logical properties outside horizontal-tb LTR, where they do not map', () => {
    const vertical = getStyleKey({
      display: 'block', 'writing-mode': 'vertical-rl',
      width: '200px', 'inline-size': '200px',
    }, 'div')
    expect(vertical).toContain('inline-size:200px')

    const rtl = getStyleKey({
      display: 'block', direction: 'rtl',
      'padding-left': '12px', 'padding-inline-start': '12px',
    }, 'div')
    expect(rtl).toContain('padding-inline-start:12px')
  })
})
