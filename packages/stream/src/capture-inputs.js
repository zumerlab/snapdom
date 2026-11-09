/**
 * Read the capture options a `toStream()` export carries over to its stream from the export
 * context, the way the recording plugins read theirs. A copy of `exportOption` and
 * `captureInputs` in packages/plugins/capture-frames.js: the two packages release on their
 * own and share no module. Pinned by __tests__/plugin.stream.test.js.
 * @module stream/capture-inputs
 */

/**
 * Resolve an explicit export override ahead of a plugin default.
 * v3's normalized opts include inherited defaults; requestedOptions distinguishes explicit
 * scale:1 from inherited scale:1.
 * @param {object} ctx - Capture/export context
 * @param {object} opts - Normalized export options, including beforeExport mutations
 * @param {string} key - Option name
 * @param {any} fallback - Plugin or inherited default
 * @returns {any}
 */
export function exportOption(ctx, opts, key, fallback) {
  const requested = ctx.export?.requestedOptions || opts;
  return Object.prototype.hasOwnProperty.call(requested, key) || opts[key] !== ctx[key]
    ? (opts[key] ?? fallback) : fallback;
}

/**
 * Rebuild the options a live recapture needs from an export context: capture inputs, not
 * released stage artifacts or export-session internals. createContext splits exclusion
 * predicates out of `exclude`; they are put back.
 * @param {object} ctx - Export context
 * @param {object} opts - Normalized per-export options
 * @returns {object} options for snapdom(ctx.element, ...)
 */
export function captureInputs(ctx, opts) {
  const capture = {};
  for (const key of ['debug', 'width', 'height', 'dpr', 'backgroundColor', 'quality', 'format',
    'exclude', 'excludeMode', 'filter', 'filterMode', 'placeholders', 'captureSelection', 'canvas', 'embedFonts',
    'iconFonts', 'localFonts', 'excludeFonts', 'fontStylesheetDomains', 'fallbackURL', 'cache',
    'useProxy', 'outerTransforms', 'outerShadows', 'reconcile', 'burst', 'engine', 'invalidate',
    'clip', 'compress', 'excludeStyleProps', 'resolvePicturePlaceholders', 'plugins']) {
    if (opts[key] !== undefined) capture[key] = opts[key];
    else if (ctx[key] !== undefined) capture[key] = ctx[key];
  }
  if (capture.exclude === ctx.exclude && ctx.excludePredicates?.length) {
    capture.exclude = [...(ctx.exclude || []), ...ctx.excludePredicates];
  }
  return capture;
}
