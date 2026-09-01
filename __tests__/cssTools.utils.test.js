import { describe, it, expect } from 'vitest'
import { getStyleKey, collectUsedTagNames, getDefaultStyleForTag } from '../src/utils'

// The getStyleKey describe that lived here named a 'compress' parameter v3 does not have and
// asserted only typeof string; the real getStyleKey behavior is pinned in utils.css.test.js.

describe('collectUsedTagNames', () => {
  it('returns unique tag names', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span></span><p></p><span></span>'
    const tags = collectUsedTagNames(root)
    expect(tags).toContain('div')
    expect(tags).toContain('span')
    expect(tags).toContain('p')
  })
})

describe('getDefaultStyleForTag', () => {
  it('returns a default style object', () => {
    const defaults = getDefaultStyleForTag('div')
    expect(typeof defaults).toBe('object')
  })

  it('getDefaultStyleForTag skips special tags', () => {
    expect(getDefaultStyleForTag('script')).toEqual({})
  })
})
