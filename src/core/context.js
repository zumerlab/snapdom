/**
 * @typedef {"disabled"|"full"|"auto"|"soft"} CachePolicy
 */

import { normalizeCachePolicy } from './cache.js'

/**
 * Creates a normalized capture context for SnapDOM.
 * @param {Object} [options={}]
 * @param {boolean} [options.debug]
 * @param {boolean} [options.fast]
 * @param {number}  [options.scale]
 * @param {Array<string|RegExp>} [options.exclude]
 * @param {string}  [options.excludeMode]
 * @param {(node: Node)=>boolean} [options.filter]
 * @param {string}  [options.filterMode]
 * @param {boolean} [options.embedFonts]
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
 * @param {boolean} [options.resolvePicturePlaceholders] - Resolve &lt;picture&gt; placeholders / lazy data-src before clone (default true)
 * @param {{ timeout?: number, concurrency?: number, resolveLazySrc?: boolean, silent?: boolean }} [options.pictureResolver] - Fine-tune built-in picture resolver
 * @param {boolean} [options.compress] - Downsample inlined raster images to their visible resolution (display box × scale × dpr), preserving the source codec. On by default; pass `false` to embed images verbatim.
 * @returns {Object}
 */
export function createContext(options = {}) {
  let resolvedFormat = options.format ?? 'png'
  if (resolvedFormat === 'jpg') resolvedFormat = 'jpeg'
  /** @type {CachePolicy} */
  const cachePolicy = normalizeCachePolicy(options.cache)

  return {
    // Debug & perf
    debug: options.debug ?? false,
    fast: options.fast ?? true,
    scale: options.scale ?? 1,

    // DOM filters
    exclude: options.exclude ?? [],
    excludeMode: options.excludeMode ?? 'hide',
    filter: options.filter ?? null,
    filterMode: options.filterMode ?? 'hide',

    // Placeholders
    placeholders: options.placeholders !== false, // default true

    // Fonts
    embedFonts: options.embedFonts ?? false,
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

    // Region capture: 'viewport' or {x,y,width,height} in page coordinates
    clip: options.clip ?? null,

    // Perceptual image downsampling. On by default (big speed win on image-heavy raster captures,
    // ~free on the common case, fidelity-neutral). Pass `compress: false` to embed images verbatim.
    compress: options.compress !== false,

    // Safari warmup (WebKit #219770): iterations to prime font/decode pipeline. 1–3.
    safariWarmupAttempts: Math.min(3, Math.max(1, (options.safariWarmupAttempts ?? 3) | 0)),

    // #348: exclude style props from snapshot (reduces cost when :root has thousands of CSS vars)
    excludeStyleProps: options.excludeStyleProps ?? null,

    // Built-in picture / lazy-src resolver (see src/modules/pictureResolver.js)
    resolvePicturePlaceholders: options.resolvePicturePlaceholders !== false,
    pictureResolver:
      options.pictureResolver && typeof options.pictureResolver === 'object'
        ? options.pictureResolver
        : {},

    // Plugins (reservado)
    // plugins: normalizePlugins(...),
  }
}
