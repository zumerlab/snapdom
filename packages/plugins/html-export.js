/**
 * htmlExport - Official SnapDOM Plugin
 * Adds a toHtml() export that returns the capture as a self-contained,
 * re-renderable HTML document (clone + inlined styles/fonts) instead of pixels.
 *
 * It serializes the captured clone directly, so the markup and CSS match the capture
 * byte-for-byte. Nothing is rasterized, and nothing is re-parsed.
 *
 * That fidelity cuts both ways: the output carries the captured markup AS IT WAS, including
 * any event-handler attributes the original nodes had. It is a faithful copy of a page, not a
 * sanitized one — treat a downloaded or served .html from here the way you would treat the
 * page it came from.
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

  // Where the serialized markup is parked between afterRender and toHtml. It has to hang
  // off the CAPTURE, not off this closure: one plugin instance serves every capture it is
  // registered for — always, when registered globally — so a single `let` here was shared
  // state between them. Each afterRender overwrote it, and since a result's toHtml() is
  // called later (that is the point of returning a result object), the LAST capture's
  // markup is what every earlier result answered with:
  //
  //   const a = await snapdom(alpha); const b = await snapdom(beta);
  //   await a.toHtml()   // → beta's markup
  //
  // The capture context is the object both hooks already share (afterRender receives it,
  // and defineExports' ctx is a shallow copy of it, made after the render), so parking the
  // markup there scopes it to exactly one capture and survives every path — including
  // burst's differential recapture, which re-enters the engine and re-fires afterRender.
  const BODY = '__htmlExportBody';

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
      state[BODY] = container ? new XMLSerializer().serializeToString(container) : '';
    },

    defineExports() {
      return {
        html: async (ctx, opts = {}) => {
          const frozenBody = ctx[BODY];
          if (typeof frozenBody !== 'string') {
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
