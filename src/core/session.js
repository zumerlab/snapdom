/**
 * Per-capture session state. A capture OWNS its session from its first synchronous tick; only
 * cross-capture caches (cache.js) live at module scope, since the shared `cache.session`
 * global was #463 and the double scroll-compensation race. Not here: options (context.js),
 * plugin stage fields, return values, arguments, burst's per-element state and RetainedCapture.
 *
 * Burst creates it for a full run it starts, snapdom.capture otherwise; diff.js builds a
 * frame's over burst's retained capture. The factory is pure: captureDOM applies the cache policy.
 *
 * A ClonePass is one clone attempt; every memo of the clone walk lives and dies with it. Never
 * name a slot `session`: _resolveCtx (styles.js) tells a styles ctx from a pass by that key.
 *
 * `context.__session` aliases a full capture's session (captureDOM); nothing in src reads it.
 * Readers: packages/vector/src/adapters/snapdom.js and __tests__/core.capture.fast.test.js.
 * @module session
 */

/**
 * @typedef {object} CaptureSession
 * @property {Map<Element, string>} styleMap - clone to style signature
 * @property {WeakMap<Element, CSSStyleDeclaration>} styleCache - source to computed style
 * @property {Map<Node, Node>} nodeMap - clone to source (clone.js contract)
 * @property {Array<{code: string, message: string, detail?: unknown}>|null} warnings -
 *   result.warnings (image placeholder, raster clamp, Safari PNG fallback, reconcile risk);
 *   null on a differential frame
 * @property {Array<(node: Node, ctx: object) => any>|null} resolveNodeHooks - collected
 *   by captureDOM at its entry; null on a differential frame, which bails on them
 * @property {Map<Element, Set<string>>|null} animated - animatedProps
 *   (styles.js), by captureDOM before the clone and kept on the torn retry; burst's on a frame
 * @property {boolean|undefined} styleShare - seeded from `__styleShare`,
 *   by captureDOM after beforeClone, kept on the torn retry; a frame keeps the seed (sharing off)
 * @property {{due: () => boolean, pause: () => Promise<void>, yielded: boolean}|null} slicer -
 *   fast: false | 'auto' (#503), by captureDOM per clone attempt; null on the torn retry, after
 *   the clone stage and on a frame
 * @property {{required: Set<string>, usedCodepoints: Set<number>}|null} fontUsage - walked by
 *   the Safari pre-step (snapdom.capture), reused by captureDOM's fonts phase when there is no clip
 * @property {(() => boolean)|null} tornSinceStart - burst's watcher, set for a full
 *   run it starts and nulled in its finally; captureDOM asks it after a yielding clone
 * @property {[number, number]|null} rootBox - the root's offset size while prepareClone
 *   held content-visibility:auto boxes visible; null when it forced none and on a frame
 * @property {((art: object) => void)|null} retain - burst's hand-off for the diff
 *   path, set on a run that may become the memo; captureDOM calls it after the svg render
 *
 * Compress outputs (compressCloneAssets); a frame starts from burst's retained capture.
 * @property {WeakMap<Node, {token: string, properties: object[]}>|null|undefined} compressedAssets -
 *   originals of the shrunk assets; buildResult nulls it, the registry stays with burst
 * @property {number|undefined} compressionDensity - the output density compress resolved
 * @property {Map<string, ReadonlyArray<object>>|null} compressedSnapshot - originals still in
 *   the rendered clone, kept by the result for exports that need more resolution
 *
 * Render outputs, written by the engine (svg.js, htmlInCanvas.js), read by buildResult.
 * @property {number} layoutZoom - the #508 grid, into ExportEnv
 * @property {{zoomed: string[], flat: string[]}|null} fileSvg - the #552
 *   wrappers, when layoutZoom is not 1
 * @property {{classCSS: string, fontsCSS: string, baseCSS: string, scrollbarCSS: string}|null} artifacts -
 *   `ctx.artifacts` for export plugins
 */

/**
 * Creates the session of one run of the pipeline.
 * @param {object} [options] - the context; only its `__styleShare` override is read
 * @param {{styleMap: Map<Element, string>, styleCache: WeakMap<Element, CSSStyleDeclaration>, nodeMap: Map<Node, Node>, compressedAssets?: WeakMap<Node, object>|null, compressionDensity?: number}|null} [retained]
 *   burst's retained capture, which a differential frame grows in place
 * @returns {CaptureSession}
 */
export function createCaptureSession(options = {}, retained = null) {
  return {
    styleMap: retained ? retained.styleMap : new Map(),
    styleCache: retained ? retained.styleCache : new WeakMap(),
    nodeMap: retained ? retained.nodeMap : new Map(),
    warnings: retained ? null : [],
    resolveNodeHooks: null,
    animated: null,
    styleShare: options.__styleShare,
    slicer: null,
    fontUsage: null,
    tornSinceStart: null,
    retain: null,
    rootBox: null,
    compressedAssets: retained ? retained.compressedAssets : null,
    compressionDensity: retained ? retained.compressionDensity : undefined,
    compressedSnapshot: null,
    layoutZoom: 1,
    fileSvg: null,
    artifacts: null,
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
 * @property {CaptureSession['warnings']} warnings - written by clone.js and pseudo.js
 * @property {CaptureSession['styleShare']} styleShare - read by inlineAllStyles,
 *   pseudoSnapshotFor and rasterizeIframe (for the nested capture)
 * @property {CaptureSession['resolveNodeHooks']} resolveNodeHooks - read by deepClone, per node
 * @property {CaptureSession['animated']} animated - read by inlineAllStyles
 * @property {CaptureSession['slicer']} slicer - read by deepClone, prepareClone and
 *   inlinePseudoElements
 *
 * Written by prepareClone before deepClone. Null on a diff pass.
 * @property {{rect: DOMRect, root: Element, husks?: object[], filterReach?: WeakMap<Element, object>, inkReach?: WeakMap<Element, object>}|null} clip
 * @property {object|null} selection
 *
 * Shadow DOM (#558), written and read by deepClone.
 * @property {WeakMap<ShadowRoot, string>|null} shadowScopes
 * @property {WeakMap<ShadowRoot, boolean>|null} shadowShare - roots whose CSS cannot split
 *   identity twins, and whether it gives a margin or padding a box-relative value
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
 * Creates one clone attempt of a run. Each initial value is its reader's empty case, so a
 * declared slot behaves like an unfilled one.
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
    resolveNodeHooks: run.resolveNodeHooks,
    animated: run.animated,
    slicer: run.slicer,
    clip: null,
    selection: null,
    shadowScopes: null,
    shadowShare: null,
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
