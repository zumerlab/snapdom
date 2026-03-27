/**
 * colorTint - Official SnapDOM Plugin
 * Tints the entire capture to a specified color using an overlay
 * with mix-blend-mode, following the same pattern as the overlay plugin.
 *
 * @param {Object} [options]
 * @param {string} [options.color='red'] - CSS color value
 * @param {number} [options.opacity=1] - Overlay opacity (0-1)
 * @returns {Object} SnapDOM plugin
 */
export function colorTint(options = {}) {
  const {
    color = 'red',
    opacity = 1,
  } = options;

  return {
    name: 'color-tint',

    async afterClone(context) {
      const root = context.clone;
      if (!root || !(root instanceof HTMLElement)) return;
      root.style.position = 'relative';
      root.style.overflow = 'hidden';
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.backgroundColor = color;
      overlay.style.opacity = String(opacity);
      overlay.style.mixBlendMode = 'color';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '999999';
      root.appendChild(overlay);
    }
  };
}
