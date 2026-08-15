/**
 * Types for the `@zumer/snapdom/plugins` subpath.
 *
 * A re-export stub, exactly like dist/plugins.mjs: the subpath and the root resolve to the
 * same runtime, so they must resolve to the same declarations too. See preCache.d.ts for
 * why this is a separate file and not a `declare module` block.
 */

export {
  registerPlugins,
  clearPlugins,
  getGlobalPlugins,
  normalizePlugin,
  STAGES,
  DEFAULT_STAGE,
  assertNeeds,
} from './snapdom.js'

export type {
  SnapdomPlugin,
  PluginUse,
  CaptureStage,
} from './snapdom.js'
