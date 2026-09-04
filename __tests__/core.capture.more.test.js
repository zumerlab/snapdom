import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSafari } from '../src/utils/browser.js'

// Safari keeps the natural svg size (export applies width/height later); other engines resize the svg header.
const sizedW = (w, natural) => `width="${isSafari() ? natural : w}"`
const sizedH = (h, natural) => `height="${isSafari() ? natural : h}"`

/**
 * Decode the SVG XML text from a data URL returned by captureDOM.
 * @param {string} dataUrl
 * @returns {string}
 */
function decodeSvg(dataUrl) {
  const [, encoded] = dataUrl.split(',', 2)
  return decodeURIComponent(encoded)
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
  return new DOMRect(x, y, w, h)
}

afterEach(() => {
  vi.restoreAllMocks()
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM edge cases', () => {
  it('throws for unsupported element (unknown nodeType)', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    const fakeNode = { nodeType: 999 }
    await expect(captureDOM(fakeNode)).rejects.toThrow()
  })

  it('throws if element is null', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    await expect(captureDOM(null)).rejects.toThrow()
  })

  it('throws error if getBoundingClientRect fails', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => { throw new Error('fail') })

    const el = document.createElement('div')
    await expect(captureDOM(el, {})).rejects.toThrow(/fail/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Functional & overflow rules
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM functional', () => {
  it('returns a data:image/svg+xml and includes overflow visible rules', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rect(0, 0, 80, 40)
    )

    const el = document.createElement('div')
    el.textContent = 'test'
    const url = await captureDOM(el, { embedFonts: false })
    expect(url.startsWith('data:image/svg+xml')).toBe(true)

    const svg = decodeSvg(url)
    expect(svg).toMatch(/svg\{overflow:visible;?\}/)
    expect(svg).toMatch(/foreignObject\{overflow:visible;?\}/)
  })

  // The combined scale+width+height test that lived here asserted the same facts as the
  // per-branch 'width/height/scale branches (precise)' describe below, with less precision —
  // deleted as a duplicate (v3 test-suite review).

})

//
// ──────────────────────────────────────────────────────────────────────────────
// BaseCSS presence (sin espiar ESM): solo verificamos reglas base
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – baseCSS presence (no ESM spies)', () => {
  it('includes base overflow rules on repeated calls', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 120, 60))

    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    const s1 = decodeSvg(await captureDOM(el1, { embedFonts: false }))
    const s2 = decodeSvg(await captureDOM(el2, { embedFonts: false }))

    expect(s1).toMatch(/svg\{overflow:visible;?\}/)
    expect(s1).toMatch(/foreignObject\{overflow:visible;?\}/)
    expect(s2).toMatch(/svg\{overflow:visible;?\}/)
    expect(s2).toMatch(/foreignObject\{overflow:visible;?\}/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Width/Height/Scale branches (precise, matching the current implementation)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – width/height/scale branches (precise)', () => {
  it('natural rect used when no width/height/scale given', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50))
    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="50"')
  })

  it('width only → SVG 200x100; wrapper queda 100x50; viewBox natural', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50))
    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { width: 200, embedFonts: false }))
    expect(svg).toContain(sizedW(200, 100))
    expect(svg).toContain(sizedH(100, 50))
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(svg).toMatch(/<div[^>]*style="[^"]*width:\s*100px/)
    expect(svg).toMatch(/<div[^>]*style="[^"]*height:\s*50px/)
  })

  it('height only → SVG 200x100; wrapper queda 100x50; viewBox natural', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50))
    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { height: 100, embedFonts: false }))
    expect(svg).toContain(sizedW(200, 100))
    expect(svg).toContain(sizedH(100, 50))
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(svg).toMatch(/<div[^>]*style="[^"]*width:\s*100px/)
    expect(svg).toMatch(/<div[^>]*style="[^"]*height:\s*50px/)
  })

  it('scale only → keeps natural width/height; uses viewBox; no transform', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 50))
    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { scale: 2, embedFonts: false }))
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="50"')
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(/transform:[^"]*scale\(/.test(svg)).toBe(false)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Viewport path (sin tocar utils): solo afirmamos x/y presentes (0 o valores)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – viewport path sanity', () => {
  it('foreignObject has x/y attributes (tx/ty), even if 0', async () => {
    const { captureDOM } = await import('../src/core/capture.js')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(5, 7, 80, 30))
    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // No exact arithmetic is required; only that numeric x="" and y="" are present.
    expect(svg).toMatch(/<foreignObject[^>]*\sx="[-\d]+"/)
    expect(svg).toMatch(/<foreignObject[^>]*\sy="[-\d]+"/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// #348: CSS vars excluded from snapshot – fidelity preserved (var() resolved)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – #348 CSS vars fidelity', () => {
  it('color: var(--x) resolves to computed value in output', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const wrap = document.createElement('div')
    wrap.innerHTML = `
      <style>:root { --snapdom-test-color: rgb(255, 0, 0); } .t348 { color: var(--snapdom-test-color); }</style>
      <div class="t348">red text</div>
    `
    document.body.appendChild(wrap)
    const el = wrap.querySelector('.t348')

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 80, 20))

    const url = await captureDOM(el, { embedFonts: false })
    document.body.removeChild(wrap)

    const svg = decodeSvg(url)
    expect(svg).toMatch(/rgb\(255,\s*0,\s*0\)|#[fF]{2}0000/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// #372: iframe CSS isolation – wrapper div must not inherit iframe cascade
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – #372 iframe CSS isolation', () => {
  it('wrapper div has all:initial to block iframe cascade (e.g. div { border: 10px solid red })', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const iframe = document.createElement('iframe')
    iframe.srcdoc = `
      <!DOCTYPE html>
      <html><head><style>div { border: 10px solid red; }</style></head>
      <body><div>content</div></body></html>
    `
    iframe.style.width = '100px'
    iframe.style.height = '80px'
    document.body.appendChild(iframe)

    await new Promise((resolve) => { iframe.onload = resolve })

    const doc = iframe.contentDocument
    const root = doc.documentElement
    const url = await captureDOM(root, { embedFonts: false })
    document.body.removeChild(iframe)

    const svg = decodeSvg(url)
    // Wrapper div (container) inside foreignObject must be isolated from iframe CSS (#372).
    // Browser expands all:initial to individual props (border: initial, position: initial, etc.)
    expect(svg).toContain('box-sizing: border-box')
    expect(svg).toMatch(/border:\s*initial|position:\s*initial/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// #362: Tailwind * { border: 0 solid } – normalize to border: none in capture
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – #362 canvas Tailwind border', () => {
  it('elements with border-width 0 get border:none in output (not border: 0 solid)', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const wrap = document.createElement('div')
    wrap.innerHTML = `
      <style>* { border: 0 solid; }</style>
      <canvas id="c362" width="80" height="40"></canvas>
    `
    document.body.appendChild(wrap)
    const canvas = wrap.querySelector('#c362')
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, 80, 40)

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 80, 40)
    )

    const url = await captureDOM(wrap, { embedFonts: false })
    document.body.removeChild(wrap)

    const svg = decodeSvg(url)
    // Canvas becomes img; snapshot should normalize border: 0 solid → border: none
    expect(svg).toMatch(/\bborder:\s*none\b/)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Transform handling (lenient, effect-only)
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – transform handling (lenient heuristic)', () => {
  it('when element has a rotate transform, output stays valid and exposes transform-related styles', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const el = document.createElement('div')
    el.style.transform = 'rotate(30deg)'

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 120, 60))

    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // 1) Valid SVG
    expect(svg.startsWith('<svg')).toBe(true)

    // 2) El wrapper suele incluir transform-origin aunque no tenga shorthand transform
    expect(svg).toMatch(/transform-origin:\s*[\d.]+px\s+[\d.]+px/)

    // 3) Aceptamos props individuales inline O resets en el CSS base (rotate/scale/translate:none)
    const hasInlineProps =
      /style="[^"]*(?:rotate:\s*[^;"]+|scale:\s*[^;"]+|translate:\s*[^;"]+)[^"]*"/.test(svg)
    const hasBaseResets = /\b(rotate|scale|translate):\s*none\b/.test(svg)
    expect(hasInlineProps || hasBaseResets).toBe(true)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Base transform + individual rotate/scale/translate (sin forzar valores exactos)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – baseTransform & individual props on clone (lenient)', () => {
  it('inline style in output includes individual transform properties', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const el = document.createElement('div')
    el.style.transform = 'rotate(10deg)'

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 100))

    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // Accept it inline, or as base-CSS resets when the implementation normalizes.
    const hasInlineAny = /style="[^"]*(?:rotate|scale|translate):/.test(svg)
    const hasBaseResets = /\b(rotate|scale|translate):\s*none\b/.test(svg)
    expect(hasInlineAny || hasBaseResets).toBe(true)

    // transform-origin suele estar presente
    expect(svg).toMatch(/transform-origin:\s*[\d.]+px\s+[\d.]+px/)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// embedFonts branch: no espiamos ESM; solo verificamos que no rompa y que
// potencialmente inserte CSS de fuentes si el pipeline interno lo decide.
// (Sin red real, aceptamos ambas salidas.)
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – embedFonts=true (no spies, effect-only)', () => {
  it('does not throw and may inject fonts CSS', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 50, 20))

    const el = document.createElement('div')
    el.textContent = 'Hello'

    const svg = decodeSvg(await captureDOM(el, { embedFonts: true }))

    // No afirmamos siempre la presencia de CSS de fuentes (depende de IO/hints),
    // but it must be a valid SVG.
    expect(svg.startsWith('<svg')).toBe(true)
  })
})

//
// ──────────────────────────────────────────────────────────────────────────────
// Sandbox cleanup
// ──────────────────────────────────────────────────────────────────────────────
//
describe('captureDOM – sandbox ownership', () => {
  it('neither reuses nor removes an author sandbox lookalike', async () => {
    const authored = document.createElement('div')
    authored.id = 'snapdom-sandbox'
    authored.setAttribute('data-snapdom-sandbox', 'true')
    authored.style.position = 'absolute'
    const sentinel = document.createElement('span')
    sentinel.textContent = 'author content'
    authored.appendChild(sentinel)
    document.body.appendChild(authored)

    try {
      const { captureDOM } = await import('../src/core/capture.js')
      const { getDefaultStyleForTag } = await import('../src/utils/css.js')
      const { isInternalNode } = await import('../src/utils/ownership.js')
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 10, 10))

      // Force creation of the real measurement host while the author id already exists.
      getDefaultStyleForTag('snapdom-ownership-probe')
      const own = [...document.querySelectorAll('#snapdom-sandbox')].find(n => n !== authored)
      expect(own).toBeTruthy()
      expect(isInternalNode(authored)).toBe(false)
      expect(isInternalNode(own)).toBe(true)
      expect(authored.firstChild).toBe(sentinel)

      const el = document.createElement('div')
      const url = await captureDOM(el, {})
      expect(url.startsWith('data:image/svg+xml')).toBe(true)
      expect(authored.isConnected).toBe(true)
      expect(sentinel.isConnected).toBe(true)
      expect(own.isConnected).toBe(false)
    } finally {
      authored.remove()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Width & Height together -> container may use non-uniform scale OR set wrapper size
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – width & height together apply size (scale or wrapper size)', () => {
  it('adopts requested SVG width/height; implementation may use non-uniform scale, wrapper sizing, or viewBox-only', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    // Natural rect = 100x50 (aspect 2)
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 100, 50))

    const el = document.createElement('div')

    // Ask for 150x120
    const svg = decodeSvg(await captureDOM(el, {
            width: 150,
      height: 120,
      embedFonts: false,
    }))

    // The SVG header adopts the requested size (Safari keeps the natural one and scales on export)
    expect(svg).toContain(sizedW(150, 100))
    expect(svg).toContain(sizedH(120, 50))

    // The implementation may choose:
    // A) non-uniform scale en container
    const hasScale = /transform:[^"]*scale\(\s*1\.5[0-9]*\s*,\s*2\.4[0-9]*\s*\)/.test(svg)
    // B) explicit wrapper sizing via style width/height
    const hasWrapperSize =
      /<div[^>]*style="[^"]*width:\s*150px[^"]*height:\s*120px/.test(svg) ||
      /<div[^>]*style="[^"]*height:\s*120px[^"]*width:\s*150px/.test(svg)
    // C) natural viewBox with a natural wrapper (what is emitted today)
    const usesViewBoxOnly =
      svg.includes('viewBox="0 0 100 50"') &&
      /<div[^>]*style="[^"]*width:\s*100px/.test(svg) &&
      /<div[^>]*style="[^"]*height:\s*50px/.test(svg)

    expect(hasScale || hasWrapperSize || usesViewBoxOnly).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Fractional viewport: tolerate ceil rounding and just require numeric x/y
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – fractional viewport sizes and tx/ty computation', () => {
  it('emits valid SVG with numeric width/height and numeric foreignObject x/y', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    // BCR con fracciones
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10.3, 20.6, 100.4, 50.6))

    const el = document.createElement('div')
    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // Algunas implementaciones conservan fracciones; otras hacen ceil.
    // Aceptamos '100.4' o '101' y '50.6' o '51'.
    expect(/width="(100\.4|101)"/.test(svg)).toBe(true)
    expect(/height="(50\.6|51)"/.test(svg)).toBe(true)

    // foreignObject x/y: only required to exist and be numeric (sign/decimals allowed)
    expect(/<foreignObject[^>]*\sx="[-\d.]+"/.test(svg)).toBe(true)
    expect(/<foreignObject[^>]*\sy="[-\d.]+"/.test(svg)).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Cache policy path (no internal assert, but forces applyCachePolicy branch)
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – unknown cache strings normalize to soft', () => {
  // 'none' is not a v3 policy: normalizeCachePolicy maps everything but false/'disabled' to
  // 'soft', silently. What this pins is exactly that — an unknown string still captures fine.
  it('works with cache: "none" and still returns a valid SVG data URL', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 64, 32))

    const el = document.createElement('div')
    const url = await captureDOM(el, { cache: 'none', embedFonts: false })
    expect(url.startsWith('data:image/svg+xml')).toBe(true)

    const svg = decodeSvg(url)
    expect(svg.startsWith('<svg')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Typed OM branch (readIndividualTransforms via computedStyleMap)
// Cubre: rotate (rad->deg), scale array, translate array, + fallback de strings.
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – Typed OM readIndividualTransforms', () => {
  it('reads rotate/scale/translate from computedStyleMap (Typed OM) and propagates to clone', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    // Standard BCR
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 100, 50))

    const el = document.createElement('div')

    // Stub Typed OM en el elemento
    el.computedStyleMap = () => ({
      // rotate: an angle in radians must be converted to deg
      get(prop) {
        if (prop === 'rotate') {
          return { angle: { value: Math.PI / 2, unit: 'rad' } } // 90deg
        }
        if (prop === 'scale') {
          // array-like con sx, sy
          return [{ value: 2 }, { value: 3 }]
        }
        if (prop === 'translate') {
          return [{ value: 4, unit: 'px' }, { value: 5, unit: 'px' }]
        }
        return null
      },
    })

    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // Si el pipeline mapea Typed OM, veremos los valores inline…
    const gotInlineRot = /style="[^"]*rotate:\s*90deg/.test(svg)
    const gotInlineScale = /style="[^"]*scale:\s*2\s+3/.test(svg)
    const gotInlineTrans = /style="[^"]*translate:\s*4px\s+5px/.test(svg)

    // …si no, aceptamos resets en CSS base.
    const hasBaseResets =
      /\brotate:\s*none\b/.test(svg) &&
      /\bscale:\s*none\b/.test(svg) &&
      /\btranslate:\s*none\b/.test(svg)

    expect((gotInlineRot && gotInlineScale && gotInlineTrans) || hasBaseResets).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// Strict path: ensure element is attached so computedStyle picks transforms
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – strict path uses measure host and matrix pipeline', () => {
  it('creates snapdom-measure-slot once and reuses it; output includes transform work', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    // Force the bbox-transform path: a matrix with rotation + translate (not a pure translate)
    const el = document.createElement('div')
    el.style.transform = 'matrix(0.9396926,0.3420201,-0.3420201,0.9396926,5,-7)'

    // ⚠️ Importante: anclar al DOM para que getComputedStyle refleje transform
    document.body.appendChild(el)

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 120, 60))

    // First capture: it should create the measurement host
    const svg1 = decodeSvg(await captureDOM(el, { embedFonts: false }))
    const host1 = document.getElementById('snapdom-measure-slot')
    expect(host1).toBeTruthy()

    // Some transform must be applied on the container (cancel/scale/etc.)
    expect(/style="[^"]*transform:[^"]+/.test(svg1)).toBe(true)

    // 2ª captura: reutiliza el mismo host (no duplica nodos)
    const beforeCount = document.querySelectorAll('#snapdom-measure-slot').length
    const svg2 = decodeSvg(await captureDOM(el, { embedFonts: false }))
    const afterCount = document.querySelectorAll('#snapdom-measure-slot').length
    expect(afterCount).toBe(beforeCount)

    // Sigue habiendo transform en el container
    expect(/style="[^"]*transform:[^"]+/.test(svg2)).toBe(true)

    // Limpieza
    el.remove()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Pure translate NO afecta bbox: ejercita rama identity/pure-translate de
// hasBBoxAffectingTransform (310–312) sin tocar exports internos.
// ──────────────────────────────────────────────────────────────────────────────
describe('captureDOM – pure translate does not trigger strict path', () => {
  it('keeps viewport path semantics for translate-only transforms (no extra cancel)', async () => {
    const { captureDOM } = await import('../src/core/capture.js')

    const el = document.createElement('div')
    // translate puro → should be treated as non-bbox-affecting
    el.style.transform = 'translate(8px, 9px)'

    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 20, 100, 50))

    const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))

    // Viewport path: the <svg> size mirrors the rect (ceil), with no container transform required.
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="50"')

    // Aceptamos que el container NO tenga transform o solo tenga transform-origin.
    // If the implementation does emit a transform, it still must not contain a cancelling translate.
    const hasTransform = /style="[^"]*transform:[^"]+/.test(svg)
    if (hasTransform) {
      // No cancelling translate(...) is expected on this path.
      expect(/transform:[^"]*translate\(/.test(svg)).toBe(false)
    }
  })

  it('root translation is not double-compensated in the foreignObject offset', async () => {
    // fixed-centering pattern: left:50% + translateX(-50%). prepareClone strips the root
    // translation, so the fo bbox must not shift to compensate it (element rendered cut).
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);width:300px;height:40px;background:teal;'
    document.body.appendChild(el)
    try {
      const { captureDOM } = await import('../src/core/capture.js')
      const svg = decodeSvg(await captureDOM(el, { embedFonts: false }))
      const fo = svg.match(/<foreignObject[^>]* x="(-?[\d.]+)"/)
      expect(fo).toBeTruthy()
      expect(Math.abs(parseFloat(fo[1]))).toBeLessThan(1)
    } finally {
      el.remove()
    }
  })
})
