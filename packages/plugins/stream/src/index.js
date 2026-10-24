/**
 * Live DOM streaming for SnapDOM: an element as a canvas that repaints only what changed,
 * plus the pieces that put it to work (a WebGL texture that uploads only dirty rects, a
 * recorder). `stream(el)` is the entry; `streamExport()` adds the same thing to a capture
 * result as `toStream()`, next to toMp4 and toGif.
 * @module plugins/stream
 */
import { stream } from './stream.js'
import { captureInputs, exportOption } from '../../capture-frames.js'

export { stream } from './stream.js'
export { streamTexture } from './webgl.js'
export { recordCanvas } from './recorder.js'

/**
 * Plugin form: `result.toStream(options)` streams the captured element with the capture's
 * own options. Returns the stream at once, so it never holds the result's export queue.
 * Pinned by __tests__/plugin.stream.test.js.
 * @param {object} [defaults] - stream options applied to every toStream()
 * @returns {object} SnapDOM plugin
 */
export function streamExport(defaults = {}) {
  return {
    name: 'stream',
    defineExports() {
      return {
        stream: (ctx, opts = {}) => {
          if (!ctx.element) throw new Error('[SnapDOM] stream: there is no element to stream.')
          const requested = ctx.export?.requestedOptions || opts
          return stream(ctx.element, {
            ...captureInputs(ctx, opts),
            scale: exportOption(ctx, opts, 'scale', ctx.scale ?? 1),
            ...defaults,
            ...requested,
          })
        },
      }
    },
  }
}
