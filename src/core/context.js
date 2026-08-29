/**
 * @typedef {"disabled"|"full"|"auto"|"soft"} CachePolicy
 */

import { normalizeCachePolicy } from './cache.js'
import { compileIconFontMatchers } from '../modules/iconFonts.js'

/**
 * Creates a normalized capture context for SnapDOM.
 * @param {Object} [options={}]
 * @param {boolean} [options.debug]
 * @param {number}  [options.scale]
 * @param {string|((el: Element) => boolean)|Array<string|((el: Element) => boolean)>} [options.exclude] - Selectors and/or predicates (true = exclude)
 * @param {string}  [options.excludeMode]
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
 * @param {HTMLCanvasElement} [options.canvas] - Draw the canvas export into this canvas instead of a new one
 * @param {boolean} [options.captureSelection] - Render the user's live text selection into the capture
 * @param {boolean} [options.outerTransforms]
 * @param {boolean} [options.outerShadows]
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

  // ONE decision, ONE pair of options. `exclude` accepts selectors and/or predicates
  // ((el) => true EXCLUDES it, matching the option's name) in any mix; `excludeMode` says
  // how excluded nodes leave ('hide' spacer | 'remove'). Split ONCE here so the per-node
  // hot loop never typeof-dispatches.
  //
  // v2's `filter`/`filterMode` are GONE, not silently aliased. They were a second door to
  // this same decision with the opposite polarity (return true to KEEP), so every reader
  // had to hold both in their head and every call site checked both. Ignoring them quietly
  // would be the worst outcome for a redaction feature: the capture would simply stop
  // hiding what the caller asked to hide. So passing one is a loud warning, once, naming
  // the exact replacement.
  const excludeRaw = options.exclude == null ? [] : (Array.isArray(options.exclude) ? options.exclude : [options.exclude])
  const excludeSelectors = []
  const excludePredicates = []
  for (const e of excludeRaw) {
    if (typeof e === 'string') excludeSelectors.push(e)
    else if (typeof e === 'function') excludePredicates.push(e)
    else if (e != null) console.warn('[snapdom] Ignored invalid exclude entry (expected selector string or predicate):', e)
  }
  if (options.filter != null || options.filterMode != null) {
    console.warn(
      '[snapdom] `filter`/`filterMode` were removed in v3 and are NOT applied. ' +
      'Use `exclude` (opposite polarity: return true to EXCLUDE) and `excludeMode`: ' +
      'filter: el => keep(el)  ->  exclude: el => !keep(el)'
    )
  }
  const excludeMode = options.excludeMode ?? 'hide'

  // THE exclusion policy, compiled once. deepClone applies exactly these three rules per node
  // (src/core/clone.js: data-capture, selectors, predicates);
  // everything else that decides what a capture contains — semantic exports, agent maps —
  // asks here instead of reimplementing them, because a node the user redacted from the
  // image must not survive in a text view of the same capture.
  const shouldExclude = (el) => {
    if (!el || el.nodeType !== 1) return false
    if (el.getAttribute('data-capture') === 'exclude') return true
    for (const sel of excludeSelectors) {
      try { if (el.matches(sel)) return true } catch { /* invalid selector: deepClone warns */ }
    }
    for (const pred of excludePredicates) {
      try { if (pred(el)) return true } catch { /* deepClone warns */ }
    }
    return false
  }

  return {
    // Debug & perf
    debug: options.debug ?? false,
    scale: options.scale ?? 1,

    // Node exclusion (see the unification note above)
    exclude: excludeSelectors,
    excludePredicates: excludePredicates.length ? excludePredicates : null,
    excludeMode,
    /** @type {(el: Element) => boolean} true when the capture drops or blanks this node. */
    shouldExclude,

    // Placeholders
    placeholders: options.placeholders !== false, // default true

    // Render the user's live text selection into the capture: selected runs of text are
    // wrapped in the styles the browser paints them with (authored ::selection where a rule
    // matches, the UA highlight colour where none does). Opt-in — a screenshot taken while
    // the user happens to have text selected should look selected only when asked.
    captureSelection: options.captureSelection ?? false,

    // Canvas exporter target. A caller looping captures (a live mirror) otherwise pays a
    // full-canvas copy per frame moving the pixels off a throwaway canvas onto its own.
    // Anything that is not a canvas is ignored, so the exporter always has one to draw into.
    canvas: (typeof HTMLCanvasElement !== 'undefined' && options.canvas instanceof HTMLCanvasElement)
      ? options.canvas
      : null,

    // Fonts
    // 'auto' (default): embed webfonts only when the element actually uses families the
    // document declares — svg-as-image is an isolated document that can't see page fonts,
    // so skipping the embed on webfont text is silent infidelity; system-font pages skip
    // the whole phase at zero cost. true/false remain explicit overrides.
    embedFonts: options.embedFonts ?? 'auto',
    iconFonts: Array.isArray(options.iconFonts) ? options.iconFonts
      : (options.iconFonts ? [options.iconFonts] : []),
    // Compiled here, once, and passed explicitly to every isIconFont call: this used to be
    // a module-level array each capture overwrote, so concurrent captures with different
    // lists read each other's matchers.
    __iconMatchers: compileIconFontMatchers(options.iconFonts),
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

    // Root transform / shadow handling
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

    // Plugins (reservado)
    // plugins: normalizePlugins(...),
  }
}
