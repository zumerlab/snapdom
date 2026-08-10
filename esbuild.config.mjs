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

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
  define: { __SNAPDOM_CANVAS_ENGINE__: String(CANVAS_ENGINE) },
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const version = pkg.version || '0.0.0'

const banner = {
  js: `/*
* SnapDOM
* v${version}
* Author: Juan Martin Muda
* License: MIT
*/`,
}

/**
 * 1. LEGACY IIFE (script tag / require)
 * Salida: dist/snapdom.js
 */
async function buildLegacy() {
  await build({
    ...common,
    entryPoints: ['src/index.browser.js'],
    outfile: 'dist/snapdom.js',
    globalName: 'snapdom',
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
 * 3. SUBPATH EXPORTS (preCache, plugins)
 * Salida: dist/preCache.mjs, dist/plugins.mjs
 */
async function buildSubpaths() {
  await build({
    ...common,
    entryPoints: {
      'preCache': 'src/api/preCache.js',
      'plugins': 'src/core/plugins.js',
    },
    outdir: 'dist',
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    minify: true,
    splitting: false,
    banner,
  })
}

async function main() {
  try { rmSync('dist/modules', { recursive: true, force: true }) } catch { /* ok */ }
  await Promise.all([
    buildLegacy(),
    buildESM(),
    buildSubpaths(),
  ])
}

main().catch((err) => {
  // eslint-disable-next-line
  console.error(err)
  // eslint-disable-next-line
  process.exit(1)
})
