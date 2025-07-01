import { describe, it, expect} from 'vitest';
import { deepClone } from '../src/core/clone.js';

describe('deepClone - iframes', () => {
  it('clona el contenido de un iframe de mismo origen', () => {
    // Crear iframe de mismo origen
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    // Simular contenido
    iframe.contentDocument.body.innerHTML = '<div id="inner">Hola <b>iframe</b></div>';
    // Clonar
    const clone = deepClone(iframe, new Map(), new WeakMap(), new WeakMap(), false);
    // Buscar el contenido clonado
    const inner = clone.querySelector && clone.querySelector('#inner');
    expect(inner).toBeTruthy();
    expect(inner.textContent).toContain('Hola iframe');
    document.body.removeChild(iframe);
  });

  it('usa fallback visual para iframe cross-origin', () => {
    // Mock de iframe cross-origin
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', {
      get() { throw new Error('cross-origin'); },
    });
    Object.defineProperty(iframe, 'offsetWidth', { get: () => 123 });
    Object.defineProperty(iframe, 'offsetHeight', { get: () => 45 });
    const clone = deepClone(iframe, new Map(), new WeakMap(), new WeakMap(), false);
    expect(clone.tagName).toBe('DIV');
    expect(clone.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(clone.style.width).toBe('123px');
    expect(clone.style.height).toBe('45px');
  });
});
