import { describe, it, expect } from 'vitest'
import { getStyle, _invalidateSplitCaches } from '../src/utils/css.js'

describe('css split caches — epoch invalidation guard (§8)', () => {
  it('emptyStyle singleton is frozen (mutation would corrupt singleton)', () => {
    const s1 = getStyle(document.createElement('div'))
    // getStyle for element with no nodeType returns emptyStyle
    const empty = getStyle(null)
    expect(Object.isFrozen(empty)).toBe(true)
  })
  it('_invalidateSplitCaches exists and is callable', () => {
    expect(typeof _invalidateSplitCaches).toBe('function')
    expect(() => _invalidateSplitCaches()).not.toThrow()
  })
  it('getStyle returns fresh after invalidation', () => {
    const el = document.createElement('div')
    el.style.color = 'rgb(255, 0, 0)'
    document.body.appendChild(el)
    const c1 = getStyle(el).color
    _invalidateSplitCaches()
    el.style.color = 'rgb(0, 0, 255)'
    const c2 = getStyle(el).color
    // After invalidation, should reflect new color, not stale
    expect(c2).toBe('rgb(0, 0, 255)')
    el.remove()
  })
})
