// __tests__/module.iconFonts.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mod // set in beforeEach so the module state resets

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules() // importante para resetear userIconFonts
  mod = await import('../src/modules/iconFonts.js') // ESM dynamic import
})

describe('compileIconFontMatchers (per-capture matchers)', () => {
  it('acepta string y lo convierte a RegExp (case-insensitive)', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    const m = compileIconFontMatchers('acme-brand')
    expect(isIconFont('ACME-BRAND pack', m)).toBe(true)
    // control: something without the pattern must not match, nor fall into the heuristic
    expect(isIconFont('qwerty', m)).toBe(false)
  })

  it('acepta RegExp', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    const m = compileIconFontMatchers(/brandx/i)
    expect(isIconFont('This is BrAnDx kit', m)).toBe(true)
    expect(isIconFont('no-match-here', m)).toBe(false)
  })

  it('acepta arrays mezclando strings y RegExp', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    const m = compileIconFontMatchers(['foo-lib', /bar-pkg/i])
    expect(isIconFont('FOO-LIB icons', m)).toBe(true)
    expect(isIconFont('BAR-PKG family', m)).toBe(true)
    expect(isIconFont('none', m)).toBe(false)
  })

  it('sin matchers, solo aplican los defaults: nada se filtra entre capturas', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    const withOption = compileIconFontMatchers('leaky-brand')
    expect(isIconFont('LEAKY-BRAND set', withOption)).toBe(true)
    // A later capture that never passed the option gets its own (empty) list.
    expect(isIconFont('LEAKY-BRAND set', compileIconFontMatchers(undefined))).toBe(false)
    expect(isIconFont('LEAKY-BRAND set')).toBe(false)
  })

  it('dos capturas concurrentes no se pisan los matchers', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    // The module-level list this replaced was overwritten at every capture start, so a
    // second capture starting mid-flight made the first one read ITS list from that point
    // on. Compiled lists are values: interleaving cannot mix them.
    const a = compileIconFontMatchers('capture-a-brand')
    const b = compileIconFontMatchers('capture-b-brand')
    expect(isIconFont('CAPTURE-A-BRAND', a)).toBe(true)
    expect(isIconFont('CAPTURE-A-BRAND', b)).toBe(false)
    expect(isIconFont('CAPTURE-B-BRAND', b)).toBe(true)
    expect(isIconFont('CAPTURE-B-BRAND', a)).toBe(false)
  })

  it('ignores invalid values and warns on the console', () => {
    const { compileIconFontMatchers, isIconFont } = mod
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = compileIconFontMatchers([123, { nope: true }])
    expect(warn).toHaveBeenCalled()
    expect(m).toEqual([])
    expect(isIconFont('qwerty', m)).toBe(false)
    warn.mockRestore()
  })
})

describe('isIconFont (defaults)', () => {
  it('reconoce patrones por default (e.g., Font Awesome)', () => {
    const { isIconFont } = mod
    expect(isIconFont('Font Awesome 6 Pro')).toBe(true) // match por defaultIconFonts
  })
})

describe('ligatureIconToImage source pairing (#6)', () => {
  it('reads styles from the nodeMap-mapped source, not the positional index', async () => {
    const { ligatureIconToImage } = mod

    // Source: two material icons with distinct font-sizes.
    const source = document.createElement('div')
    const s1 = document.createElement('span')
    s1.className = 'material-icons'; s1.style.fontFamily = 'Material Icons'; s1.style.fontSize = '99px'; s1.textContent = 'home'
    const s2 = document.createElement('span')
    s2.className = 'material-icons'; s2.style.fontFamily = 'Material Icons'; s2.style.fontSize = '24px'; s2.textContent = 'star'
    source.append(s1, s2)
    document.body.appendChild(source)

    // Clone: the first icon was dropped (excludeMode:'remove'); only the second survives, so a
    // positional pairing would wrongly read s1 (99px) for it.
    const clone = document.createElement('div')
    const c2 = document.createElement('span')
    c2.className = 'material-icons'; c2.textContent = 'star'
    clone.appendChild(c2)
    document.body.appendChild(clone)

    await ligatureIconToImage(clone, source, new Map([[c2, s2]]))

    const img = c2.querySelector('img')
    expect(img).toBeTruthy()
    // Height derives from the mapped source's font-size (24), not index-0's (99).
    expect(img.style.height).toBe('24px')

    source.remove()
    clone.remove()
  })

  // Bug-hunt finding: querySelectorAll never matches the element it's called on, so
  // capturing a Material icon directly as root (snapdom(iconSpan)) left its ligature text
  // ("home") unconverted — the raster showed literal text (or tofu) instead of the icon glyph.
  it('converts the ligature when the icon itself is the root (not just a descendant)', async () => {
    const { ligatureIconToImage } = mod

    const source = document.createElement('span')
    source.className = 'material-icons'
    source.style.fontFamily = 'Material Icons'
    source.style.fontSize = '40px'
    source.textContent = 'home'
    document.body.appendChild(source)

    const clone = source.cloneNode(true)
    document.body.appendChild(clone)

    const replaced = await ligatureIconToImage(clone, source, new Map([[clone, source]]))

    expect(replaced).toBe(1)
    const img = clone.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.style.height).toBe('40px')
    expect(clone.textContent.trim()).toBe('')

    source.remove()
    clone.remove()
  })
})
