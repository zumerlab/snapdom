/**
 * filter - Official SnapDOM Plugin
 * Applies CSS filter effects to the captured clone.
 *
 * @param {Object} [options]
 * @param {string} [options.filter=''] - CSS filter string, e.g. 'grayscale(1) blur(2px)'
 * @param {string} [options.preset] - 'grayscale' | 'sepia' | 'blur' | 'invert' | 'vintage' | 'dramatic'
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

  const cssFilter = preset ? (presets[preset] || '') : filterValue;

  return {
    name: 'filter',

    afterClone(ctx) {
      if (!cssFilter) return;
      ctx.clone.style.filter = cssFilter;
    }
  };
}
