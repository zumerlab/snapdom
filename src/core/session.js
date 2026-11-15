/**
 * Per-capture session state.
 *
 * A capture OWNS its session from its first synchronous tick. The old mutable
 * `cache.session` global (the mechanism behind #463 and the double scroll-compensation
 * race) is gone: the shared-session race class is structurally unrepresentable now.
 * Module-level mutable state is reserved for genuine cross-capture caches (cache.js);
 * everything scoped to one capture lives on the object created here and is threaded
 * explicitly through every stage.
 *
 * The session is an argument: snapdom.capture creates it and hands it to captureDOM, which
 * hands it to prepareClone; direct callers of either get one from a default parameter.
 * A differential frame (diff.js) gets its own, built over burst's retained capture, and
 * hands it to buildResult as the full path does.
 * The factory is pure: captureDOM applies the cache policy at its entry and on the torn
 * retry, the two ticks the factory used to apply it in.
 *
 * `context.__session` is an ALIAS of the session of a full capture, set by captureDOM.
 * Published reader: packages/vector/src/adapters/snapdom.js (styleMap, in beforeRender).
 * @module session
 */

/**
 * @typedef {object} CaptureSession
 * @property {Map<Element, string>} styleMap - clone to style signature
 * @property {WeakMap<Element, CSSStyleDeclaration>} styleCache - source to computed style
 * @property {Map<Node, Node>} nodeMap - clone to source (clone.js contract)
 * @property {Array<{code: string, message: string, detail?: unknown}>|null} warnings - the
 *   degradation log, exposed as result.warnings: entries pushed by the curated failure
 *   branches (image placeholder, raster clamp, Safari PNG fallback, reconcile risk). Null on
 *   a differential frame, which keeps no log.
 * @property {boolean|undefined} styleShare - the identity-share verdict, seeded with the
 *   context's `__styleShare` override
 */

/**
 * Creates the session of one run of the pipeline.
 * @param {object} [options] - the context; only its `__styleShare` override is read
 * @param {{styleMap: Map<Element, string>, styleCache: WeakMap<Element, CSSStyleDeclaration>, nodeMap: Map<Node, Node>}|null} [retained]
 *   burst's retained capture, for a differential frame: the frame grows its maps and keeps no log
 * @returns {CaptureSession}
 */
export function createCaptureSession(options = {}, retained = null) {
  return {
    styleMap: retained ? retained.styleMap : new Map(),
    styleCache: retained ? retained.styleCache : new WeakMap(),
    nodeMap: retained ? retained.nodeMap : new Map(),
    warnings: retained ? null : [],
    styleShare: options.__styleShare,
  }
}
