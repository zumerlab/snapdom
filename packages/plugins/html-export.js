/**
 * htmlExport - Official SnapDOM Plugin
 * Adds a toHtml() export that returns the capture as a self-contained,
 * re-renderable HTML document (clone + inlined styles/fonts) instead of pixels.
 *
 * It serializes the captured clone directly, so the markup and CSS match the capture
 * byte-for-byte. Nothing is rasterized, and nothing is re-parsed.
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

  // The captured markup, serialized once from the clone itself (see afterRender).
  let frozenBody = null;

  return {
    name: 'html-export',
    // Reads the render state, mutates nothing, same answer every time: the fast paths can
    // keep memoizing captures that use this plugin.
    pure: true,

    /**
     * This plugin is a render ENGINE wearing an export's clothes: its input is the finished
     * clone, not pixels. It used to reach that clone the long way around, because
     * defineExports runs after core has released the stage fields:
     *
     *   clone -> serialize to SVG -> decodeURIComponent -> DOMParser -> querySelector
     *
     * Four steps to recover a node core had in hand. afterRender is the last hook where
     * `state.clone` is still alive, and by then it already sits inside the wrapper the SVG
     * engine built for it, so `parentNode` IS the container the old code went looking for.
     * One serialization, no decode, no parse.
     *
     * It also stops requiring the capture to be an SVG data URL, so this export keeps
     * working under any render engine.
     */
    afterRender(state) {
      const container = state.clone?.parentNode;
      frozenBody = container ? new XMLSerializer().serializeToString(container) : '';
    },

    defineExports() {
      return {
        html: async (ctx, opts = {}) => {
          if (frozenBody === null) {
            throw new Error(
              '[snapdom] html-export: this capture produced no render. The plugin\'s afterRender ' +
              'hook never ran, so there is no markup to export (a capture stopped at needs:\'dom\' ' +
              'or \'clone\' never reaches the render stage).'
            );
          }
          const a = ctx.artifacts;
          const css = a ? (a.scrollbarCSS + a.baseCSS + a.fontsCSS + a.classCSS) : '';
          const body = frozenBody;

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
