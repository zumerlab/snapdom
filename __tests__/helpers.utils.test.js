import { describe, it, expect, vi, beforeEach} from 'vitest';
import { getStyle, parseContent, extractURL, isIconFont, snapshotComputedStyle, isSafari, stripTranslate, safeEncodeURI, idle, fetchImage } from '../src/utils/helpers.js';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || '';
    if (
      msg.includes('[SnapDOM - fetchImage] Fetch failed and no proxy provided') ||
      msg.includes('Image load timed out') ||
      msg.includes('[SnapDOM - fetchImage] Recently failed (cooldown).')
    ) {
      e.preventDefault(); // evita el banner de Vitest
    }
  });
}

  beforeEach(() => {
  vi.restoreAllMocks();
  
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      // PNG válido: tipo correcto para que FileReader genere data:image/png;...
      blob: () =>
        Promise.resolve(new Blob(
          [new Uint8Array([137,80,78,71,13,10,26,10])], // cabecera PNG
          { type: 'image/png' }
        )),
      text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    })
  );

});
describe('getStyle', () => {
  it('returns a CSSStyleDeclaration', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const style = getStyle(el);
    expect(style).toBeInstanceOf(CSSStyleDeclaration);
    document.body.removeChild(el);
  });
});



describe('parseContent', () => {
  it('parses CSS content correctly', () => {
    expect(parseContent('"★"')).toBe('★');
    expect(parseContent('\\2605')).toBe('★');
  });
});

describe('parseContent edge cases', () => {
  it('returns \u0000 if parseInt fails (not hex)', () => {
    expect(parseContent('\\nothex')).toBe('\u0000');
  });
  it('returns clean if String.fromCharCode throws', () => {
    const orig = String.fromCharCode;
    String.fromCharCode = () => { throw new Error('fail'); };
    expect(parseContent('\\2605')).toBe('\\2605');
    String.fromCharCode = orig;
  });
});

describe('extractURL', () => {
  it('extracts the URL from background-image', () => {
    expect(extractURL('url("https://test.com/img.png")')).toBe('https://test.com/img.png');
    expect(extractURL('none')).toBeNull();
  });
});

describe('isIconFont', () => {
  it('detects icon fonts', () => {
    expect(isIconFont('Font Awesome')).toBe(true);
    expect(isIconFont('Arial')).toBe(false);
  });
});

describe('snapshotComputedStyle', () => {
  it('returns a style snapshot', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const style = getComputedStyle(el);
    const snap = snapshotComputedStyle(style);
    expect(typeof snap).toBe('object');
    document.body.removeChild(el);
  });
});

describe('isSafari', () => {
  it('returns a boolean', () => {
    expect(typeof isSafari()).toBe('boolean');
  });
});

describe('stripTranslate', () => {
  it('removes translate transforms', () => {
    expect(stripTranslate('translateX(10px) scale(2)')).toContain('scale(2)');
  });
  it('stripTranslate removes matrix and matrix3d', () => {
    expect(stripTranslate('matrix(1,0,0,1,10,20)')).not.toContain('10,20');
    expect(stripTranslate('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1)')).not.toContain('10,20,30');
  });
});

describe('safeEncodeURI', () => {
  it('returns an encoded string', () => {
    expect(typeof safeEncodeURI('https://test.com/á')).toBe('string');
  });
  it('safeEncodeURI handles invalid URIs gracefully', () => {
    expect(typeof safeEncodeURI('%E0%A4%A')).toBe('string');
  });
});

describe('idle', () => {
  it('calls fn immediately if fast is true', () => {
    let called = false;
    idle(() => { called = true; }, { fast: true });
    expect(called).toBe(true);
  });
  it('uses requestIdleCallback if available', () => {
    const orig = window.requestIdleCallback;
    let called = false;
    window.requestIdleCallback = (fn) => { called = true; fn(); };
    idle(() => { called = true; });
    expect(called).toBe(true);
    window.requestIdleCallback = orig;
  });
  it('falls back to setTimeout if requestIdleCallback not available', async () => {
    const orig = window.requestIdleCallback;
    delete window.requestIdleCallback;
    let called = false;
    idle(() => { called = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(called).toBe(true);
    window.requestIdleCallback = orig;
  });
});

describe('stripTranslate edge cases', () => {
  it('returns empty string for empty or none', () => {
    expect(stripTranslate('')).toBe('');
    expect(stripTranslate('none')).toBe('');
  });
  it('returns original for malformed matrix', () => {
    expect(stripTranslate('matrix(1,2,3)')).toBe('matrix(1,2,3)');
    expect(stripTranslate('matrix3d(1,2,3)')).toBe('matrix3d(1,2,3)');
  });
});


it('rejects on image error', async () => {
  // fetch está mockeado en setup; acá lo hacemos fallar una vez
  const mockFetch = /** @type {any} */ (globalThis.fetch);
  mockFetch.mockRejectedValueOnce(new Error('network fail'));

  await expect(fetchImage('invalid-url', { timeout: 100 }))
    .rejects.toThrow('[SnapDOM - fetchImage] Fetch failed and no proxy provided');
});

it('rejects on timeout', async () => {
  const OrigImage = globalThis.Image;
  // Imagen que nunca dispara onload/onerror → dispara timeout
  globalThis.Image = class { set src(_){} onload(){} onerror(){} };

  const mockFetch = /** @type {any} */ (globalThis.fetch);
  mockFetch.mockRejectedValueOnce(new Error('network fail')); // fallback falla

  await expect(fetchImage('timeout-url', { timeout: 10 }))
    .rejects.toThrow('Image load timed out');

  globalThis.Image = OrigImage;
});

it('rejects with original error if decode fails', async () => {
  const OrigImage = globalThis.Image;
  // Llama a onload y luego decode() falla
  globalThis.Image = class {
    constructor(){ setTimeout(() => this.onload && this.onload(), 1); }
    set src(_) {}
    decode(){ return Promise.reject(new Error('decode fail')); }
    get width(){ return 1; }
    get height(){ return 1; }
    get naturalWidth(){ return 1; }
    get naturalHeight(){ return 1; }
  };

  const mockFetch = /** @type {any} */ (globalThis.fetch);
  mockFetch.mockRejectedValueOnce(new Error('network fail')); // fallback falla

  await expect(fetchImage('decode-fail-url', { timeout: 100 }))
    .rejects.toThrow('[SnapDOM - fetchImage] Fetch failed and no proxy provided');

  globalThis.Image = OrigImage;
});


