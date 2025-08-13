import { describe, it, expect } from 'vitest';
import { inlineAllStyles } from '../src/modules/styles.js';
import { cache } from '../src/core/cache.js';

 it('inlineAllStyles works with compress true', () => {
    const el = document.createElement('span');
    const clone = document.createElement('span');
    const styleMap = new Map();
    const cache = new WeakMap();
    inlineAllStyles(el, clone, styleMap, cache, true);
    expect(styleMap.has(clone)).toBe(true);
  });
