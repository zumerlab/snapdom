import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
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
