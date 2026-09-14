/**
 * filter - Official SnapDOM Plugin
 * Applies CSS filter effects to the captured clone.
 * Pinned by __tests__/plugins.transforms.v3.test.js.
 * @module plugins/filter
 *
 * @param {Object} [options]
 * @param {string} [options.filter=''] - CSS filter string, e.g. 'grayscale(1) blur(2px)'
 * @param {string} [options.preset] - 'grayscale' | 'sepia' | 'blur' | 'invert' | 'vintage' | 'dramatic'.
 *   An unknown preset logs a warning and `filter` applies.
 * @returns {Object} SnapDOM plugin
 */
export function filter(options = {}) {
  const presets = {
    grayscale:  'grayscale(1)',
    sepia:      'sepia(1)',
    blur:       'blur(2px)',
    invert:     'invert(1)',
    vintage:    'sepia(0.4) contrast(1.1) brightness(0.9) saturate(0.8)',
    dramatic:   'contrast(1.4) brightness(0.85) saturate(1.3)',
  };

  const {
    filter: filterValue = '',
    preset,
  } = options;

  // An unknown preset must not turn the plugin off when a filter string was also given.
  if (preset && !presets[preset]) console.warn(`[snapdom] filter: unknown preset ${JSON.stringify(preset)}`);
  const cssFilter = presets[preset] || filterValue;

  return {
    name: 'filter',
    pure: true,

    afterClone(ctx) {
      if (!cssFilter) return;
      // Retained author !important rules must not cancel the explicitly requested effect.
      ctx.clone.style.setProperty('filter', cssFilter, 'important');
    }
  };
}
