import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

// The experimental canvas engine (src/engines/htmlInCanvas.js) is dead weight in a shipped
// build: Chromium taints the canvas unconditionally today, so every engine:'canvas' capture
// falls through to the normal pipeline. Its lazy import still landed in the bundle (nothing
// is code-split), costing every user ~2KB gzip for a branch that cannot run. This define
// makes the seam statically false so esbuild drops the branch AND the module. Tests import
// src directly, where the identifier is undefined and the engine stays live.
// Build with the engine: SNAPDOM_CANVAS_ENGINE=1 npm run compile
const CANVAS_ENGINE = process.env.SNAPDOM_CANVAS_ENGINE === '1'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const version = pkg.version || '0.0.0'

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
  define: { __SNAPDOM_CANVAS_ENGINE__: String(CANVAS_ENGINE), __SNAPDOM_VERSION__: JSON.stringify(version) },
}


const banner = {
  js: `/*
* SnapDOM
* v${version}
* License: MIT
*/`,
}

/**
 * 1. LEGACY IIFE (script tag)
 * Salida: dist/snapdom.js
 *
 * `format: 'iife'` is load-bearing, not decoration. Without it, platform:'neutral' emitted
 * the bundle as bare top-level statements, so a <script> tag published every minified
 * binding as a global: 442 of them, `Fi`, `rt`, `Zt`… one collision away from breaking an
 * unrelated page. Verified by scripts/check-pack.mjs (npm run test:pack), which runs the
 * packed file in an empty context and counts what leaks.
 *
 * `globalName` is deliberately ABSENT. With it, esbuild wraps the bundle as
 * `var snapdom = (() => {…})()`, and since src/index.browser.js exports nothing that
 * assignment lands AFTER the body has run — overwriting the explicit `window.snapdom`
 * with the entry's empty exports object. The entry owns the global; the bundler must not.
 */
async function buildLegacy() {
  await build({
    ...common,
    entryPoints: ['src/index.browser.js'],
    outfile: 'dist/snapdom.js',
    format: 'iife',
    platform: 'neutral',
    minify: true,
    target: ['es2020'],
    banner,
  })
}

/**
 * 2. ESM MONOLÍTICO (tree-shakeable, bundlers + CDN)
 * Salida: dist/snapdom.mjs
 */
async function buildESM() {
  await build({
    ...common,
    entryPoints: ['src/index.js'],
    outfile: 'dist/snapdom.mjs',
    format: 'esm',
    minify: true,
    splitting: false,
    banner,
  })
}

/**
 * 3. CommonJS (require)
 * Salida: dist/snapdom.cjs
 */
async function buildCJS() {
  await build({
    ...common,
    entryPoints: ['src/index.js'],
    outfile: 'dist/snapdom.cjs',
    format: 'cjs',
    minify: true,
    banner,
  })
}

/**
 * 4. SUBPATH EXPORTS (preCache, plugins)
 * Salida: dist/preCache.mjs, dist/plugins.mjs
 *
 * These are NOT bundles. Bundling them separately gave each its own copy of the module
 * state, so `@zumer/snapdom/plugins` registered into an array snapdom() never read and
 * `@zumer/snapdom/preCache` warmed a cache instance the capture never saw. Static
 * re-exports resolve to the same dist/snapdom.mjs instance: one runtime, one registry,
 * one cache. No splitting, no chunks.
 */
const PLUGIN_EXPORTS = ['registerPlugins', 'clearPlugins', 'getGlobalPlugins', 'normalizePlugin', 'STAGES', 'DEFAULT_STAGE', 'assertNeeds']

function writeSubpathStubs() {
  writeFileSync('dist/preCache.mjs', `${banner.js}\nexport { preCache } from './snapdom.mjs'\n`)
  writeFileSync('dist/plugins.mjs', `${banner.js}\nexport { ${PLUGIN_EXPORTS.join(', ')} } from './snapdom.mjs'\n`)
  // The same stubs for require(). Without them the subpaths were import-only, so a CJS app
  // that require()d the root and reached the registry through the subpath loaded
  // snapdom.cjs AND snapdom.mjs — two module instances, two plugin registries, and a
  // plugin registered through the subpath that snapdom() never saw. One resolution per
  // module system is the most a dual package can promise; this makes it hold.
  writeFileSync('dist/preCache.cjs', `${banner.js}\nmodule.exports = { preCache: require('./snapdom.cjs').preCache }\n`)
  writeFileSync('dist/plugins.cjs', `${banner.js}\nconst r = require('./snapdom.cjs')\nmodule.exports = { ${PLUGIN_EXPORTS.map((n) => `${n}: r.${n}`).join(', ')} }\n`)
}

async function main() {
  try { rmSync('dist/modules', { recursive: true, force: true }) } catch { /* ok */ }
  await Promise.all([
    buildLegacy(),
    buildESM(),
    buildCJS(),
  ])
  writeSubpathStubs()
}

main().catch((err) => {
  // eslint-disable-next-line
  console.error(err)
  // eslint-disable-next-line
  process.exit(1)
})
