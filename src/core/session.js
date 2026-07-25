/**
 * Per-capture session state.
 *
 * A capture OWNS its session from its first synchronous tick: nothing in the pipeline may
 * read the mutable `cache.session` global after an await, because a concurrently started
 * capture reassigns it (the mechanism behind #463 and the double scroll-compensation race).
 * Module-level mutable state is reserved for genuine cross-capture caches (cache.js);
 * everything scoped to one capture lives on the object created here and is threaded
 * explicitly through every stage.
 * @module session
 */
import { cache, applyCachePolicy } from './cache.js'

/**
 * Creates this capture's session in the same synchronous tick that applies the cache
 * policy. applyCachePolicy still refreshes the legacy `cache.session` bucket for direct
 * callers (preCache, tests); the capture itself only trusts the references captured here.
 * @param {"soft"|"auto"|"full"|"disabled"} [policy]
 * @returns {{styleMap: Map, styleCache: WeakMap, nodeMap: Map}}
 */
export function createCaptureSession(policy) {
  applyCachePolicy(policy)
  return {
    styleMap: cache.session.styleMap,
    styleCache: cache.session.styleCache,
    nodeMap: cache.session.nodeMap
  }
}
