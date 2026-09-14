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

/** Cap so a pathological page can't grow the log unboundedly. */
const MAX_SESSION_WARNINGS = 50

/**
 * Record a capture degradation on the session's warnings log, surfaced as result.warnings.
 * Nothing reaches the console from here: a caller that must warn keeps its own console.warn.
 * @param {{warnings?: Array}|undefined} session
 * @param {string} code - stable machine-readable code (e.g. 'image-fallback')
 * @param {string} message
 * @param {unknown} [detail]
 */
export function sessionWarn(session, code, message, detail) {
  const w = session && session.warnings
  if (w && w.length < MAX_SESSION_WARNINGS) {
    w.push(detail === undefined ? { code, message } : { code, message, detail })
  }
}
