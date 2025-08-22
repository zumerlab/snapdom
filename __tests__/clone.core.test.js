import { describe, it, expect, vi } from 'vitest';
import { deepClone } from '../src/core/clone.js';
import { createContext } from '../src/core/context.js';
import { cache } from '../src/core/cache.js';

let options = createContext()
const sessionCache = {
        styleMap: cache.session.styleMap,
        styleCache: cache.session.styleCache,
        nodeMap: cache.session.nodeMap
      }

function runClone(node) {
  return deepClone(node, sessionCache, {...options});
}

describe('deepClone', () => {
  it('clones a simple div', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    const clone = runClone(el);
    expect(clone).not.toBe(el);
    expect(clone.textContent).toBe('hello');
  });

  it('clones canvas as an image', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 10, 10);
    }
    const clone = runClone(canvas);
    expect(clone.tagName).toBe('IMG');
    expect(clone.src.startsWith('data:image/')).toBe(true);
  });

  it('deepClone handles data-capture="exclude"', () => {
    const el = document.createElement('div');
    el.setAttribute('data-capture', 'exclude');
    const clone = runClone(el);
    expect(clone).not.toBeNull();
  });

  it('deepClone handles data-capture="placeholder"', () => {
    const el = document.createElement('div');
    el.setAttribute('data-capture', 'placeholder');
    el.setAttribute('data-placeholder-text', 'Placeholder!');
    const clone = runClone(el);
    expect(clone.textContent).toContain('Placeholder!');
  });

  it('deepClone handles iframe', () => {
    const iframe = document.createElement('iframe');
    iframe.width = 100;
    iframe.height = 50;
    const clone = runClone(iframe);
    expect(clone.tagName).toBe('DIV');
  });

  it('deepClone handles input, textarea, select', () => {
    const input = document.createElement('input');
    input.value = 'foo';
    input.checked = true;

    const textarea = document.createElement('textarea');
    textarea.value = 'bar';

    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = 'baz';
    select.appendChild(opt);
    select.value = 'baz';

    [input, textarea, select].forEach(el => {
      const clone = runClone(el);
      expect(clone.value).toBe(el.value);
    });
  });

  it('deepClone handles shadow DOM', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    const span = document.createElement('span');
    span.textContent = 'shadow';
    shadow.appendChild(span);
    const clone = runClone(el);
    expect(clone).not.toBeNull();
  });
});

describe('deepClone edge cases', () => {
  it('clones unsupported node (Comment) as a new Comment', () => {
    const fake = document.createComment('not supported');
    const result = runClone(fake);
    expect(result.nodeType).toBe(Node.COMMENT_NODE);
    expect(result.textContent).toBe('not supported');
    expect(result).not.toBe(fake);
  });

  it('clones attributes and children', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', '1');
    const result = runClone(el);
    expect(result.getAttribute('data-test')).toBe('1');
  });
});
