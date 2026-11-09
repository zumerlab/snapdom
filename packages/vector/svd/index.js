/**
 * SVD — Scalable Vector Document.
 *
 * The contract between the capture engine and every editor backend. The engine
 * emits SVD; each backend is a pure `SVD -> output` function with no DOM, no
 * `getComputedStyle`, no measuring. If a backend needs to measure something,
 * the schema is missing a field — extend the schema, never measure downstream.
 *
 * Invariants (normative — a document violating any of these is a bug):
 *
 *  1. Units are CSS pixels, unrounded floats. Rounding belongs to the emitter.
 *     Angles are degrees, clockwise.
 *  2. `frame` is relative to the emitted parent. `abs` is relative to the
 *     border box of the capture root, Y down. Both are always present: `abs`
 *     survives reparenting and is what the test harness asserts against.
 *  3. `children` is in DOM containment order. `paint.z` carries the back-to-front
 *     order. The backend sorts by `paint.z`; it never re-derives it.
 *  4. Colors are `[r, g, b, a]` floats 0..1 in sRGB, plus `srcCss` for round-trip.
 *  5. `blur` is the CSS blur radius. SVG sigma is `blur / 2`. Stated once, here.
 *  6. Gradient geometry is normalized to the unit square with a 2x3 matrix.
 *     Never percentages — that is the documented origin of Figma's
 *     "failed to invert transform" on SVG import.
 *  7. Nothing relative, nothing external: assets are embedded or referenced by
 *     local id.
 *  8. A document that degraded something without saying so in `diagnostics` is
 *     a bug. That rule outranks the rest of the schema.
 */

export const SVD_VERSION = 'svd/1.0'

/** @typedef {'frame'|'group'|'shape'|'text'|'image'|'vector'} NodeType */
export const NODE_TYPES = ['frame', 'group', 'shape', 'text', 'image', 'vector']

/**
 * Fidelity grades. Every node carries one; anything but `E` must have a
 * matching entry in `diagnostics`.
 *
 *  E  exact        — the target primitive reproduces the CSS with no loss
 *  A  approximate  — parametric, visually equivalent within tolerance
 *  C  composed     — one CSS declaration became N primitives
 *  R  raster       — rasterized, with the reason recorded
 *  RH raster hybrid — background rasterized, vector content kept on top
 *  O  omitted      — could not be represented; placeholder emitted
 */
export const FIDELITY = ['E', 'A', 'C', 'R', 'RH', 'O']

export { validate, validateNode } from './schema.js'

/** Empty document with every required top-level key present. */
export function emptyDocument (capture = {}) {
  return {
    schema: SVD_VERSION,
    generator: { name: '@zumer/snapdom-vector', version: '0.0.1', engine: 'dom' },
    capture: {
      url: '', selector: '', capturedAt: '',
      viewport: { w: 0, h: 0, dpr: 1 },
      docOrigin: { x: 0, y: 0 },
      root: { w: 0, h: 0 },
      conventions: {
        units: 'px', y: 'down', angle: 'deg-cw',
        colorSpace: 'srgb', blur: 'css-radius',
      },
      ...capture,
    },
    assets: {},
    styles: { text: {} },
    root: null,
    nodes: {},
    diagnostics: [],
    report: {},
  }
}
