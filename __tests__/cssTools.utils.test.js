import { describe, it, expect } from 'vitest';
import { getStyleKey, collectUsedTagNames, getDefaultStyleForTag } from '../src/utils';

describe('getStyleKey', () => {
  it('generates a non-empty style key', () => {
    const snapshot = { color: 'red', 'font-size': '12px' };
    const key = getStyleKey(snapshot, 'div',{compress:false});
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('getStyleKey works with compress true', () => {
    const snapshot = { color: 'red', 'font-size': '12px' };
    const key = getStyleKey(snapshot, 'div', {compress:true});
    expect(typeof key).toBe('string');
  });
});

describe('collectUsedTagNames', () => {
  it('returns unique tag names', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span></span><p></p><span></span>';
    const tags = collectUsedTagNames(root);
    expect(tags).toContain('div');
    expect(tags).toContain('span');
    expect(tags).toContain('p');
  });
});

describe('getDefaultStyleForTag', () => {
  it('returns a default style object', () => {
    const defaults = getDefaultStyleForTag('div');
    expect(typeof defaults).toBe('object');
  });

  it('getDefaultStyleForTag skips special tags', () => {
    expect(getDefaultStyleForTag('script')).toEqual({});
  });
});
