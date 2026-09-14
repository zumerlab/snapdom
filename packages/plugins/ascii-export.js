/**
 * asciiExport - Official SnapDOM Plugin
 * Adds a toAscii() export method that converts captures to ASCII art.
 * Pinned by __tests__/plugins.imageExports.v3.test.js.
 * @module plugins/ascii-export
 *
 * @param {Object} [options]
 * @param {number} [options.width=80] - Character width of output
 * @param {string} [options.charset=' .:-=+*#%@'] - Characters from lightest to darkest
 * @param {boolean} [options.invert=false] - Invert luminance mapping
 * @returns {Object} SnapDOM plugin
 */
export function asciiExport(options = {}) {
  const {
    width: charWidth = 80,
    charset = ' .:-=+*#%@',
    invert = false,
  } = options;

  return {
    name: 'ascii-export',

    defineExports({ exports }) {
      return {
        ascii: async (ctx, opts = {}) => {
          // Capture width is a pixel size, not a character count. v3 merges it into opts.
          const width = Object.hasOwn(ctx.export.requestedOptions, 'width') || opts.width !== ctx.width
            ? opts.width : charWidth;
          if (!Number.isFinite(width) || width < 1) throw new RangeError('[snapdom] ascii-export: width must be a positive number');
          const cols = Math.floor(width);
          const chars = opts.charset || charset;
          const inv = opts.invert ?? invert;

          if (!chars.length) throw new RangeError('[snapdom] ascii-export: charset must not be empty');
          // Keep core's decoded-image/Safari path and captured originals without firing hooks again.
          const source = await exports.canvas({
            ...opts, width: ctx.width, height: ctx.height, scale: 1, dpr: 1, canvas: null,
            backgroundColor: !opts.backgroundColor || opts.backgroundColor === 'transparent' ? '#ffffff' : opts.backgroundColor,
          });
          const rows = Math.max(1, Math.round(cols * source.height / source.width * 0.5));
          const canvas = document.createElement('canvas');
          canvas.width = cols;
          canvas.height = rows;
          const c = canvas.getContext('2d');
          // Squash the bitmap, not the SVG viewport: Firefox preserves its viewBox aspect ratio.
          c.drawImage(source, 0, 0, cols, rows);
          const data = c.getImageData(0, 0, cols, rows).data;

          let ascii = '';
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const i = (y * cols + x) * 4;
              let lum = 1 - (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
              if (inv) lum = 1 - lum;
              const ci = Math.min(Math.floor(lum * chars.length), chars.length - 1);
              ascii += chars[ci];
            }
            ascii += '\n';
          }
          return ascii;
        }
      };
    }
  };
}
