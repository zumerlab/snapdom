import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The release and artifact gates share the supported core line: any 3.x. A
 * prerelease is accepted so a draft can run against an unpublished checkout; the
 * final build refuses overrides and pins an exact published version instead. */
export function compatibleSnapdom(version) {
  return /^3\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(version || ''))
}

/** Select one verified core for tests, demos, builds and artifact smoke. By
 * default that is the pinned `@zumer/snapdom` in node_modules: the published
 * package a customer installs, not a sibling checkout that may be ahead of it.
 * A metadata override can identify a loose draft, never relabel an installed core. */
export function resolveSnapdomCore(env = process.env) {
  const directories = [env.SNAPDOM_V3_DIR, env.SNAPDOM_DIR].filter(Boolean).map(p => path.resolve(p))
  if (directories.length > 1 && directories[0] !== directories[1]) {
    throw new Error('[snapdom-pdf] SNAPDOM_V3_DIR and SNAPDOM_DIR must name the same core')
  }
  const overrideDir = directories[0]
  const overrideFile = env.SNAPDOM_FILE && path.resolve(env.SNAPDOM_FILE)
  if (overrideDir && overrideFile) throw new Error('[snapdom-pdf] set a core directory or SNAPDOM_FILE, not both')
  const defaultDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  const file = overrideFile || path.join(overrideDir || defaultDir, 'dist', 'snapdom.mjs')
  if (!fs.existsSync(file)) {
    throw new Error(`[snapdom-pdf] missing ${file}: run npm install, or point SNAPDOM_V3_DIR at a built core`)
  }
  let metadata = null
  for (let directory = path.dirname(file); directory !== path.dirname(directory); directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json')
    if (!fs.existsSync(candidate)) continue
    const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'))
    if (pkg.name === '@zumer/snapdom') { metadata = { directory, version: pkg.version }; break }
  }
  const version = metadata?.version || env.SNAPDOM_COMPAT_VERSION
  if (!compatibleSnapdom(version)) {
    throw new Error(`[snapdom-pdf] @zumer/snapdom ${version || 'unknown'} is incompatible; this plugin requires >=3.0.0 <4`)
  }
  const directory = overrideDir || metadata?.directory || path.dirname(path.dirname(file))
  if (!fs.existsSync(path.join(directory, 'dist', 'snapdom.mjs'))) {
    throw new Error(`[snapdom-pdf] selected core must contain dist/snapdom.mjs: ${directory}`)
  }
  return { directory, file, version, source: overrideDir || overrideFile ? 'draft override' : 'installed core' }
}
