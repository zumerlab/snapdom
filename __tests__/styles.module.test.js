import { describe, it, expect } from 'vitest';
import { inlineAllStyles } from '../src/modules/styles.js';
import { cache } from '../src/core/cache.js';

describe('inlineAllStyles', () => {
  it('adds a style key to the styleMap', () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    inlineAllStyles(el, clone, false);
    expect(cache.preStyleMap.has(clone)).toBe(true);
  });
});