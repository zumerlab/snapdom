// __tests__/module.iconFonts.more.test.js – extend iconFonts coverage (34% → higher)
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mod

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  mod = await import('../src/modules/iconFonts.js')
})

describe('isMaterialFamily', () => {
  it('returns true for "Material Icons"', () => {
    expect(mod.isMaterialFamily('Material Icons')).toBe(true)
  })
  it('returns true for "Material Symbols"', () => {
    expect(mod.isMaterialFamily('Material Symbols')).toBe(true)
  })
  it('returns false for non-Material fonts', () => {
    expect(mod.isMaterialFamily('Arial')).toBe(false)
    expect(mod.isMaterialFamily('Font Awesome')).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(mod.isMaterialFamily('material icons')).toBe(true)
    expect(mod.isMaterialFamily('MATERIAL SYMBOLS')).toBe(true)
  })
})

describe('isIconFont heuristics', () => {
  it('matches icon, glyph, symbols, feather, fontawesome (fallback heuristics)', () => {
    const { isIconFont } = mod
    expect(isIconFont('My Icon Pack')).toBe(true)
    expect(isIconFont('Glyph Set')).toBe(true)
    expect(isIconFont('Symbols font')).toBe(true)
    expect(isIconFont('Feather icons')).toBe(true)
    expect(isIconFont('FontAwesome free')).toBe(true)
  })
})

describe('materialIconToImage', () => {
  it('returns object with dataUrl, width, height', async () => {
    const out = await mod.materialIconToImage('home', { fontSize: 24 })
    expect(out).toBeDefined()
    expect(out.dataUrl).toMatch(/^data:image\//)
    expect(typeof out.width).toBe('number')
    expect(typeof out.height).toBe('number')
  })
})
