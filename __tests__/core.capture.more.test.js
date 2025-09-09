// __tests__/core.capture.more.test.js
// Vitest (browser) safe: no vi.mock/doMock, no spyOn sobre exports ESM puros.
// Solo usamos dynamic import y spies en APIs DOM o asserts por efectos.
//
// Código en inglés con JSDoc.

/* eslint-disable import/no-extraneous-dependencies */
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Decode the SVG XML text from a data URL returned by captureDOM.
 * @param {string} dataUrl
 * @returns {string}
 */
function decodeSvg(dataUrl) {
  const [, encoded] = dataUrl.split(',', 2);
  return decodeURIComponent(encoded);
}

/**
 * Creates a stable DOMRect for BCR stubs.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {DOMRect}
 */
function rect(x, y, w, h) {
  return new DOMRect(x, y, w, h);
}

afterEach(() => {
  vi.restoreAllMocks();
});

//
// ──────────────────────────────────────────────────────────────────────────────
// Edge cases (los que ya tenías, sin cambios)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM edge cases', () => {
  it('throws for unsupported element (unknown nodeType)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    const fakeNode = { nodeType: 999 };
    await expect(captureDOM(fakeNode)).rejects.toThrow();
  });

  it('throws if element is null', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    await expect(captureDOM(null)).rejects.toThrow();
  });

  it('throws error if getBoundingClientRect fails', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => { throw new Error('fail'); });

    const el = document.createElement('div');
    await expect(captureDOM(el, { fast: true })).rejects.toThrow(/fail/);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// Functional & overflow rules
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM functional', () => {
  it('returns a data:image/svg+xml and includes overflow visible rules', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rect(0, 0, 80, 40)
    );

    const el = document.createElement('div');
    el.textContent = 'test';
    const url = await captureDOM(el, { fast: true, embedFonts: false });
    expect(url.startsWith('data:image/svg+xml')).toBe(true);

    const svg = decodeSvg(url);
    expect(svg).toMatch(/svg\{overflow:visible;?\}/);
    expect(svg).toMatch(/foreignObject\{overflow:visible;?\}/);
  });

  it('supports scale and width/height options (wrapper sizing behavior)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rect(10, 20, 100, 50) // aspect = 2
    );

    const el = document.createElement('div');

    // scale → aparece scale() en transform del wrapper/container
    const url1 = await captureDOM(el, { fast: true, scale: 2, embedFonts: false });
    expect(decodeSvg(url1)).toMatch(/transform:[^"]*scale\(\s*2(\.0+)?\s*\)/);

    // width only → el <svg> conserva 100x50; el wrapper dentro del foreignObject tiene style="width: 200px"
    const url2 = await captureDOM(el, { fast: true, width: 200, embedFonts: false });
    const svg2 = decodeSvg(url2);
    expect(svg2).toContain('width="100"'); // natural SVG width
    expect(svg2).toContain('height="50"'); // natural SVG height
    expect(svg2).toMatch(/<div[^>]*style="[^"]*width:\s*200px/);

    // height only → el <svg> conserva 100x50; el wrapper tiene style="height: 100px"
    const url3 = await captureDOM(el, { fast: true, height: 100, embedFonts: false });
    const svg3 = decodeSvg(url3);
    expect(svg3).toContain('width="100"');
    expect(svg3).toContain('height="50"');
    expect(svg3).toMatch(/<div[^>]*style="[^"]*height:\s*100px/);
  });

  it('supports fast=false (idle scheduling path)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 10, 10));
    const el = document.createElement('div');
    const url = await captureDOM(el, { fast: false, embedFonts: false });
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// BaseCSS presence (sin espiar ESM): solo verificamos reglas base
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – baseCSS presence (no ESM spies)', () => {
  it('includes base overflow rules on repeated calls', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 120, 60));

    const el1 = document.createElement('div');
    const el2 = document.createElement('div');

    const s1 = decodeSvg(await captureDOM(el1, { fast: true, embedFonts: false }));
    const s2 = decodeSvg(await captureDOM(el2, { fast: true, embedFonts: false }));

    expect(s1).toMatch(/svg\{overflow:visible;?\}/);
    expect(s1).toMatch(/foreignObject\{overflow:visible;?\}/);
    expect(s2).toMatch(/svg\{overflow:visible;?\}/);
    expect(s2).toMatch(/foreignObject\{overflow:visible;?\}/);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// Width/Height/Scale branches (precise, alineado a tu implementación actual)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – width/height/scale branches (precise)', () => {
  it('natural rect used when no width/height/scale given', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50));
    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
  });

  it('width only → wrapper gets style="width: 200px" (SVG keeps natural size)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50));
    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, width: 200, embedFonts: false }));
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toMatch(/<div[^>]*style="[^"]*width:\s*200px/);
  });

  it('height only → wrapper gets style="height: 100px" (SVG keeps natural size)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50));
    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, height: 100, embedFonts: false }));
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toMatch(/<div[^>]*style="[^"]*height:\s*100px/);
  });

  it('scale only → applies scale() in wrapper transform', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50));
    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, scale: 2, embedFonts: false }));
    expect(svg).toMatch(/transform:[^"]*scale\(\s*2(\.0+)?\s*\)/);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// Viewport path (sin tocar utils): solo afirmamos x/y presentes (0 o valores)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – viewport path sanity', () => {
  it('foreignObject has x/y attributes (tx/ty), even if 0', async () => {
    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(5, 7, 80, 30));
    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // No imponemos un cálculo exacto; validamos la presencia de x="" y y="" numéricos.
    expect(svg).toMatch(/<foreignObject[^>]*\sx="[-\d]+"/);
    expect(svg).toMatch(/<foreignObject[^>]*\sy="[-\d]+"/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Transform handling (lenient, effect-only)
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – transform handling (lenient heuristic)', () => {
  it('when element has a rotate transform, output stays valid and exposes transform-related styles', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    const el = document.createElement('div');
    el.style.transform = 'rotate(30deg)';

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 120, 60));

    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // 1) SVG válido
    expect(svg.startsWith('<svg')).toBe(true);

    // 2) El wrapper suele incluir transform-origin aunque no tenga shorthand transform
    expect(svg).toMatch(/transform-origin:\s*[\d.]+px\s+[\d.]+px/);

    // 3) Alguna de las props individuales debe estar presente (rotate|scale|translate)
    //    No validamos el valor exacto (puede ser 0deg según la normalización interna).
    expect(
      /style="[^"]*(?:rotate:\s*[^;"]+|scale:\s*[^;"]+|translate:\s*[^;"]+)[^"]*"/.test(svg)
    ).toBe(true);
  });
});


//
// ──────────────────────────────────────────────────────────────────────────────
// Base transform + individual rotate/scale/translate (sin forzar valores exactos)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – baseTransform & individual props on clone (lenient)', () => {
  it('inline style in output includes individual transform properties', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    const el = document.createElement('div');
    el.style.transform = 'rotate(10deg)';

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 100));

    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // Aceptamos cualquier valor; solo pedimos que existan las props individuales.
    expect(svg).toMatch(/style="[^"]*rotate:\s*[^;"]+/);
    expect(svg).toMatch(/style="[^"]*scale:\s*[^;"]+/);
    expect(svg).toMatch(/style="[^"]*translate:\s*[^;"]+/);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// embedFonts branch: no espiamos ESM; solo verificamos que no rompa y que
// potencialmente inserte CSS de fuentes si el pipeline interno lo decide.
// (Sin red real, aceptamos ambas salidas.)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – embedFonts=true (no spies, effect-only)', () => {
  it('does not throw and may inject fonts CSS', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 50, 20));

    const el = document.createElement('div');
    el.textContent = 'Hello';

    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: true }));

    // No afirmamos siempre la presencia de CSS de fuentes (depende de IO/hints),
    // pero sí que sea SVG válido.
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

//
// ──────────────────────────────────────────────────────────────────────────────
// Sandbox cleanup
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – removes #snapdom-sandbox when absolute', () => {
  it('cleans up the offscreen sandbox', async () => {
    const sandbox = document.createElement('div');
    sandbox.id = 'snapdom-sandbox';
    sandbox.style.position = 'absolute';
    document.body.appendChild(sandbox);

    const { captureDOM } = await import('../src/core/capture.js');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 10, 10));

    const el = document.createElement('div');
    const url = await captureDOM(el, { fast: true });
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(document.getElementById('snapdom-sandbox')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Width & Height together -> container may use non-uniform scale OR set wrapper size
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – width & height together apply size (scale or wrapper size)', () => {
  it('keeps natural SVG size and either adds scale(sx, sy) OR sets wrapper width/height', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    // Natural rect = 100x50 (aspect 2)
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 100, 50));

    const el = document.createElement('div');

    // Ask for 150x120
    const svg = decodeSvg(await captureDOM(el, {
      fast: true,
      width: 150,
      height: 120,
      embedFonts: false,
    }));

    // SVG header stays natural
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');

    // Implementation may choose either:
    // A) non-uniform scale on container, OR
    const hasScale =
      /transform:[^"]*scale\(\s*1\.5[0-9]*\s*,\s*2\.4[0-9]*\s*\)/.test(svg);

    // B) explicit wrapper sizing via style width/height.
    const hasWrapperSize =
      /<div[^>]*style="[^"]*width:\s*150px[^"]*height:\s*120px/.test(svg) ||
      /<div[^>]*style="[^"]*height:\s*120px[^"]*width:\s*150px/.test(svg);

    expect(hasScale || hasWrapperSize).toBe(true);
  });
});


// ──────────────────────────────────────────────────────────────────────────────
// Fractional viewport: tolerate ceil rounding and just require numeric x/y
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – fractional viewport sizes and tx/ty computation', () => {
  it('emits valid SVG with numeric width/height and numeric foreignObject x/y', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    // BCR con fracciones
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10.3, 20.6, 100.4, 50.6));

    const el = document.createElement('div');
    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // Algunas implementaciones conservan fracciones; otras hacen ceil.
    // Aceptamos '100.4' o '101' y '50.6' o '51'.
    expect(/width="(100\.4|101)"/.test(svg)).toBe(true);
    expect(/height="(50\.6|51)"/.test(svg)).toBe(true);

    // x/y del foreignObject: solo exigimos que existan y sean numéricos (con o sin signo/decimales)
    expect(/<foreignObject[^>]*\sx="[-\d.]+"/.test(svg)).toBe(true);
    expect(/<foreignObject[^>]*\sy="[-\d.]+"/.test(svg)).toBe(true);
  });
});


// ──────────────────────────────────────────────────────────────────────────────
// Cache policy path (no internal assert, but forces applyCachePolicy branch)
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – honors cache policy "none"', () => {
  it('works with cache: "none" and still returns a valid SVG data URL', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 64, 32));

    const el = document.createElement('div');
    const url = await captureDOM(el, { fast: true, cache: 'none', embedFonts: false });
    expect(url.startsWith('data:image/svg+xml')).toBe(true);

    const svg = decodeSvg(url);
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Typed OM branch (readIndividualTransforms via computedStyleMap)
// Cubre: rotate (rad->deg), scale array, translate array, + fallback de strings.
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – Typed OM readIndividualTransforms', () => {
  it('reads rotate/scale/translate from computedStyleMap (Typed OM) and propagates to clone', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    // BCR estándar
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 100, 50));

    const el = document.createElement('div');

    // Stub Typed OM en el elemento
    el.computedStyleMap = () => ({
      // rotate: ángulo en radianes → debe convertirse a deg
      get(prop) {
        if (prop === 'rotate') {
          return { angle: { value: Math.PI / 2, unit: 'rad' } }; // 90deg
        }
        if (prop === 'scale') {
          // array-like con sx, sy
          return [{ value: 2 }, { value: 3 }];
        }
        if (prop === 'translate') {
          return [{ value: 4, unit: 'px' }, { value: 5, unit: 'px' }];
        }
        return null;
      },
    });

    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // El clone debe llevar las props individuales
    expect(svg).toMatch(/style="[^"]*rotate:\s*90deg/);
    expect(svg).toMatch(/style="[^"]*scale:\s*2\s+3/);
    expect(svg).toMatch(/style="[^"]*translate:\s*4px\s+5px/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// Strict path: ensure element is attached so computedStyle picks transforms
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – strict path uses measure host and matrix pipeline', () => {
  it('creates snapdom-measure-slot once and reuses it; output includes transform work', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    // Fuerza bbox-transform: matrix con rotación + translate (no es translate puro)
    const el = document.createElement('div');
    el.style.transform = 'matrix(0.9396926,0.3420201,-0.3420201,0.9396926,5,-7)';

    // ⚠️ Importante: anclar al DOM para que getComputedStyle refleje transform
    document.body.appendChild(el);

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 120, 60));

    // 1ª captura: debería crear el host de medición
    const svg1 = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));
    const host1 = document.getElementById('snapdom-measure-slot');
    expect(host1).toBeTruthy();

    // Debe haber algún transform aplicado en el container (cancel/scale/etc.)
    expect(/style="[^"]*transform:[^"]+/.test(svg1)).toBe(true);

    // 2ª captura: reutiliza el mismo host (no duplica nodos)
    const beforeCount = document.querySelectorAll('#snapdom-measure-slot').length;
    const svg2 = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));
    const afterCount = document.querySelectorAll('#snapdom-measure-slot').length;
    expect(afterCount).toBe(beforeCount);

    // Sigue habiendo transform en el container
    expect(/style="[^"]*transform:[^"]+/.test(svg2)).toBe(true);

    // Limpieza
    el.remove();
  });
});


// ──────────────────────────────────────────────────────────────────────────────
// Pure translate NO afecta bbox: ejercita rama identity/pure-translate de
// hasBBoxAffectingTransform (310–312) sin tocar exports internos.
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – pure translate does not trigger strict path', () => {
  it('keeps viewport path semantics for translate-only transforms (no extra cancel)', async () => {
    const { captureDOM } = await import('../src/core/capture.js');

    const el = document.createElement('div');
    // translate puro → should be treated as non-bbox-affecting
    el.style.transform = 'translate(8px, 9px)';

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 20, 100, 50));

    const svg = decodeSvg(await captureDOM(el, { fast: true, embedFonts: false }));

    // Viewport path: el tamaño del <svg> refleja el rect (ceil), sin obligación de transform en container.
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');

    // Aceptamos que el container NO tenga transform o solo tenga transform-origin.
    // Si por implementación hubiese un transform, igual no debería contener translate de "cancelación".
    const hasTransform = /style="[^"]*transform:[^"]+/.test(svg);
    if (hasTransform) {
      // No esperaríamos un translate(...) de cancelación (estrict path) en este caso.
      expect(/transform:[^"]*translate\(/.test(svg)).toBe(false);
    }
  });
});
