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
    font: cache.font,
    session_styleMap: cache.session.styleMap,
    session_styleCache: cache.session.styleCache,
    session_nodeMap: cache.session.nodeMap,
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
  cache.font.add('Inter__400')
  cache.session.styleMap.set('x', 'y')
  cache.session.styleCache.set({}, { sc: 1 })
  cache.session.nodeMap.set({}, document.createElement('div'))
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
    cache.font = new Set()
    cache.session.styleMap = new Map()
    cache.session.styleCache = new WeakMap()
    cache.session.nodeMap = new Map()
  })

  it('any non-disabled policy: fresh session bucket, persistent caches kept', () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('auto') // legacy string — same structural behavior

    const after = snapshotRefs()
    expect(after.session_styleMap).not.toBe(before.session_styleMap)
    expect(after.session_nodeMap).not.toBe(before.session_nodeMap)
    expect(after.session_styleCache).not.toBe(before.session_styleCache)
    expect(after.image).toBe(before.image)
    expect(after.background).toBe(before.background)
    expect(after.resource).toBe(before.resource)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.computedStyle).toBe(before.computedStyle)
    expect(after.font).toBe(before.font)

    // Nuevos maps están vacíos
    expect(cache.session.styleMap.size).toBe(0)
    expect(cache.session.nodeMap.size).toBe(0)
  })

  it('soft: resets toda la sesión (styleMap, nodeMap, styleCache) y deja globales', () => {
    seedSomeData()
    const before = snapshotRefs()

    applyCachePolicy('soft')

    const after = snapshotRefs()
    // Reemplaza los tres de sesión
    expect(after.session_styleMap).not.toBe(before.session_styleMap)
    expect(after.session_nodeMap).not.toBe(before.session_nodeMap)
    expect(after.session_styleCache).not.toBe(before.session_styleCache)

    // Globales se mantienen (misma identidad)
    expect(after.image).toBe(before.image)
    expect(after.background).toBe(before.background)
    expect(after.resource).toBe(before.resource)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.computedStyle).toBe(before.computedStyle)
    expect(after.font).toBe(before.font)

    // Sesión está vacía
    expect(cache.session.styleMap.size).toBe(0)
    expect(cache.session.nodeMap.size).toBe(0)
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
    expect(after.font).toBe(before.font)
    // …but the session bucket is per-capture now, never shared across captures
    // (the old 'full' sharing is the state class the session refactor eliminated).
    expect(after.session_styleMap).not.toBe(before.session_styleMap)
    expect(after.session_styleCache).not.toBe(before.session_styleCache)
    expect(after.session_nodeMap).not.toBe(before.session_nodeMap)
  })

  it('disabled: reinstancia TODO (global + sesión) y deja todo vacío', () => {
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
    expect(after.font).not.toBe(before.font)
    expect(after.session_styleMap).not.toBe(before.session_styleMap)
    expect(after.session_styleCache).not.toBe(before.session_styleCache)
    expect(after.session_nodeMap).not.toBe(before.session_nodeMap)

    // Vacíos
    expect(cache.image.size).toBe(0)
    expect(cache.background.size).toBe(0)
    expect(cache.resource.size).toBe(0)
    expect(cache.defaultStyle.size).toBe(0)
    expect(cache.baseStyle.size).toBe(0)
    expect(cache.font.size).toBe(0)
    expect(cache.session.styleMap.size).toBe(0)
    expect(cache.session.nodeMap.size).toBe(0)
  })

  it('default (input desconocido): cae en soft', () => {
    seedSomeData()
    const before = snapshotRefs()

    // Política inexistente provoca rama default → soft
    applyCachePolicy('unknown-policy')

    const after = snapshotRefs()
    // Reemplaza los de sesión
    expect(after.session_styleMap).not.toBe(before.session_styleMap)
    expect(after.session_nodeMap).not.toBe(before.session_nodeMap)
    expect(after.session_styleCache).not.toBe(before.session_styleCache)
    // Mantiene globales
    expect(after.image).toBe(before.image)
    expect(after.baseStyle).toBe(before.baseStyle)
    expect(after.defaultStyle).toBe(before.defaultStyle)
    expect(after.computedStyle).toBe(before.computedStyle)
    expect(after.font).toBe(before.font)
  })
})
