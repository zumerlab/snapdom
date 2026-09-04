import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'

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
 * Two files, and only these two. There is no CommonJS build: v3 is ESM plus the script-tag
 * IIFE, like v2 in shape (v2's `require()` pointed at the IIFE and returned `{}`, so nothing
 * that worked is lost). The `/plugins` subpath is NOT a file either:
 * package.json maps them to the same dist/snapdom.mjs, so the subpath and the root are one
 * module instance by construction, one registry, one cache. Bundling them separately gave
 * each its own module state, so a plugin registered through the subpath was invisible to
 * snapdom(); re-export stubs fixed that but were four more files for nothing. No splitting,
 * no chunks. dist/ is emptied first because `files: ["dist/"]` ships whatever is in it, and
 * scripts/check-pack.mjs fails on any extra file in the tarball.
 */
async function main() {
  rmSync('dist', { recursive: true, force: true })
  await Promise.all([
    buildLegacy(),
    buildESM(),
  ])
}

main().catch((err) => {
  // eslint-disable-next-line
  console.error(err)
  // eslint-disable-next-line
  process.exit(1)
})
