/**
 * picture-resolver — re-exports the core implementation (src/modules/pictureResolver.js).
 * SnapDOM runs the same logic by default during capture; keep this import for explicit
 * plugin registration or per-capture overrides.
 */
export { pictureResolver } from '../../src/modules/pictureResolver.js'
export { pictureResolver as default } from '../../src/modules/pictureResolver.js'
