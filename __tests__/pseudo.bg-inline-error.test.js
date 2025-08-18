import { describe, it, vi } from 'vitest';
import { inlinePseudoElements } from '../src/modules/pseudo.js';
vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils');
  return {
    ...actual,
    inlineSingleBackgroundEntry: vi.fn().mockRejectedValue(new Error('fail')),
  };
});




describe('inlinePseudoElements background-image inlining (error)', () => {
  it('cubre el catch de error en inlining de background-image en pseudo', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? 'none' : prop === 'font-family' ? 'Arial' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'url("data:image/png;base64,abc")' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });
});
