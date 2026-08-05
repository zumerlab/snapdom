/**
 * @typedef {"disabled"|"full"|"auto"|"soft"} CachePolicy
 */

import { normalizeCachePolicy } from './cache.js'

/**
 * Creates a normalized capture context for SnapDOM.
 * @param {Object} [options={}]
 * @param {boolean} [options.debug]
 * @param {number}  [options.scale]
 * @param {string|((el: Element) => boolean)|Array<string|((el: Element) => boolean)>} [options.exclude] - Selectors and/or predicates (true = exclude)
 * @param {string}  [options.excludeMode]
 * @param {(node: Node)=>boolean} [options.filter]
 * @param {string}  [options.filterMode]
 * @param {boolean|'auto'} [options.embedFonts]
 * @param {string|string[]} [options.iconFonts]
 * @param {string[]} [options.localFonts]
 * @param {string[]|undefined} [options.excludeFonts]
 * @param {string[]} [options.fontStylesheetDomains]      // extra domains to fetch cross-origin CSS from (#309)
 * @param {string|function} [options.fallbackURL]
 * @param {string}  [options.useProxy]
 * @param {number|null} [options.width]
 * @param {number|null} [options.height]
 * @param {"png"|"jpg"|"jpeg"|"webp"|"svg"} [options.format]
 * @param {"svg"|"img"|"canvas"|"blob"} [options.type]
 * @param {number}  [options.quality]
 * @param {number}  [options.dpr]
 * @param {string|null} [options.backgroundColor]
 * @param {string}  [options.filename]
 * @param {unknown} [options.cache] // "disabled"|"full"|"auto"|"soft"
 * @param {boolean} [options.outerTransforms] // NEW
 * @param {boolean} [options.outerShadows]      // NEW
 * @param {"viewport"|{x:number,y:number,width:number,height:number}|null} [options.clip] - Capture only a region: 'viewport' (what the user currently sees) or a page-coordinate rect. Offscreen subtrees are pruned before styling/inlining, so this is faster than a full capture.
 * @param {RegExp|((prop: string) => boolean)} [options.excludeStyleProps] - Skip props when snapshotting (#348). e.g. /^--/ to exclude CSS vars
 * @param {boolean} [options.compress] - Downsample inlined raster images to their visible resolution (display box × scale × dpr), preserving the source codec. On by default; pass `false` to embed images verbatim.
 * @returns {Object}
 */
/** Formats a caller can name in `format` (or legacy `type`). Shared with the export
 *  normalizer in snapdom.js — the same set decides the alias there. */
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'svg'])

export function createContext(options = {}) {
  let resolvedFormat = options.format ?? 'png'
  if (resolvedFormat === 'jpg') resolvedFormat = 'jpeg'
  // Did the CALLER name a format, or is this the default? `format` is always set, so the
  // difference is otherwise unrecoverable downstream — and toBlob needs it: it defaults to
  // the raw vector unless a codec was asked for, and `snapdom.toBlob(el, {format:'png'})`
  // asks at CAPTURE time (the static helpers forward options there, not to the exporter).
  const rawTypeFormat = typeof options.type === 'string' && IMAGE_FORMATS.has(options.type.toLowerCase())
    ? options.type.toLowerCase()
    : null
  const explicitFormat = options.format != null ? resolvedFormat : (rawTypeFormat === 'jpg' ? 'jpeg' : rawTypeFormat)
  /** @type {CachePolicy} */
  const cachePolicy = normalizeCachePolicy(options.cache)

  // v3: ONE decision, one pair of options. `exclude` accepts selectors and/or predicates
  // ((el) => true EXCLUDES it, matching the option's name) in any mix; `excludeMode`
  // says how excluded nodes leave ('hide' spacer | 'remove'). `filter` (keep-polarity)
  // and `filterMode` stay as silent legacy aliases — filter's polarity flips at this
  // boundary and both mechanisms compose when passed together. Split ONCE here so the
  // per-node hot loop never typeof-dispatches.
  const excludeRaw = options.exclude == null ? [] : (Array.isArray(options.exclude) ? options.exclude : [options.exclude])
  const excludeSelectors = []
  const excludePredicates = []
  for (const e of excludeRaw) {
    if (typeof e === 'string') excludeSelectors.push(e)
    else if (typeof e === 'function') excludePredicates.push(e)
    else if (e != null) console.warn('[snapdom] Ignored invalid exclude entry (expected selector string or predicate):', e)
  }
  const excludeMode = options.excludeMode ?? options.filterMode ?? 'hide'

  return {
    // Debug & perf
    debug: options.debug ?? false,
    scale: options.scale ?? 1,

    // DOM filters (see the exclude unification above)
    exclude: excludeSelectors,
    excludePredicates: excludePredicates.length ? excludePredicates : null,
    excludeMode,
    filter: options.filter ?? null,
    filterMode: options.filterMode ?? excludeMode,

    // Placeholders
    placeholders: options.placeholders !== false, // default true

    // Fonts
    // 'auto' (default): embed webfonts only when the element actually uses families the
    // document declares — svg-as-image is an isolated document that can't see page fonts,
    // so skipping the embed on webfont text is silent infidelity; system-font pages skip
    // the whole phase at zero cost. true/false remain explicit overrides.
    embedFonts: options.embedFonts ?? 'auto',
    iconFonts: Array.isArray(options.iconFonts) ? options.iconFonts
      : (options.iconFonts ? [options.iconFonts] : []),
    localFonts: Array.isArray(options.localFonts) ? options.localFonts : [],
    excludeFonts: options.excludeFonts ?? undefined,
    fontStylesheetDomains: Array.isArray(options.fontStylesheetDomains) ? options.fontStylesheetDomains : [],
    fallbackURL: options.fallbackURL ?? undefined,

    /** @type {CachePolicy} */
    cache: cachePolicy,

    // Network
    useProxy: typeof options.useProxy === 'string' ? options.useProxy : '',

    // Output
    width: options.width ?? null,
    height: options.height ?? null,
    format: resolvedFormat,
    __explicitFormat: explicitFormat,
    type: options.type ?? 'svg',
    quality: options.quality ?? 0.92,
    dpr: options.dpr ?? (window.devicePixelRatio || 1),
    backgroundColor:
      options.backgroundColor ?? (['jpeg', 'webp'].includes(resolvedFormat) ? '#ffffff' : null),
    filename: options.filename ?? 'snapDOM',

    // NEW flags (user-friendly)
    outerTransforms: options.outerTransforms ?? true,
    outerShadows: options.outerShadows ?? false,

    // Layout reconciliation: measure the styled clone in-document and pin diverging boxes
    // to their live size. Opt-in (adds one in-document layout of the clone).
    reconcile: options.reconcile ?? false,

    // Burst memoization is default engine behavior (auto-engages on repeat captures, see
    // src/core/burst.js). true/false remain INTERNAL-ONLY escapes (tests/benchmarks need
    // deterministic full-pipeline runs), not public API.
    burst: options.burst,

    // EXPERIMENTAL: 'canvas' opts into the WICG canvas-place-element engine when the browser
    // supports it (see src/engines/htmlInCanvas.js); anything else uses the svg pipeline.
    engine: options.engine,
    // Forces one fresh, non-memoized capture — for changes automatic tracking can't see
    // (canvas pixel draws, programmatic CSSOM edits). Works under auto-burst too.
    invalidate: options.invalidate ?? false,

    // Region capture: 'viewport' or {x,y,width,height} in page coordinates
    clip: options.clip ?? null,

    // Perceptual image downsampling — always-on engine behavior (fidelity-neutral: codecs
    // preserved, output adopted only when smaller). `compress: false` is INTERNAL-ONLY
    // (benchmarks/tests measuring the uncompressed pipeline), not public API.
    compress: options.compress !== false,

    // #348: exclude style props from snapshot (reduces cost when :root has thousands of CSS vars)
    excludeStyleProps: options.excludeStyleProps ?? null,

    // Lazy <picture>/data-src placeholders resolve on the CLONE (freezeImgSrcset).
    // Accepted for v2 compat, undocumented in v3 (the engine just does the right thing).
    resolvePicturePlaceholders: options.resolvePicturePlaceholders !== false,

    // Capture artifacts hand-off. `createContext` is an allowlist, so a callback
    // passed by the caller never reached captureDOM's `__retain` block — burst only
    // works because it assigns onto the already-built context. Consumers that need
    // the resolved clone (a vector exporter walking it instead of the live DOM, for
    // one) have no other way in: the clone is where pseudo-elements are materialised,
    // shadow DOM is flattened and icon fonts are resolved.
    // Called with { clone, nodeMap, styleCache, styleMap, classPrefixCSS, fontsCSS, ... }
    // AFTER the capture resolves. Best-effort: a throw inside it is swallowed.
    retain: typeof options.retain === 'function' ? options.retain : null,

    // Plugins (reservado)
    // plugins: normalizePlugins(...),
  }
}
