// __tests__/module.iconFonts.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mod; // se setea en beforeEach para resetear estado del módulo

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules(); // importante para resetear userIconFonts
  mod = await import('../src/modules/iconFonts.js'); // ESM dynamic import
});

describe('extendIconFonts', () => {
  it('acepta string y lo convierte a RegExp (case-insensitive)', () => {
    const { extendIconFonts, isIconFont } = mod;
    // string -> RegExp
    extendIconFonts('acme-brand');
    expect(isIconFont('ACME-BRAND pack')).toBe(true);
    // control: no matchea algo que no contenga el patrón y tampoco cae en la heurística
    expect(isIconFont('qwerty')).toBe(false);
  });

  it('acepta RegExp y lo agrega a la lista de usuarios', () => {
    const { extendIconFonts, isIconFont } = mod;
    extendIconFonts(/brandx/i);
    expect(isIconFont('This is BrAnDx kit')).toBe(true);
    expect(isIconFont('no-match-here')).toBe(false);
  });

  it('acepta arrays mezclando strings y RegExp', () => {
    const { extendIconFonts, isIconFont } = mod;
    extendIconFonts(['foo-lib', /bar-pkg/i]);
    expect(isIconFont('FOO-LIB icons')).toBe(true);
    expect(isIconFont('BAR-PKG family')).toBe(true);
    expect(isIconFont('none')).toBe(false);
  });

  it('ignora valores inválidos y hace console.warn', () => {
    const { extendIconFonts, isIconFont } = mod;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    extendIconFonts(123);           // inválido
    extendIconFonts({ nope: true }); // inválido
    expect(warn).toHaveBeenCalled(); // cubre rama del console.warn
    // No debe haber agregado nada que haga matchear "qwerty"
    expect(isIconFont('qwerty')).toBe(false);
    warn.mockRestore();
  });
});

describe('isIconFont (defaults)', () => {
  it('reconoce patrones por default (e.g., Font Awesome)', () => {
    const { isIconFont } = mod;
    expect(isIconFont('Font Awesome 6 Pro')).toBe(true); // match por defaultIconFonts
  });
});
