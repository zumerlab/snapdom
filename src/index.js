/**
 * ESM entry. What is exported here is the whole public surface of `@zumer/snapdom`.
 *
 * @file index.js
 */

export { snapdom } from './api/snapdom.js'
export { preCache } from './api/preCache.js'

// The public plugin API lives here too, so `@zumer/snapdom` and `@zumer/snapdom/plugins`
// are ONE runtime: the subpath builds are re-export stubs pointing back at this bundle,
// which is what keeps the plugin registry and the caches single instances. Building the
// subpaths separately gave each its own module state, so a plugin registered through the
// subpath was invisible to snapdom() and preCache warmed a cache nothing read.
export { registerPlugins, clearPlugins, getGlobalPlugins, normalizePlugin, STAGES, DEFAULT_STAGE, assertNeeds } from './core/plugins.js'
