import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createContext } from '../src/core/context.js'

let originalDPR

beforeEach(() => {
  originalDPR = window.devicePixelRatio
  // Make DPR writable for the test
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 2,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: originalDPR ?? 1,
  })
})

describe('createContext - defaults & normalization', () => {
  it('returns sensible defaults when called without options', () => {
    const ctx = createContext()

    expect(ctx.debug).toBe(false)
    expect(ctx.fast).toBe(true)
    expect(ctx.scale).toBe(1)

    expect(Array.isArray(ctx.exclude)).toBe(true)
    expect(ctx.exclude.length).toBe(0)
    expect(ctx.filter).toBeNull()

    expect(ctx.embedFonts).toBe(false)
    expect(Array.isArray(ctx.iconFonts)).toBe(true)
    expect(ctx.iconFonts.length).toBe(0)
    expect(Array.isArray(ctx.localFonts)).toBe(true)
    expect(ctx.localFonts.length).toBe(0)
    expect(ctx.excludeFonts).toBeUndefined()

    // reset defaults to 'soft'
    expect(ctx.cache).toBe('soft')

    // network / output
    expect(ctx.useProxy).toBe('')
    expect(ctx.width).toBeNull()
    expect(ctx.height).toBeNull()
    expect(ctx.format).toBe('png')
    expect(ctx.type).toBe('svg')
    expect(ctx.quality).toBeCloseTo(0.92)
    expect(ctx.dpr).toBe(2) // from mocked devicePixelRatio
    // PNG → no default background color
    expect(ctx.backgroundColor).toBeNull()
    expect(ctx.filename).toBe('snapDOM')
  })

  it('normalizes iconFonts input (string → array, array stays, falsy → empty array)', () => {
    expect(createContext({ iconFonts: 'FA' }).iconFonts).toEqual(['FA'])
    expect(createContext({ iconFonts: ['A', 'B'] }).iconFonts).toEqual(['A', 'B'])
    expect(createContext({ iconFonts: null }).iconFonts).toEqual([])
    expect(createContext({}).iconFonts).toEqual([])
  })

  it('normalizes localFonts (array only; non-array → empty array)', () => {
    const arr = [{ family: 'X', src: 'data:...' }]
    expect(createContext({ localFonts: arr }).localFonts).toBe(arr)
    expect(createContext({ localFonts: { family: 'X' } }).localFonts).toEqual([])
    expect(createContext({}).localFonts).toEqual([])
  })

  it('passes through excludeFonts when provided, otherwise leaves undefined', () => {
    const ex = { families: ['Foo'], domains: ['bar.com'], subsets: ['latin'] }
    expect(createContext({ excludeFonts: ex }).excludeFonts).toBe(ex)
    expect(createContext({}).excludeFonts).toBeUndefined()
  })

  it('normalizes cache option: soft|full|disabled|auto or defaults to soft when invalid', () => {
    expect(createContext({ cache: 'soft' }).cache).toBe('soft')
    expect(createContext({ cache: 'full' }).cache).toBe('full')
    expect(createContext({ cache: 'auto' }).cache).toBe('auto')
    expect(createContext({ cache: 'disabled' }).cache).toBe('disabled')
    // invalid → soft
    expect(createContext({ cache: 'weird' }).cache).toBe('soft')
    expect(createContext({ cache: 123 }).cache).toBe('soft')
  })

  it('sets useProxy only when it is a string; otherwise empty string', () => {
    expect(createContext({ useProxy: 'https://p/' }).useProxy).toBe('https://p/')
    expect(createContext({ useProxy: 123 }).useProxy).toBe('')
    expect(createContext({}).useProxy).toBe('')
  })

  it('uses provided dpr when present; otherwise window.devicePixelRatio || 1', () => {
    expect(createContext({ dpr: 3 }).dpr).toBe(3)

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.5,
    })
    expect(createContext({}).dpr).toBe(1.5)

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: undefined,
    })
    expect(createContext({}).dpr).toBe(1)
  })

  it('computes default backgroundColor by format, and allows override', () => {
    // webp → default white bg
    let ctx = createContext({ format: 'webp' })
    expect(ctx.backgroundColor).toBe('#ffffff')

    // jpg → default white bg
    ctx = createContext({ format: 'jpg' })
    expect(ctx.backgroundColor).toBe('#ffffff')

    // jpeg → default white bg
    ctx = createContext({ format: 'jpeg' })
    expect(ctx.backgroundColor).toBe('#ffffff')

    // png → null bg by default
    ctx = createContext({ format: 'png' })
    expect(ctx.backgroundColor).toBeNull()

    // explicit override wins, regardless of format
    ctx = createContext({ format: 'jpg', backgroundColor: '#000' })
    expect(ctx.backgroundColor).toBe('#000')
  })

  it('resolves format via resolvedFormat and keeps other output options', () => {
    const ctx = createContext({
      format: 'webp',
      type: 'svg',
      width: 800,
      height: 600,
      quality: 0.8,
      filename: 'custom',
      debug: true,
      fast: false,
      scale: 2,
    })

    expect(ctx.format).toBe('webp')
    expect(ctx.type).toBe('svg')
    expect(ctx.width).toBe(800)
    expect(ctx.height).toBe(600)
    expect(ctx.quality).toBeCloseTo(0.8)
    expect(ctx.filename).toBe('custom')
    expect(ctx.debug).toBe(true)
    expect(ctx.fast).toBe(false)
    expect(ctx.scale).toBe(2)
  })
})
