/**
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function createContext(options = {}) {
  const resolvedFormat = options.format ?? 'png';
  return {
    debug: options.debug ?? false,
    fast: options.fast ?? true,
    scale: options.scale ?? 1,

    // DOM filters (no confundir con fuentes)
    exclude: options.exclude ?? [],
    filter: options.filter ?? null,

    // Fuentes (público)
    embedFonts: options.embedFonts ?? false,
    iconFonts: Array.isArray(options.iconFonts) ? options.iconFonts : (options.iconFonts ? [options.iconFonts] : []),
    localFonts: Array.isArray(options.localFonts) ? options.localFonts : [],
    /**
     * Font exclusion rules (simple, no regex).
     * @type {{families?:string[], domains?:string[], subsets?:string[]}|undefined}
     */
    excludeFonts: options.excludeFonts ?? undefined,

    /** @type {'soft'|'hard'|'none'} */
    reset: normalizeResetOption(options.reset),

    // Red
    useProxy: typeof options.useProxy === 'string' ? options.useProxy : "",

    // Salida
    width: options.width ?? null,
    height: options.height ?? null,
    format: resolvedFormat,
    type: options.type ?? 'svg',
    quality: options.quality ?? 0.92,
    dpr: options.dpr ?? (window.devicePixelRatio || 1),
    backgroundColor: options.backgroundColor ??
      (['jpg','jpeg','webp'].includes(resolvedFormat) ? '#ffffff' : null),
    filename: options.filename ?? `snapDOM`,
  };
}

/**
 * @param {unknown} v
 * @returns {'soft'|'hard'|'full'|'none'}
 */
function normalizeResetOption(v) {
  if (v === 'soft' || v === 'hard' || v === 'none') return v;
  return 'soft'; // default pedido
}

// Plugins (disabled por ahora)
    /* plugins: normalizePlugins(
      options.ignoreGlobalPlugins
        ? options.plugins ?? []
        : [...getGlobalPlugins(), ...(options.plugins ?? [])],
      options.debug
    ) */
