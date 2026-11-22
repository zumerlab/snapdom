// Vitest globalSetup: the visual suite pixel-diffs the COMPILED dist/ (snapdomUrl:
// '/dist/snapdom.mjs', demos load ../dist/snapdom.js), so a stale build silently tests
// old code — this already masked a real styleScan regression once.
// Recompile automatically whenever any src file is newer than the newest dist output.
import { readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      newest = Math.max(newest, statSync(p).mtimeMs)
    }
  }
  return newest
}

export function distNeedsBuild(root) {
  const srcNewest = Math.max(
    newestMtime(join(root, 'src')),
    statSync(join(root, 'esbuild.config.mjs')).mtimeMs,
    statSync(join(root, 'package.json')).mtimeMs
  )
  return ['snapdom.mjs', 'snapdom.js'].some(name => {
    const output = join(root, 'dist', name)
    return !existsSync(output) || statSync(output).mtimeMs < srcNewest
  })
}

/**
 * The vector plugin ships one built file too (packages/vector/build.mjs), and its
 * `index.js` re-exports it: __tests__/plugins.barrel.test.js imports that barrel, so a
 * missing bundle fails the suite on a clean checkout and a stale one tests old code.
 */
export function vectorDistNeedsBuild(root) {
  const dir = join(root, 'packages', 'vector')
  const output = join(dir, 'dist', 'snapdom-vector.mjs')
  if (!existsSync(output)) return true
  const srcNewest = Math.max(
    newestMtime(join(dir, 'src')),
    newestMtime(join(dir, 'svd')),
    statSync(join(dir, 'build.mjs')).mtimeMs,
    statSync(join(dir, 'package.json')).mtimeMs
  )
  return statSync(output).mtimeMs < srcNewest
}

export default function ensureFreshDist() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  if (distNeedsBuild(root)) {
    console.log('[ensure-fresh-dist] dist/ is stale — recompiling before tests')
    const res = spawnSync('node', ['esbuild.config.mjs'], { cwd: root, stdio: 'inherit' })
    if (res.status !== 0) throw new Error('[ensure-fresh-dist] compile failed — refusing to test a stale dist/')
  }
  if (vectorDistNeedsBuild(root)) {
    console.log('[ensure-fresh-dist] packages/vector/dist/ is stale — rebuilding before tests')
    const res = spawnSync('node', ['packages/vector/build.mjs'], { cwd: root, stdio: 'inherit' })
    if (res.status !== 0) throw new Error('[ensure-fresh-dist] vector build failed — refusing to test a stale bundle')
  }
}
