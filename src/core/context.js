/**
 * Creates a unified configuration context
 * @param {Object} options - User options
 * @returns {Object} Context with clear format/type separation
 */
export function createContext(options = {}) {
  return {
    // Core Capture
    debug: options.debug ?? false,
    compress: options.compress ?? true,
    fast: options.fast ?? true,
    scale: options.scale ?? 1,

    // ⚠️ EXISTENTE: suele ser para excluir nodos del DOM (no confundir con fuentes)
    exclude: options.exclude ?? [],
    filter: options.filter ?? null,

    // Fonts
    embedFonts: options.embedFonts ?? false,
    iconFonts: options.iconFonts ?? [],
    localFonts: options.localFonts ?? [],
    /** Simple font exclude (no regex).
     *  { families?: string[], domains?: string[], subsets?: string[] }
     *  families: nombres de familia (case-insensitive)
     *  domains: hosts a excluir (p.ej. "fonts.gstatic.com")
     *  subsets: "latin" | "latin-ext" | "greek" | "cyrillic" | "vietnamese"
     */
    fontExclude: options.fontExclude ?? undefined,

    preCached: options.preCached ?? false,
    reset: options.reset ?? false,
    useProxy: options.useProxy ?? "",

    // Output Configuration
    width: options.width ?? null,
    height: options.height ?? null,
    format: options.format ?? 'png',   // 'png'|'jpg'|'jpeg'|'webp'|'svg'
    type: options.type ?? 'svg',
    quality: options.quality ?? 0.92,
    dpr: options.dpr ?? (window.devicePixelRatio || 1),
    backgroundColor: options.backgroundColor ??
      (['jpg','jpeg','webp'].includes(options.format) ? '#ffffff' : null),
    filename: options.filename ?? `snapDOM`,

    // Plugins (disabled por ahora)
    /* plugins: normalizePlugins(
      options.ignoreGlobalPlugins
        ? options.plugins ?? []
        : [...getGlobalPlugins(), ...(options.plugins ?? [])],
      options.debug
    ) */
  };
}
