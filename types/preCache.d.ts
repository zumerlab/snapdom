/**
 * Types for the `@zumer/snapdom/preCache` subpath.
 *
 * A re-export stub, exactly like dist/preCache.mjs: one runtime, one set of declarations.
 * This has to be its OWN file — the previous `declare module "@zumer/snapdom/preCache"`
 * block inside snapdom.d.ts was a module AUGMENTATION (the file is already a module), and
 * TypeScript rejects augmenting a specifier it cannot resolve: TS2665 in every consumer
 * that did not have `skipLibCheck: true` hiding it.
 */

export { preCache } from './snapdom.js'
export type { PreCacheOptions, LocalFont } from './snapdom.js'
