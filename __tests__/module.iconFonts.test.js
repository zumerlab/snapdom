// __tests__/module.iconFonts.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mod // se setea en beforeEach para resetear estado del módulo

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules() // importante para resetear userIconFonts
  mod = await import('../src/modules/iconFonts.js') // ESM dynamic import
})

describe('extendIconFonts', () => {
  it('acepta string y lo convierte a RegExp (case-insensitive)', () => {
    const { extendIconFonts, isIconFont } = mod
    // string -> RegExp
    extendIconFonts('acme-brand')
    expect(isIconFont('ACME-BRAND pack')).toBe(true)
    // control: no matchea algo que no contenga el patrón y tampoco cae en la heurística
    expect(isIconFont('qwerty')).toBe(false)
  })

  it('acepta RegExp y lo agrega a la lista de usuarios', () => {
    const { extendIconFonts, isIconFont } = mod
    extendIconFonts(/brandx/i)
    expect(isIconFont('This is BrAnDx kit')).toBe(true)
    expect(isIconFont('no-match-here')).toBe(false)
  })

  it('acepta arrays mezclando strings y RegExp', () => {
    const { extendIconFonts, isIconFont } = mod
    extendIconFonts(['foo-lib', /bar-pkg/i])
    expect(isIconFont('FOO-LIB icons')).toBe(true)
    expect(isIconFont('BAR-PKG family')).toBe(true)
    expect(isIconFont('none')).toBe(false)
  })

  it('dedupes repeated entries instead of growing the list unboundedly (speed punch-list)', () => {
    const { extendIconFonts, isIconFont } = mod
    extendIconFonts(['dup-brand', /dup-brand-rx/i])
    // A non-matching string forces a full scan of every registered pattern
    // (no early return), so the RegExp.prototype.test call count is a direct
    // proxy for the candidate list's size.
    const spy1 = vi.spyOn(RegExp.prototype, 'test')
    isIconFont('nothing-matches-here')
    const callsAfterFirstRegistration = spy1.mock.calls.length
    spy1.mockRestore()

    // Simulates snapdom.js re-calling extendIconFonts with the same option on
    // every capture (e.g. an animation loop reusing the same iconFonts
    // array/object). Without dedup this would push 98 more duplicate entries.
    for (let i = 0; i < 49; i++) extendIconFonts(['dup-brand', /dup-brand-rx/i])

    const spy2 = vi.spyOn(RegExp.prototype, 'test')
    isIconFont('nothing-matches-here')
    const callsAfterRepeatedRegistration = spy2.mock.calls.length
    spy2.mockRestore()

    expect(callsAfterRepeatedRegistration).toBe(callsAfterFirstRegistration)
  })

  it('ignora valores inválidos y hace console.warn', () => {
    const { extendIconFonts, isIconFont } = mod
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    extendIconFonts(123)           // inválido
    extendIconFonts({ nope: true }) // inválido
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
    const { cache } = await import('../src/core/cache.js')

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

    cache.session.nodeMap = new Map([[c2, s2]])

    await ligatureIconToImage(clone, source)

    const img = c2.querySelector('img')
    expect(img).toBeTruthy()
    // Height derives from the mapped source's font-size (24), not index-0's (99).
    expect(img.style.height).toBe('24px')

    source.remove()
    clone.remove()
  })
})
