/**
 * The public face of SnapDOM Vector: the plugin a customer registers, with two
 * exports and one option.
 *
 *   const shot = await snapdom(el, { plugins: [vector()] })
 *   const svg = await shot.toVector()   // standalone SVG, universal target
 *   await shot.toFigma()                // Figma's paste format, on the clipboard
 *
 * The engine in index.js keeps its whole surface (the SVD document, the SVG, Figma
 * and PDF emitters, every tuning option) because the test suites and demos drive
 * it. The customer bundle is built from THIS file, so none of that is part of the
 * product: `exclude` is the only option that reaches the engine, and the engine's
 * defaults decide everything else. `test/verify-plugin.mjs` pins both exports.
 */
import { vector as engine } from './index.js'

/** Only `exclude` crosses into the engine; anything else a caller passes is dropped. */
const publicOptions = (options) => (options && options.exclude !== undefined ? { exclude: options.exclude } : {})

/**
 * Create the plugin. A capture it runs on gains `toVector()` and `toFigma()`.
 *
 * @param {{exclude?: string|Function|Array<string|Function>}} [options]  factory
 *   default for every export; the same option on a call wins for that call.
 * @returns {object} snapdom plugin
 */
export function vector (options = {}) {
  const inner = engine(publicOptions(options))
  return {
    name: inner.name,
    beforeRender: inner.beforeRender,
    defineExports (captureCtx) {
      const exports = inner.defineExports(captureCtx)
      return {
        vector: (ctx, opts) => exports.vectorSvg(ctx, publicOptions(opts)),
        figma: (ctx, opts) => {
          if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
            return Promise.reject(new Error('[snapdom-vector] toFigma() needs the async clipboard API: ' +
              'call it from a page served over https or localhost'))
          }
          // The write starts before the export finishes and is handed promises, so a
          // browser that ties clipboard access to the user's click still sees one.
          const envelope = exports.vectorFigmaClipboard(ctx, publicOptions(opts))
          const part = (key, type) => envelope.then(result => new Blob([result[key]], { type }))
          const written = navigator.clipboard.write([new ClipboardItem({
            'text/html': part('html', 'text/html'),
            'text/plain': part('plain', 'text/plain'),
          })])
          // The export's own error wins over the clipboard's generic one.
          return Promise.all([envelope, written]).then(() => undefined)
        },
      }
    },
  }
}

export default vector
