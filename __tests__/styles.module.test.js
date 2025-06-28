import { describe, it, expect } from 'vitest';
import { inlineAllStyles } from '../src/modules/styles.js';

describe('inlineAllStyles', () => {
  it('adds a style key to the styleMap', () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    const styleMap = new Map();
    const cache = new WeakMap();
    inlineAllStyles(el, clone, styleMap, cache, false);
    expect(styleMap.has(clone)).toBe(true);
  });
  it('inlineAllStyles works with compress true', () => {
    const el = document.createElement('span');
    const clone = document.createElement('span');
    const styleMap = new Map();
    const cache = new WeakMap();
    inlineAllStyles(el, clone, styleMap, cache, true);
    expect(styleMap.has(clone)).toBe(true);
  });
});
