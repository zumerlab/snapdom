// __tests__/core.cache.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { cache, normalizeCachePolicy, applyCachePolicy } from '../src/core/cache.js'

/**
 * Snapshot helpers to assert identity changes.
 */
function snapshotRefs() {
  return {
    image: cache.image,
    background: cache.background,
    resource: cache.resource,
    defaultStyle: cache.defaultStyle,
    baseStyle: cache.baseStyle,
    computedStyle: cache.computedStyle,
    measureHints: cache.measureHints,
  }
}

function seedSomeData() {
  cache.image.set('k', 1)
  cache.background.set('b', 2)
  cache.resource.set('r', 3)
  cache.defaultStyle.set('d', 4)
  cache.baseStyle.set('bs', 5)
  cache.computedStyle.set({}, { c: 6 })
  cache.measureHints.set({}, { cssLen: 1, w0: 2, csh: 3, csw: 4 })
}

describe('normalizeCachePolicy', () => {
  it('maps booleans and known strings, defaults to "soft"', () => {
    expect(normalizeCachePolicy(true)).toBe('soft')
    expect(normalizeCachePolicy(false)).toBe('disabled')
    // Legacy strings collapse to the structural default — per-capture sessions plus
    // auto-burst/differential recapture superseded the old per-policy sharing.
    expect(normalizeCachePolicy('auto')).toBe('soft')
    expect(normalizeCachePolicy('full')).toBe('soft')
    expect(normalizeCachePolicy('soft')).toBe('soft')
    expect(normalizeCachePolicy('disabled')).toBe('disabled')
    // unknown → soft (default)
    expect(normalizeCachePolicy('weird')).toBe('soft')
    expect(normalizeCachePolicy(undefined)).toBe('soft')
    expect(normalizeCachePolicy(123)).toBe('soft')
  })
})

describe('applyCachePolicy', () => {
  beforeEach(() => {
    // Re-crear contenedores para que cada test sea independiente.
    cache.image = new Map()
    cache.background = new Map()
    cache.resource = new Map()
    cache.defaultStyle = new Map()
    cache.baseStyle = new Map()
    cache.computedStyle = new WeakMap()
    cache.measureHints = new WeakMap()
  })

  it('any non-disabled policy: persistent caches kept', () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('auto') // legacy string — same structural behavior

    const after = snapshotRefs()
    expect(after.image).toBe(before.image)
    expect(after.background).toBe(before.background)
    expect(after.resource).toBe(before.resource)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.computedStyle).toBe(before.computedStyle)

    // The new maps are empty
  })

  it('soft: leaves the global caches intact (the session is no longer global)', () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('soft')

    const after = snapshotRefs()

    // Globales se mantienen (misma identidad)
    expect(after.image).toBe(before.image)
    expect(after.background).toBe(before.background)
    expect(after.resource).toBe(before.resource)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.computedStyle).toBe(before.computedStyle)

    // The session is empty
  })

  it("legacy 'full': persistent caches kept, session bucket still fresh per capture", () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('full')

    const after = snapshotRefs()
    // Persistent caches survive…
    expect(after.image).toBe(before.image)
    expect(after.background).toBe(before.background)
    expect(after.resource).toBe(before.resource)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.computedStyle).toBe(before.computedStyle)
    // Sessions are per-capture by construction now (createCaptureSession) — there is
    // no shared session bucket left to assert on.
  })

  it('disabled: re-instantiates EVERYTHING (global + session) and leaves it empty', () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('disabled')

    const after = snapshotRefs()
    // Todo debe ser nuevo
    expect(after.image).not.toBe(before.image)
    expect(after.background).not.toBe(before.background)
    expect(after.resource).not.toBe(before.resource)
    expect(after.defaultStyle).not.toBe(before.defaultStyle)
    expect(after.baseStyle).not.toBe(before.baseStyle)
    expect(after.computedStyle).not.toBe(before.computedStyle)
    expect(after.measureHints).not.toBe(before.measureHints)

    // Empty
    expect(cache.image.size).toBe(0)
    expect(cache.background.size).toBe(0)
    expect(cache.resource.size).toBe(0)
    expect(cache.defaultStyle.size).toBe(0)
    expect(cache.baseStyle.size).toBe(0)
  })

  it('default (input desconocido): cae en soft', () => {
    seedSomeData()
    const before = snapshotRefs()

    // An unknown policy takes the default branch: soft
    applyCachePolicy('unknown-policy')

    const after = snapshotRefs()
    // Replaces the session ones
    // Mantiene globales
    expect(after.image).toBe(before.image)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.computedStyle).toBe(before.computedStyle)
  })
})
