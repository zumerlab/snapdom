/**
 * timestampOverlay - Official SnapDOM Plugin
 * Adds a translucent timestamp label to the captured clone.
 *
 * @param {Object} [options]
 * @param {string} [options.format='datetime'] - 'datetime' | 'date' | 'time' | 'iso' | custom function
 * @param {string} [options.position='bottom-right'] - 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
 * @param {string} [options.background='rgba(0,0,0,0.6)']
 * @param {string} [options.color='#fff']
 * @param {number} [options.fontSize=11]
 * @returns {Object} SnapDOM plugin
 */
export function timestampOverlay(options = {}) {
  const {
    format = 'datetime',
    position = 'bottom-right',
    background = 'rgba(0,0,0,0.6)',
    color = '#fff',
    fontSize = 11,
  } = options;

  function getTimestamp() {
    const now = new Date();
    if (typeof format === 'function') return format(now);
    switch (format) {
      case 'date':     return now.toLocaleDateString();
      case 'time':     return now.toLocaleTimeString();
      case 'iso':      return now.toISOString();
      case 'datetime':
      default:         return now.toLocaleString();
    }
  }

  const posMap = {
    'top-left':     'top:6px;left:6px',
    'top-right':    'top:6px;right:6px',
    'bottom-left':  'bottom:6px;left:6px',
    'bottom-right': 'bottom:6px;right:6px',
  };

  return {
    name: 'timestamp-overlay',

    afterClone(ctx) {
      const label = document.createElement('div');
      label.textContent = getTimestamp();
      label.style.cssText = `
        position:absolute;
        ${posMap[position] || posMap['bottom-right']};
        background:${background};
        color:${color};
        font-size:${fontSize}px;
        padding:2px 6px;
        border-radius:3px;
        font-family:monospace;
        pointer-events:none;
        z-index:999999;
        line-height:1.4;
      `;
      ctx.clone.style.position = 'relative';
      ctx.clone.appendChild(label);
    }
  };
}
