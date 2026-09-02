/**
 * Per-capture session state.
 *
 * A capture OWNS its session from its first synchronous tick. The old mutable
 * `cache.session` global (the mechanism behind #463 and the double scroll-compensation
 * race) is gone: the shared-session race class is structurally unrepresentable now.
 * Module-level mutable state is reserved for genuine cross-capture caches (cache.js);
 * everything scoped to one capture lives on the object created here and is threaded
 * explicitly through every stage.
 * @module session
 */
import { applyCachePolicy } from './cache.js'

/**
 * Creates this capture's session in the same synchronous tick that applies the cache
 * policy. There is no shared session global anymore — every capture owns fresh maps.
 * @param {"soft"|"disabled"} [policy] - already normalized by createContext; 'soft' is the only non-disabled value
 * @returns {{styleMap: Map, styleCache: WeakMap, nodeMap: Map}}
 */
export function createCaptureSession(policy) {
  applyCachePolicy(policy)
  return {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
    // Degradation log for THIS capture: {code, message, detail?} entries pushed by the
    // curated failure branches (image→placeholder, raster clamp, Safari PNG fallback,
    // reconcile risk). Exposed as result.warnings — empty in the common case.
    warnings: []
  }
}
