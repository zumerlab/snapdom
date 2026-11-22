/**
 * Builds what the package ships: ONE minified ES module, `dist/snapdom-vector.mjs`.
 *
 * Until 1.0.3 the package published `src/` as it is written — 1.5 MB unpacked, 41% of
 * it comments, 28 files a CDN had to fetch one by one, and 232 kB of an internal PDF
 * emitter the public entry never imports. The bundle is the public entry
 * (`src/public.js`) and what it reaches, nothing else: MEASURED 2026-11-21, 410 kB
 * minified, 148 kB gzip.
 *
 * `dist/` is gitignored, like the core's: `prepack` runs this, so a publish from a
 * clean checkout cannot ship a package.json that points at a file that is not there.
 *
 *   node packages/vector/build.mjs
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'))

export const OUTFILE = path.join(HERE, 'dist', 'snapdom-vector.mjs')

export async function buildVector ({ logLevel = 'info' } = {}) {
  await build({
    entryPoints: [path.join(HERE, 'src', 'public.js')],
    outfile: OUTFILE,
    bundle: true,
    format: 'esm',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel,
    banner: { js: `/*\n* SnapDOM Vector\n* v${pkg.version}\n* License: MIT\n*/` },
  })
  return OUTFILE
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildVector()
