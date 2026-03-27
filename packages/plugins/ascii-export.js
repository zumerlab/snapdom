/**
 * asciiExport - Official SnapDOM Plugin
 * Adds a toAscii() export method that converts captures to ASCII art.
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

    defineExports() {
      return {
        ascii: async (ctx, opts = {}) => {
          const cols = opts.width || charWidth;
          const chars = opts.charset || charset;
          const inv = opts.invert ?? invert;

          const img = new Image();
          img.src = ctx.export.url;
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
          });

          const aspect = img.height / img.width;
          const rows = Math.round(cols * aspect * 0.5);
          const canvas = document.createElement('canvas');
          canvas.width = cols;
          canvas.height = rows;
          const c = canvas.getContext('2d');
          c.drawImage(img, 0, 0, cols, rows);
          const data = c.getImageData(0, 0, cols, rows).data;

          let ascii = '';
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const i = (y * cols + x) * 4;
              let lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
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
