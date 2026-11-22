/**
 * @zumer/snapdom-vector
 * Editable SVG and Figma clipboard export for SnapDOM: `vector()` adds `toVector()` and `toFigma()`.
 *
 *   import { vector } from '@zumer/snapdom-vector'
 *
 * Up to @zumer/snapdom-plugins 4.x the same exporter shipped at that package's `/vector` subpath.
 *
 * This file is what a `…/index.js` URL has always pointed at, and it still resolves: it
 * re-exports the built bundle (`node build.mjs`, run by `prepack`). The source entry is
 * `src/public.js`; the suites and the demos import that one.
 */
export { default, vector } from './dist/snapdom-vector.mjs'
