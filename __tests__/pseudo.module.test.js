vi.mock('../src/utils/helpers.js', async () => {
  const actual = await vi.importActual('../src/utils/helpers.js');
  return {
    ...actual,
    fetchImage: vi.fn(),
  };
});
vi.mock('../src/modules/fonts.js', async () => {
  const actual = await vi.importActual('../src/modules/fonts.js');
  return {
    ...actual,
    iconToImage: vi.fn(),
  };
});

import { describe, it, expect, vi } from 'vitest';
import { inlinePseudoElements } from '../src/modules/pseudo.js';
import * as helpers from '../src/utils/helpers.js';
import * as fonts from '../src/modules/fonts.js';

describe('inlinePseudoElements', () => {
  it('does not fail with simple elements', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    await expect(inlinePseudoElements(el, clone, new Map(), new WeakMap(), false)).resolves.toBeUndefined();
  });

  it('handles ::before with text content', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? '"★"' : prop === 'font-family' ? 'Arial' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'none' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::before with icon font', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? '"★"' : prop === 'font-family' ? 'Font Awesome' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'none' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Font Awesome',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    fonts.iconToImage.mockResolvedValue('data:image/png;base64,icon');
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::before with url content', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? 'url("https://test.com/img.png")' : prop === 'font-family' ? 'Arial' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'none' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    helpers.fetchImage.mockResolvedValue('data:image/png;base64,img');
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::before with background-image (data url)', async () => {
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

  it('handles ::before with background-image (fetch)', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? 'none' : prop === 'font-family' ? 'Arial' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'url("https://test.com/img.png")' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    helpers.fetchImage.mockResolvedValue('data:image/png;base64,img');
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::before with background-image fetch error', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? 'none' : prop === 'font-family' ? 'Arial' : prop === 'font-size' ? '32' : prop === 'font-weight' ? '400' : prop === 'color' ? '#000' : prop === 'background-image' ? 'url("https://test.com/img.png")' : prop === 'background-color' ? 'transparent' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial',
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    helpers.fetchImage.mockRejectedValue(new Error('fail'));
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::before with no visible box', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: () => 'none', color: '', fontSize: '', fontWeight: '', fontFamily: ''
      };
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' };
    });
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles ::first-letter with no textNode', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: ''
    }));
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });

  it('handles error in pseudo processing', async () => {
    const el = document.createElement('div');
    const clone = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('fail'); });
    await inlinePseudoElements(el, clone, new Map(), new WeakMap(), false);
    window.getComputedStyle.mockRestore();
  });
});
