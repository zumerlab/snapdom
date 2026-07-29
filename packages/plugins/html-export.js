/**
 * htmlExport - Official SnapDOM Plugin
 * Adds a toHtml() export that returns the capture as a self-contained,
 * re-renderable HTML document (clone + inlined styles/fonts) instead of pixels.
 *
 * It unwraps the SVG <foreignObject> snapdom already produced, so the markup
 * and CSS match the capture byte-for-byte. Nothing is rasterized.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fullDocument=true] - Wrap in <!DOCTYPE html>…; if false, return just <style> + fragment
 * @param {string} [options.filename='capture.html'] - Download filename when opts.download is used
 * @returns {Object} SnapDOM plugin
 */
export function htmlExport(options = {}) {
  const {
    fullDocument = true,
    filename = 'capture.html',
  } = options;

  return {
    name: 'html-export',

    defineExports() {
      return {
        html: async (ctx, opts = {}) => {
          const url = ctx.export.url;
          if (typeof url !== 'string' || !url.startsWith('data:image/svg+xml')) {
            throw new Error('[snapdom] html-export: capture is not an SVG data URL');
          }
          // Core exposes the serialized SVG lazily and the CSS artifacts directly —
          // no reverse-parsing of our own output. Decode fallback kept for
          // artifact-less contexts (older cores, direct calls).
          const svgString = typeof ctx.export.svgString === 'function'
            ? ctx.export.svgString()
            : decodeURIComponent(url.replace(/^data:image\/svg\+xml[^,]*,/, ''));

          const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
          const fo = doc.querySelector('foreignObject');
          if (!fo) throw new Error('[snapdom] html-export: capture has no foreignObject');

          const container = fo.querySelector('div');
          const a = ctx.artifacts;
          const css = a
            ? (a.scrollbarCSS + a.baseCSS + a.fontsCSS + a.classCSS)
            : (fo.querySelector('style') ? fo.querySelector('style').textContent : '');
          const body = container ? new XMLSerializer().serializeToString(container) : '';

          const asDoc = opts.fullDocument ?? fullDocument;
          const html = asDoc
            ? `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
            : `<style>${css}</style>\n${body}\n`;

          const dl = opts.download;
          if (dl) {
            const blob = new Blob([html], { type: 'text/html' });
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = typeof dl === 'string' ? dl : (opts.filename || filename);
            a.click();
            setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
          }
          return html;
        }
      };
    }
  };
}

export default htmlExport;
