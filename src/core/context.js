/**
 * @typedef {"disabled"|"full"|"auto"|"soft"} CachePolicy
 */

/**
 * Normalizes `options.cache` into a canonical policy.
 * Accepted strings: "disabled" | "full" | "auto" | "soft"
 * Default: "soft"
 * @param {unknown} v
 * @returns {CachePolicy}
 */
export function normalizeCachePolicy(v) {
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "disabled" || s === "full" || s === "auto" || s === "soft") return /** @type {CachePolicy} */(s);
  }
  return "soft";
}

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
 * @param {string|function} [options.defaultImageUrl]
 * @param {string}  [options.useProxy]
 * @param {number|null} [options.width]
 * @param {number|null} [options.height]
 * @param {"png"|"jpg"|"jpeg"|"webp"|"svg"} [options.format]
 * @param {"svg"|"img"|"canvas"|"blob"} [options.type]
 * @param {number}  [options.quality]
 * @param {number}  [options.dpr]
 * @param {string|null} [options.backgroundColor]
 * @param {string}  [options.filename]
 * @param {unknown} [options.cache] // ← NEW: "disabled"|"full"|"auto"|"soft" | boolean shorthands
 * @returns {Object}
 */
export function createContext(options = {}) {
  const resolvedFormat = options.format ?? 'png';
  /** @type {CachePolicy} */
  const cachePolicy = normalizeCachePolicy(options.cache);

  return {
    // Debug & perf
    debug: options.debug ?? false,
    fast: options.fast ?? true,
    scale: options.scale ?? 1,

    // DOM filters
    exclude: options.exclude ?? [],
    excludeMode: options.excludeMode ?? 'visuallyHide',
    filter: options.filter ?? null,
    filterMode: options.filterMode ?? 'visuallyHide',

    placeholders: options.placeholders !== false, // default true

    // Fuentes
    embedFonts: options.embedFonts ?? false,
    iconFonts: Array.isArray(options.iconFonts) ? options.iconFonts
      : (options.iconFonts ? [options.iconFonts] : []),
    localFonts: Array.isArray(options.localFonts) ? options.localFonts : [],
    excludeFonts: options.excludeFonts ?? undefined,
    defaultImageUrl: options.defaultImageUrl ?? undefined,

    /** Cache policy (disabled|full|auto|soft). Default: "soft" */
    /** @type {CachePolicy} */
    cache: cachePolicy,

    // Red
    useProxy: typeof options.useProxy === 'string' ? options.useProxy : "",

    // Salida
    width: options.width ?? null,
    height: options.height ?? null,
    format: resolvedFormat,
    type: options.type ?? 'svg',
    quality: options.quality ?? 0.92,
    dpr: options.dpr ?? (window.devicePixelRatio || 1),
    backgroundColor:
      options.backgroundColor ?? (['jpg', 'jpeg', 'webp'].includes(resolvedFormat) ? '#ffffff' : null),
    filename: options.filename ?? 'snapDOM',

    // Plugins (reservado para futura activación)
    // plugins: normalizePlugins(...),
  };
}
