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
 * A ClonePass is one clone attempt of a run: prepareClone makes one per attempt, diff.js one
 * per dirty root and one for its reconcile. Every memo of the clone walk lives and dies with
 * it. createClonePass declares every slot, so a pass keeps one shape however the walk fills it.
 *
 * `context.__session` is an ALIAS of the session of a full capture, set by captureDOM.
 * Published reader: packages/vector/src/adapters/snapdom.js (styleMap, in beforeRender).
 *
 * Never name a ClonePass slot `session` or `persist`: _resolveCtx (styles.js) tells a ready
 * styles ctx from a pass by those two keys.
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

/**
 * @typedef {object} ClonePass
 *
 * Copied from the run at creation, never written while the pass runs.
 * @property {object} options - the context, for debugWarn
 * @property {Map<Element, string>} styleMap
 * @property {WeakMap<Element, CSSStyleDeclaration>} styleCache
 * @property {Map<Node, Node>} nodeMap - the run's map, or a fresh delta for a diff root
 * @property {CaptureSession['warnings']} warnings
 * @property {boolean|undefined} styleShare
 * @property {Array<Function>|null} resolveNodeHooks - declared null; deepClone reads the
 *   context's `__resolveNodeHooks`
 * @property {Map<Element, Set<string>>|null} animated - declared null; inlineAllStyles reads
 *   the context's `__animated`
 * @property {{due: () => boolean, pause: () => Promise<void>, yielded: boolean}|null} slicer -
 *   fast: false | 'auto' (#503); prepareClone sets it, a diff pass keeps null
 *
 * Written by prepareClone before deepClone. Null on a diff pass.
 * @property {{rect: DOMRect, root: Element, husks?: object[], filterReach?: WeakMap<Element, object>, inkReach?: WeakMap<Element, object>}|null} clip
 * @property {object|null} selection
 *
 * Shadow DOM (#558), written and read by deepClone.
 * @property {WeakMap<ShadowRoot, string>|null} shadowScopes
 * @property {WeakMap<object, string>|null} shadowSheets
 * @property {Array<Map<string, object>>|null} shadowGroups
 * @property {number} shadowScopeSeq
 * @property {boolean} shadowPseudo - read by inlinePseudoElements and canSkipPseudoWalk
 *
 * Pseudo pass.
 * @property {string} pseudoCSS - scoped ::marker and ::first-line rules
 * @property {number} pseudoRuleSeq
 * @property {object|null} counterCtx
 * @property {WeakMap<Element, Map<string, number>>|null} siblingCounters
 * @property {boolean} usesPlaceholder
 *
 * Style memos (styles.js).
 * @property {object|null} scan - the author-style scan pinned for the pass (#554)
 * @property {number|null} scanEnv - env epoch of `scan`
 * @property {{universe: Set<string>, roots: Set<ShadowRoot>}|null|undefined} shadowUniverse -
 *   undefined unbuilt, null reads every property
 * @property {object|null} share - identity-share tables
 * @property {WeakSet<Element>|null} oneLine
 * @property {WeakMap<Element, string>|null} axes
 * @property {WeakMap<Element, boolean>|null} flexOverflow
 * @property {object|null} stylesCtx - the one inlineAllStyles ctx of the pass
 * @property {object|null|undefined} stylesCtxOpts - the options stylesCtx was built for
 * @property {boolean} bumpedForDisabled - cache: 'disabled' bumped the epoch once for this pass
 *
 * Outputs prepareClone reads after the walk.
 * @property {Array<[Element, Element]>|null} bgClipText - Firefox gradient-text pairs (#530)
 * @property {number} reconcileRisk
 */

/**
 * Creates one clone attempt of a run. Every initial value reads as its reader's empty case
 * (`||`, `??`, `?.` or truthiness), so a lazily filled pass and a declared one behave alike.
 * @param {CaptureSession} run
 * @param {object} options - the context
 * @param {Map<Node, Node>} nodeMap - run.nodeMap, or a fresh delta for a diff root
 * @returns {ClonePass}
 */
export function createClonePass(run, options, nodeMap) {
  return {
    options,
    styleMap: run.styleMap,
    styleCache: run.styleCache,
    nodeMap,
    warnings: run.warnings,
    styleShare: run.styleShare,
    resolveNodeHooks: null,
    animated: null,
    slicer: null,
    clip: null,
    selection: null,
    shadowScopes: null,
    shadowSheets: null,
    shadowGroups: null,
    shadowScopeSeq: 0,
    shadowPseudo: false,
    pseudoCSS: '',
    pseudoRuleSeq: 0,
    counterCtx: null,
    siblingCounters: null,
    usesPlaceholder: false,
    scan: null,
    scanEnv: null,
    // undefined, not null: shadowUniverseOf reads null as "read every property".
    shadowUniverse: undefined,
    share: null,
    oneLine: null,
    axes: null,
    flexOverflow: null,
    stylesCtx: null,
    stylesCtxOpts: null,
    bumpedForDisabled: false,
    bgClipText: null,
    reconcileRisk: 0,
  }
}
