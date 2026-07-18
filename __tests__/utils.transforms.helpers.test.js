// __tests__/utils.transforms.helpers.test.js – transforms.helpers.js coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseBoxShadow,
  parseFilterBlur,
  parseOutline,
  parseFilterDropShadows,
  normalizeRootTransforms,
  parseTransformOriginPx,
  readIndividualTransforms,
  readTotalTransformMatrix,
  hasBBoxAffectingTransform,
  matrixFromComputed,
  bboxWithOriginFull
} from '../src/utils/transforms.helpers.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('parseBoxShadow', () => {
  it('returns zeros for none', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    const res = parseBoxShadow(cs)
    expect(res).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('calculates bleed for box-shadow', () => {
    const div = document.createElement('div')
    div.style.boxShadow = '10px 5px 3px 2px rgba(0,0,0,0.5)'
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    const res = parseBoxShadow(cs)
    expect(res.top).toBeGreaterThanOrEqual(0)
    expect(res.right).toBeGreaterThanOrEqual(0)
  })

  it('ignores inset shadows (no outer bleed)', () => {
    const div = document.createElement('div')
    div.style.boxShadow = 'inset 10px 10px 5px 2px rgba(0,0,0,0.5)'
    document.body.appendChild(div)
    const res = parseBoxShadow(getComputedStyle(div))
    expect(res).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('counts only the outer layer when mixed with an inset layer', () => {
    const div = document.createElement('div')
    div.style.boxShadow = 'inset 0 0 40px red, 6px 6px 0 0 blue'
    document.body.appendChild(div)
    const res = parseBoxShadow(getComputedStyle(div))
    // The inset 40px blur must not leak into the bleed (the bug counted it everywhere);
    // only the 6px outer layer contributes — right/bottom = |6|+6 = 12, all sides << 40.
    expect(res.right).toBe(12)
    expect(res.bottom).toBe(12)
    expect(res.top).toBeLessThanOrEqual(12)
    expect(res.left).toBeLessThanOrEqual(12)
  })
})

describe('parseFilterBlur', () => {
  it('returns zeros for no blur', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    expect(parseFilterBlur(cs)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('parses blur() value', () => {
    const div = document.createElement('div')
    div.style.filter = 'blur(5px)'
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    const res = parseFilterBlur(cs)
    // Also guards against double-counting when the engine mirrors filter into webkitFilter.
    expect(res.top).toBe(5)
  })

  it('sums multiple blur() in the chain (combined spread)', () => {
    const div = document.createElement('div')
    div.style.filter = 'blur(2px) blur(3px)'
    document.body.appendChild(div)
    const res = parseFilterBlur(getComputedStyle(div))
    expect(res).toEqual({ top: 5, right: 5, bottom: 5, left: 5 })
  })
})

describe('parseOutline', () => {
  it('returns zeros for none', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    expect(parseOutline(cs)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('returns outline width for solid outline with no offset', () => {
    const cs = { outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '0px' }
    const res = parseOutline(cs)
    expect(res).toEqual({ top: 3, right: 3, bottom: 3, left: 3 })
  })

  it('adds positive outline-offset to bleed (NEW-3)', () => {
    const cs = { outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '4px' }
    const res = parseOutline(cs)
    // total = ceil(2) + max(0, ceil(4)) = 2 + 4 = 6
    expect(res).toEqual({ top: 6, right: 6, bottom: 6, left: 6 })
  })

  it('does not subtract for negative outline-offset (NEW-3)', () => {
    const cs = { outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '-2px' }
    const res = parseOutline(cs)
    // negative offset never reduces bleed below outline width
    expect(res).toEqual({ top: 3, right: 3, bottom: 3, left: 3 })
  })
})

describe('parseFilterDropShadows', () => {
  it('returns has:false for empty', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    expect(parseFilterDropShadows(cs).has).toBe(false)
  })

  it('parses drop-shadow', () => {
    const div = document.createElement('div')
    div.style.filter = 'drop-shadow(2px 3px 4px black)'
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    const res = parseFilterDropShadows(cs)
    expect(res.has).toBe(true)
    expect(res.bleed.top).toBeGreaterThanOrEqual(0)
  })
})

describe('parseTransformOriginPx', () => {
  it('parses left/top as 0', () => {
    const div = document.createElement('div')
    div.style.transformOrigin = 'left top'
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    const res = parseTransformOriginPx(cs, 100, 50)
    expect(res.ox).toBe(0)
    expect(res.oy).toBe(0)
  })

  it('parses center as half size (mock cs with keywords)', () => {
    const cs = { transformOrigin: 'center center' }
    const res = parseTransformOriginPx(cs, 100, 50)
    expect(res.ox).toBe(50)
    expect(res.oy).toBe(25)
  })

  it('parses right/bottom as full size (mock cs)', () => {
    const cs = { transformOrigin: 'right bottom' }
    const res = parseTransformOriginPx(cs, 100, 50)
    expect(res.ox).toBe(100)
    expect(res.oy).toBe(50)
  })

  it('parses percentage (mock cs)', () => {
    const cs = { transformOrigin: '50% 25%' }
    const res = parseTransformOriginPx(cs, 100, 100)
    expect(res.ox).toBe(50)
    expect(res.oy).toBe(25)
  })

  it('parses explicit px lengths (mock cs)', () => {
    const res = parseTransformOriginPx({ transformOrigin: '30px 12px' }, 100, 50)
    expect(res.ox).toBe(30)
    expect(res.oy).toBe(12)
  })

  it('parses unitless numbers as px (mock cs)', () => {
    const res = parseTransformOriginPx({ transformOrigin: '15 -8' }, 100, 50)
    expect(res.ox).toBe(15)
    expect(res.oy).toBe(-8)
  })

  it('falls back to 0 for unrecognized tokens (mock cs)', () => {
    const res = parseTransformOriginPx({ transformOrigin: 'foo bar' }, 100, 50)
    expect(res.ox).toBe(0)
    expect(res.oy).toBe(0)
  })

  it('defaults the second axis to the first token (missing oy)', () => {
    const res = parseTransformOriginPx({ transformOrigin: 'left' }, 100, 50)
    expect(res.ox).toBe(0)
    expect(res.oy).toBe(0)
  })
})

describe('readIndividualTransforms', () => {
  it('returns legacy path when no Typed OM', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const res = readIndividualTransforms(div)
    expect(res.rotate).toBeDefined()
    expect(res).toHaveProperty('scale')
    expect(res).toHaveProperty('translate')
  })

  it('reads a uniform rotate/scale through the Typed OM path', () => {
    // This Chromium returns generic CSSStyleValue objects, so the reader coerces via String/Number:
    // uniform scale and rotate resolve correctly (two-axis scale is not representable this way).
    const div = document.createElement('div')
    div.style.rotate = '45deg'
    div.style.scale = '2'
    document.body.appendChild(div)
    const res = readIndividualTransforms(div)
    expect(res.rotate).toBe('45deg')
    expect(['2 2', '2']).toContain(res.scale) // Gecko serializa scale uniforme como '2'
  })

  it('falls back to the legacy string path when computedStyleMap is unavailable', () => {
    const div = document.createElement('div')
    div.style.rotate = '30deg'
    div.style.scale = '2'
    div.style.translate = '5px 6px'
    document.body.appendChild(div)
    // Shadow the prototype method so the Typed OM branch is skipped.
    Object.defineProperty(div, 'computedStyleMap', { value: undefined, configurable: true })
    const res = readIndividualTransforms(div)
    expect(res.rotate).toBe('30deg')
    expect(res.scale).toBe('2')
    expect(res.translate).toBe('5px 6px')
  })
})

describe('readTotalTransformMatrix', () => {
  it('returns identity for empty transform', () => {
    const M = readTotalTransformMatrix({})
    expect(M.a).toBe(1)
    expect(M.d).toBe(1)
  })

  it('applies baseTransform when provided', () => {
    const M = readTotalTransformMatrix({ baseTransform: 'translate(10px, 0)' })
    expect(M.e).toBe(10)
  })
})

describe('parseFilterBlur – webkit fallback', () => {
  it('reads -webkit-filter when the standard filter is none (mock cs)', () => {
    const res = parseFilterBlur({ filter: 'none', webkitFilter: 'blur(4px)' })
    expect(res).toEqual({ top: 4, right: 4, bottom: 4, left: 4 })
  })
})

describe('parseFilterDropShadows – multiple shadows', () => {
  it('takes the max extent across several drop-shadows', () => {
    const res = parseFilterDropShadows({ filter: 'drop-shadow(2px 0px 1px black) drop-shadow(0px 8px 2px red)', webkitFilter: '' })
    expect(res.has).toBe(true)
    expect(res.bleed.bottom).toBeGreaterThanOrEqual(10) // |8| + 2
  })
})

describe('hasBBoxAffectingTransform', () => {
  it('returns false for no transform', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(hasBBoxAffectingTransform(div)).toBe(false)
  })

  it('returns true for translate', () => {
    const div = document.createElement('div')
    div.style.translate = '10px 0'
    document.body.appendChild(div)
    expect(hasBBoxAffectingTransform(div)).toBe(true)
  })

  it('returns true for a non-identity matrix transform', () => {
    const div = document.createElement('div')
    div.style.transform = 'scale(2)'
    document.body.appendChild(div)
    expect(hasBBoxAffectingTransform(div)).toBe(true)
  })

  it('returns true for an individual rotate', () => {
    const div = document.createElement('div')
    div.style.rotate = '45deg'
    document.body.appendChild(div)
    expect(hasBBoxAffectingTransform(div)).toBe(true)
  })

  it('returns false for an identity matrix', () => {
    const div = document.createElement('div')
    div.style.transform = 'matrix(1, 0, 0, 1, 0, 0)'
    document.body.appendChild(div)
    expect(hasBBoxAffectingTransform(div)).toBe(false)
  })
})

describe('matrixFromComputed', () => {
  it('returns identity for none', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const M = matrixFromComputed(div)
    expect(M.a).toBe(1)
    expect(M.d).toBe(1)
  })

  it('parses a real computed transform into a DOMMatrix', () => {
    const div = document.createElement('div')
    div.style.transform = 'scale(2)'
    document.body.appendChild(div)
    const M = matrixFromComputed(div)
    expect(M.a).toBe(2)
    expect(M.d).toBe(2)
  })
})

describe('bboxWithOriginFull', () => {
  it('computes bbox with transform', () => {
    const M = new DOMMatrix()
    const res = bboxWithOriginFull(100, 50, M, 0, 0)
    expect(res.width).toBe(100)
    expect(res.height).toBe(50)
  })

  it('swaps extents under a 90° rotation about the origin', () => {
    const M = new DOMMatrix().rotate(90)
    const res = bboxWithOriginFull(100, 50, M, 0, 0)
    expect(res.width).toBeCloseTo(50, 5)
    expect(res.height).toBeCloseTo(100, 5)
  })

  it('applies the matrix translation (e/f) to the bbox origin', () => {
    const M = new DOMMatrix([1, 0, 0, 1, 5, 7]) // a,b,c,d,e,f
    const res = bboxWithOriginFull(10, 10, M, 2, 3)
    expect(res.minX).toBeCloseTo(5, 5)
    expect(res.minY).toBeCloseTo(7, 5)
  })
})

describe('normalizeRootTransforms', () => {
  it('returns null for null roots', () => {
    const clone = document.createElement('div')
    expect(normalizeRootTransforms(null, clone)).toBeNull()
    expect(normalizeRootTransforms(document.createElement('div'), null)).toBeNull()
  })

  it('handles transform:none identity', () => {
    const orig = document.createElement('div')
    const clone = document.createElement('div')
    document.body.appendChild(orig)
    const res = normalizeRootTransforms(orig, clone)
    expect(res).toEqual({ a: 1, b: 0, c: 0, d: 1 })
  })

  it('handles 2D matrix', () => {
    const orig = document.createElement('div')
    orig.style.transform = 'matrix(2, 0, 0, 2, 10, 20)'
    const clone = document.createElement('div')
    document.body.appendChild(orig)
    const res = normalizeRootTransforms(orig, clone)
    expect(res).not.toBeNull()
    expect(res.a).toBe(2)
  })

  it('captures the individual `scale` property when transform is none', () => {
    const orig = document.createElement('div')
    orig.style.scale = '2'           // individual property, NOT transform
    const clone = document.createElement('div')
    document.body.appendChild(orig)
    const res = normalizeRootTransforms(orig, clone)
    // The viewBox must expand by the scale, otherwise the scaled clone gets clipped.
    expect(res).not.toBeNull()
    expect(res.a).toBeCloseTo(2, 5)
    expect(res.d).toBeCloseTo(2, 5)
  })

  it('decomposes a matrix3d transform, keeping scale and dropping translate/rotation', () => {
    const orig = document.createElement('div')
    // A real 3D rotation forces the computed value to serialize as matrix3d(...).
    orig.style.transform = 'rotateY(45deg) scale(2)'
    const clone = document.createElement('div')
    document.body.appendChild(orig)
    const res = normalizeRootTransforms(orig, clone)
    expect(res).not.toBeNull()
    expect(res.b).toBe(0) // rotation removed
    expect(res.a).toBeGreaterThan(0)
    // the clone's transform is rewritten to a pure 2D matrix with no translation
    expect(clone.style.transform.startsWith('matrix(')).toBe(true)
  })
})
