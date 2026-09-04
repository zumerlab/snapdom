/**
 * What actually ships: pack the package the way npm would, then use the tarball the way a
 * consumer would.
 *
 * The browser suite cannot see any of this. It imports `src/` directly, so it is blind to
 * two whole classes of release bug that both shipped undetected:
 *
 *   1. `dist/` is gitignored (correctly — it is a build output). Nothing rebuilt it during
 *      pack, so a publish from a clean checkout produced a tarball with a package.json
 *      pointing at four files that were not in it. It only ever worked because a stale
 *      dist/ happened to sit in the release machine's working tree.
 *   2. The subpaths had no `types` condition and the root .d.ts declared them with
 *      `declare module`, which is an augmentation of an unresolvable specifier. Consumers
 *      got TS2665/TS7016 the moment they turned `skipLibCheck` off. The repo's own type
 *      test missed it by importing the relative path with skipLibCheck on.
 *
 * So this checks the artifact, not the source: delete dist, pack (prepack must rebuild it),
 * assert every entrypoint is inside the tarball, then install it into throwaway consumer
 * projects and typecheck with `skipLibCheck: false` under both module resolution modes,
 * plus a real import smoke test. The tarball must also carry NOTHING beyond the listed
 * files: `files: ["dist/"]` ships whatever sits in dist/, stale stubs included.
 *
 * Run: npm run test:pack
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'snapdom-pack-'))
let failures = 0

const log = (...a) => console.log(...a)
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`) }
const pass = (msg) => log(`  ✓ ${msg}`)
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

// Every path package.json promises. If one of these is missing from the tarball, the
// published package is broken for whoever takes that entrypoint.
const REQUIRED = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/dist/snapdom.js',
  'package/dist/snapdom.mjs',
  'package/types/snapdom.d.ts',
]

try {
  log('\n1. pack from a tree with no dist/ (prepack must rebuild it)')
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true })
  const packOut = run('npm', ['pack', '--pack-destination', work, '--silent'], { cwd: ROOT })
  const tgz = join(work, packOut.trim().split('\n').pop().trim())
  const listed = run('tar', ['-tzf', tgz]).split('\n').map((s) => s.trim()).filter(Boolean)

  for (const f of REQUIRED) {
    if (listed.includes(f)) pass(f)
    else fail(`MISSING from tarball: ${f}`)
  }
  const extra = listed.filter((f) => !REQUIRED.includes(f))
  if (extra.length) fail(`EXTRA files in tarball: ${extra.join(', ')}`)
  else pass('nothing in the tarball beyond those')

  log('\n2. install the tarball into a consumer project')
  const consumer = join(work, 'consumer')
  mkdirSync(join(consumer, 'node_modules', '@zumer'), { recursive: true })
  run('tar', ['-xzf', tgz, '-C', work])
  cpSync(join(work, 'package'), join(consumer, 'node_modules', '@zumer', 'snapdom'), { recursive: true })
  // The repo's own tsc, run in place — TypeScript 7 ships its compiler as a platform-specific
  // binary package, so copying node_modules/typescript alone gets you a launcher with nothing
  // to launch. Where tsc lives is irrelevant; resolution follows the consumer's tsconfig.
  const TSC = join(ROOT, 'node_modules', '.bin', 'tsc')

  writeFileSync(join(consumer, 'index.ts'), `
import { snapdom } from '@zumer/snapdom'
import { registerPlugins, clearPlugins, STAGES } from '@zumer/snapdom/plugins'

export async function use(el: HTMLElement) {
  const res = await snapdom(el, { scale: 2, embedFonts: true })
  const img: HTMLImageElement = await res.toPng()
  snapdom.preCapture()
  registerPlugins()
  clearPlugins()
  const stages: readonly string[] = STAGES
  return { img, stages }
}
`)

  // Both resolvers, because they disagree about exactly the constructs that were broken:
  // "bundler" reads the exports map loosely, "node16" enforces it.
  for (const moduleMode of ['node16', 'bundler']) {
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module', private: true }))
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: moduleMode === 'node16' ? 'node16' : 'esnext',
        moduleResolution: moduleMode,
        lib: ['ES2020', 'DOM'],
        strict: true,
        noEmit: true,
        // The whole point: the repo's own tsconfig hid TS2665 behind this being true.
        skipLibCheck: false,
        types: [],
      },
      include: ['index.ts'],
    }))
    try {
      run(TSC, ['-p', join(consumer, 'tsconfig.json')], { cwd: consumer })
      pass(`tsc moduleResolution=${moduleMode}, skipLibCheck=false`)
    } catch (e) {
      fail(`tsc moduleResolution=${moduleMode}:\n${e.stdout || e.message}`)
    }
  }

  log('\n3. resolve the entrypoints at runtime')
  const pkgDir = join(consumer, 'node_modules', '@zumer', 'snapdom')
  const checks = [
    ['import root', `import('@zumer/snapdom').then(m => { if (typeof m.snapdom !== 'function') throw new Error('snapdom missing') })`],
    ['import /plugins', `import('@zumer/snapdom/plugins').then(m => { if (typeof m.registerPlugins !== 'function') throw new Error('registerPlugins missing') })`],
  ]
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }))
  for (const [name, src] of checks) {
    const file = join(consumer, `probe-${name.replace(/\W+/g, '-')}.cjs`)
    writeFileSync(file, src)
    try {
      run(process.execPath, [file], { cwd: consumer })
      pass(name)
    } catch (e) {
      fail(`${name}: ${(e.stderr || e.message).split('\n').find((l) => l.includes('Error')) || e.message}`)
    }
  }

  log('\n4. the browser bundle must not leak globals')
  const probe = join(consumer, 'globals.cjs')
  writeFileSync(probe, `
const vm = require('node:vm'), fs = require('node:fs')
const code = fs.readFileSync(${JSON.stringify(join(pkgDir, 'dist', 'snapdom.js'))}, 'utf8')
const win = {}
const ctx = { window: win, document: {}, navigator: {} }
ctx.self = ctx; ctx.globalThis = ctx
vm.createContext(ctx)
const before = new Set(Object.keys(ctx))
vm.runInContext(code, ctx)
const leaked = Object.keys(ctx).filter((k) => !before.has(k))
if (leaked.length) throw new Error('leaked ' + leaked.length + ' globals: ' + leaked.slice(0, 8).join(', '))
if (typeof win.snapdom !== 'function') throw new Error('window.snapdom not assigned')
`)
  try {
    run(process.execPath, [probe], { cwd: consumer })
    pass('dist/snapdom.js is isolated and assigns window.snapdom')
  } catch (e) {
    fail((e.stderr || e.message).split('\n').filter((l) => l.includes('Error')).join(' '))
  }

  log(`\ntarball: ${readdirSync(work).find((f) => f.endsWith('.tgz'))} (${listed.length} entries)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures) {
  console.error(`\n${failures} packaging check(s) failed\n`)
  process.exit(1)
}
console.log('\nAll packaging checks passed\n')
