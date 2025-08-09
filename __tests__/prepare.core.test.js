import { describe, it, expect, vi } from 'vitest';
import { prepareClone } from '../src/core/prepare.js';

describe('prepareClone', () => {
  it('prepares a clone of a div', async () => {
    const el = document.createElement('div');
    el.textContent = 'test';
    const { clone, classCSS } = await prepareClone(el);
    expect(clone).not.toBeNull();
    expect(typeof classCSS).toBe('string');
  });
});

describe('prepareClone edge cases', () => {
  it('throws for null node', async () => {
    await expect(prepareClone(null)).rejects.toThrow();
  });
  it('handles error in internal logic', async () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'cloneNode').mockImplementation(() => { throw new Error('fail'); });
    await expect(prepareClone(el)).rejects.toThrow('fail');
  });
  it('clones attributes and children', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', '1');
    const result = await prepareClone(el);
    expect(result.clone.getAttribute('data-test')).toBe('1');
  });
});
