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
    expect(res.top).toBe(5)
  })
})

describe('parseOutline', () => {
  it('returns zeros for none', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const cs = getComputedStyle(div)
    expect(parseOutline(cs)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
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
})

describe('matrixFromComputed', () => {
  it('returns identity for none', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const M = matrixFromComputed(div)
    expect(M.a).toBe(1)
    expect(M.d).toBe(1)
  })
})

describe('bboxWithOriginFull', () => {
  it('computes bbox with transform', () => {
    const M = new DOMMatrix()
    const res = bboxWithOriginFull(100, 50, M, 0, 0)
    expect(res.width).toBe(100)
    expect(res.height).toBe(50)
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
})
