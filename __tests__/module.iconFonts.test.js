// __tests__/module.iconFonts.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mod // se setea en beforeEach para resetear estado del módulo

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules() // importante para resetear userIconFonts
  mod = await import('../src/modules/iconFonts.js') // ESM dynamic import
})

describe('setSessionIconFonts (per-capture matchers)', () => {
  it('acepta string y lo convierte a RegExp (case-insensitive)', () => {
    const { setSessionIconFonts, isIconFont } = mod
    setSessionIconFonts('acme-brand')
    expect(isIconFont('ACME-BRAND pack')).toBe(true)
    // control: no matchea algo que no contenga el patrón y tampoco cae en la heurística
    expect(isIconFont('qwerty')).toBe(false)
  })

  it('acepta RegExp', () => {
    const { setSessionIconFonts, isIconFont } = mod
    setSessionIconFonts(/brandx/i)
    expect(isIconFont('This is BrAnDx kit')).toBe(true)
    expect(isIconFont('no-match-here')).toBe(false)
  })

  it('acepta arrays mezclando strings y RegExp', () => {
    const { setSessionIconFonts, isIconFont } = mod
    setSessionIconFonts(['foo-lib', /bar-pkg/i])
    expect(isIconFont('FOO-LIB icons')).toBe(true)
    expect(isIconFont('BAR-PKG family')).toBe(true)
    expect(isIconFont('none')).toBe(false)
  })

  it('REEMPLAZA la lista por captura — los matchers no se filtran a capturas posteriores', () => {
    const { setSessionIconFonts, isIconFont } = mod
    setSessionIconFonts('leaky-brand')
    expect(isIconFont('LEAKY-BRAND set')).toBe(true)
    // Next capture without the option: the previous matcher must be gone.
    setSessionIconFonts(undefined)
    expect(isIconFont('LEAKY-BRAND set')).toBe(false)
  })

  it('repeated per-capture registration cannot grow the list (replacement semantics)', () => {
    const { setSessionIconFonts, isIconFont } = mod
    setSessionIconFonts(['dup-brand', /dup-brand-rx/i])
    const spy1 = vi.spyOn(RegExp.prototype, 'test')
    isIconFont('nothing-matches-here')
    const callsAfterFirstRegistration = spy1.mock.calls.length
    spy1.mockRestore()

    // Every capture replaces the list, so re-registering the same option 49 times
    // (animation loop) leaves exactly the same candidate set.
    for (let i = 0; i < 49; i++) setSessionIconFonts(['dup-brand', /dup-brand-rx/i])

    const spy2 = vi.spyOn(RegExp.prototype, 'test')
    isIconFont('nothing-matches-here')
    const callsAfterRepeatedRegistration = spy2.mock.calls.length
    spy2.mockRestore()

    expect(callsAfterRepeatedRegistration).toBe(callsAfterFirstRegistration)
  })

  it('ignora valores inválidos y hace console.warn', () => {
    const { setSessionIconFonts, isIconFont } = mod
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setSessionIconFonts(123)           // inválido
    setSessionIconFonts({ nope: true }) // inválido
    expect(warn).toHaveBeenCalled() // cubre rama del console.warn
    // No debe haber agregado nada que haga matchear "qwerty"
    expect(isIconFont('qwerty')).toBe(false)
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
