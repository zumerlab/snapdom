/**
 * Debug logging when options.debug is true.
 * Keeps production quiet; opt-in for troubleshooting.
 * @module utils/debug
 */

/**
 * Log a warning when debug mode is enabled.
 * @param {Object|undefined} ctx - Context with options: { options }, or { options: { debug } }, or sessionCache with options
 * @param {string} msg - Short description
 * @param {unknown} [err] - Optional error/exception
 */
export function debugWarn(ctx, msg, err) {
  const opts = ctx && typeof ctx === 'object' && (ctx.options || ctx)
  if (opts && opts.debug) {
    if (err !== undefined) {
      console.warn('[snapdom]', msg, err)
    } else {
      console.warn('[snapdom]', msg)
    }
  }
}
