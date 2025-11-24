import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

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
 * 1. VERSIÓN MODERNA (Modules + Splitting + Minified)
 * Salida: dist/modules/snapdom.js (y sus chunks en dist/modules/chunks)
 */
async function buildModules() {
  await build({
    ...common,
    entryPoints: {
      // Usamos el prefijo "modules/" para meter todo en esa carpeta
      'modules/snapdom': 'src/api/snapdom.js',
      'modules/preCache': 'src/api/preCache.js',
      'modules/plugins': 'src/core/plugins.js',
      
      // Exporters
      'modules/exporters/toImg': 'src/exporters/toImg.js',
      'modules/exporters/toSvg': 'src/exporters/toSvg.js',
      'modules/exporters/toCanvas': 'src/exporters/toCanvas.js',
      'modules/exporters/toBlob': 'src/exporters/toBlob.js',
      'modules/exporters/toPng': 'src/exporters/toPng.js',
      'modules/exporters/toJpg': 'src/exporters/toJpg.js',
      'modules/exporters/toWebp': 'src/exporters/toWebp.js',
      'modules/exporters/download': 'src/exporters/download.js',
    },
    outdir: 'dist', // La magia la hacen las keys de arriba
    format: 'esm',
    splitting: true,
    minify: true,   // <--- MINIFICADA
    chunkNames: 'modules/chunks/[name]-[hash]', // Chunks ordenados
    banner,
  })
}

/**
 * 2. VERSIÓN GLOBAL IIFE (Legacy + Minified)
 * Salida: dist/snapdom.js
 */
async function buildGlobalMinified() {
  await build({
    ...common,
    entryPoints: ['src/index.browser.js'], // O tu index.browser.js si lo usas
    outfile: 'dist/snapdom.js',
    format: 'iife',
    globalName: 'snapdom',
    minify: true,   // <--- MINIFICADA
    target: ['es2020'],
    banner,
  })
}

/**
 * 3. VERSIÓN GLOBAL ESM (Monolítica + Sin Minificar)
 * Salida: dist/snapdom.mjs
 */
async function buildGlobalUnminified() {
  await build({
    ...common,
    entryPoints: ['src/index.js'],
    outfile: 'dist/snapdom.mjs',
    format: 'esm',
    minify: true,
    splitting: false, // Monolítico
    banner,
  })
}

async function main() {
  await Promise.all([
    buildModules(),
    buildGlobalMinified(),
    buildGlobalUnminified(),
  ])
}

main().catch((err) => {
  // eslint-disable-next-line
  console.error(err)
  // eslint-disable-next-line
  process.exit(1)
})