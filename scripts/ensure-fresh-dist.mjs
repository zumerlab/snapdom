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

export default function ensureFreshDist() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  if (!distNeedsBuild(root)) return
  console.log('[ensure-fresh-dist] dist/ is stale — recompiling before tests')
  const res = spawnSync('node', ['esbuild.config.mjs'], { cwd: root, stdio: 'inherit' })
  if (res.status !== 0) throw new Error('[ensure-fresh-dist] compile failed — refusing to test a stale dist/')
}
