/** Collect local release inputs. Never builds, tests, publishes, or contacts a registry. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import requireVisual from './require-visual.mjs'
import { distNeedsBuild } from './ensure-fresh-dist.mjs'
import { skippedVisualDemos } from './visual-policy.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HELP = `Usage: node scripts/collect-release-evidence.mjs --out NEW_DIRECTORY [options]

  --core-tarball FILE        Exact core tarball validated by check-pack
  --plugins-tarball FILE     Exact plugins tarball validated by check-pack (supply both)
  --baseline-approval TEXT   Reviewer/date or link to the approval of these baselines
  --include-untracked FILE  Include one untracked repository file; may repeat
  --include-visual-input FILE  Include an ignored/local visual fixture; may repeat
  --log FILE                Copy a validation log/report; may repeat
  --require-clean           Refuse a dirty checkout (final release use)
  --help                    Print this help

The output directory must not exist. Only local files are read/copied; no package
scripts, browser tests, network requests, or publication commands run. Missing
tarballs/approval are recorded as missing evidence, never inferred as approval.
Untracked files are listed but only explicitly selected files are archived.
`

function parseArgs(args) {
  const options = { untracked: [], visualInputs: [], logs: [], requireClean: false }
  const values = new Map([
    ['--out', 'out'], ['--core-tarball', 'coreTarball'], ['--plugins-tarball', 'pluginsTarball'],
    ['--baseline-approval', 'baselineApproval'], ['--include-untracked', 'untracked'], ['--log', 'logs'],
    ['--include-visual-input', 'visualInputs'],
  ])
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--help') { options.help = true; continue }
    if (flag === '--require-clean') { options.requireClean = true; continue }
    const key = values.get(flag)
    if (!key) throw new Error(`Unknown option: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (Array.isArray(options[key])) options[key].push(value)
    else if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`)
    else options[key] = value
  }
  return options
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (command, args, cwd = ROOT) => execFileSync(command, args, {
  cwd, maxBuffer: 128 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
})
const git = (...args) => run('git', args)
const optionalVersion = (command, args) => {
  try { return run(command, args).toString().trim() } catch { return null }
}
const regularFile = path => {
  if (!lstatSync(path).isFile()) throw new Error(`Expected a regular file (no symlink): ${path}`)
  return path
}

export function collectReleaseEvidence(options) {
  if (!options.out) throw new Error('--out is required')
  if (!!options.coreTarball !== !!options.pluginsTarball) throw new Error('Supply both core and plugins tarballs, or neither')
  const out = resolve(options.out)
  if (existsSync(out)) throw new Error(`Output already exists; refusing to overwrite: ${out}`)

  const identity = () => ({
    head: git('rev-parse', 'HEAD').toString().trim(),
    status: git('status', '--porcelain=v1', '-z', '--untracked-files=all'),
    patch: git('diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--'),
  })
  const before = identity()
  if (options.requireClean && before.status.length) throw new Error('Final evidence requires a clean checkout')
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean)
  const selected = [...new Set(options.untracked || [])].map(path => {
    const absolute = resolve(ROOT, path)
    const local = relative(ROOT, absolute)
    if (local.startsWith('..') || isAbsolute(local) || !untracked.includes(local)) {
      throw new Error(`--include-untracked must name an untracked repository file: ${path}`)
    }
    regularFile(absolute)
    return local
  })

  requireVisual(ROOT, { ...process.env, REQUIRE_VISUAL: '1', BROWSER: 'all' })
  if (distNeedsBuild(ROOT)) throw new Error('dist/ is stale or absent; run the approved validation/build first')
  const core = JSON.parse(readFileSync(join(ROOT, 'package.json')))
  const plugins = JSON.parse(readFileSync(join(ROOT, 'packages/plugins/package.json')))
  const bundlePaths = ['dist/snapdom.mjs', 'dist/snapdom.js']
  const demos = readdirSync(join(ROOT, 'demos')).filter(name => /^d.*\.html$/.test(name))
    .map(name => name.slice(0, -5)).filter(name => !skippedVisualDemos.has(name)).sort()
  const baselinePaths = ['visual', 'visual-firefox', 'visual-webkit']
    .flatMap(engine => demos.map(name => `__snapshots__/${engine}/${name}.png`))
  // The visual glob also sees ignored local demos. Archive their inputs explicitly,
  // or a reconstructed checkout can pass while silently exercising fewer demos.
  const assetFiles = (directory) => existsSync(join(ROOT, directory))
    ? readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
      const path = `${directory}/${entry.name}`
      return entry.isDirectory() ? assetFiles(path) : [path]
    }) : []
  const visualPaths = [...demos.map(name => `demos/${name}.html`), ...assetFiles('demos/assets')].sort()
  const tracked = new Set(git('ls-files', '-z').toString().split('\0').filter(Boolean))
  const selectedVisualInputs = [...new Set(options.visualInputs || [])].map(path => {
    const local = relative(ROOT, resolve(ROOT, path))
    if (!visualPaths.includes(local) || tracked.has(local) || selected.includes(local)) {
      throw new Error(`--include-visual-input must name a local visual fixture absent from the source archive: ${path}`)
    }
    regularFile(join(ROOT, local))
    return local
  })
  const missingVisualInputs = visualPaths.filter(path => !tracked.has(path) && !selected.includes(path) && !selectedVisualInputs.includes(path))
  if (missingVisualInputs.length) {
    throw new Error(`Visual inputs would be omitted; explicitly select each with --include-visual-input: ${missingVisualInputs.join(', ')}`)
  }
  const visualInputs = visualPaths.map(path => {
    const bytes = readFileSync(regularFile(join(ROOT, path)))
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  })
  const tarballs = [
    [options.coreTarball, core, 'core'], [options.pluginsTarball, plugins, 'plugins'],
  ].filter(([path]) => path).map(([path, expected, role]) => {
    const absolute = regularFile(resolve(path))
    const packed = JSON.parse(run('tar', ['-xOf', absolute, 'package/package.json']))
    if (packed.name !== expected.name || packed.version !== expected.version) {
      throw new Error(`${role} tarball does not match checkout name/version`)
    }
    if (!isDeepStrictEqual(packed, expected)) throw new Error(`${role} tarball package.json differs from checkout metadata`)
    // Metadata alone cannot distinguish two builds of the same unpublished beta version.
    const paths = role === 'core' ? [...bundlePaths, 'types/snapdom.d.ts', 'README.md', 'LICENSE']
      : readdirSync(join(ROOT, 'packages/plugins')).filter(name => /\.(?:js|ts)$/.test(name) || ['README.md', 'LICENSE'].includes(name))
    for (const path of paths) {
      const source = join(ROOT, role === 'core' ? '' : 'packages/plugins', path)
      if (!readFileSync(source).equals(run('tar', ['-xOf', absolute, `package/${path}`]))) {
        throw new Error(`${role} tarball has different bytes for ${path}`)
      }
    }
    return { absolute, role, name: packed.name, version: packed.version }
  })
  const logs = (options.logs || []).map(path => regularFile(resolve(path)))
  const artifacts = []
  mkdirSync(dirname(out), { recursive: true })
  mkdirSync(out) // Exclusive creation: an existing directory is never reused.
  function save(path, bytes) {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    writeFileSync(join(out, path), bytes, { flag: 'wx' })
    artifacts.push({ path, bytes: bytes.length, sha256: sha256(bytes) })
  }
  function archive(path, paths) {
    for (const name of paths) regularFile(join(ROOT, name))
    save(path, run('tar', ['-czf', '-', '-C', ROOT, '--', ...paths]))
  }
  save('source/HEAD.tar.gz', git('archive', '--format=tar.gz', before.head))
  save('source/working-tree.patch', before.patch)
  save('source/status.porcelain-z', before.status)
  if (selected.length) archive('source/untracked-selected.tar.gz', selected)
  if (selectedVisualInputs.length) archive('source/visual-inputs-selected.tar.gz', selectedVisualInputs)
  save('visual-inputs.json', Buffer.from(JSON.stringify({
    demosPerBrowser: demos.length, includedLocalInputs: selectedVisualInputs, files: visualInputs,
  }, null, 2) + '\n'))
  for (const path of bundlePaths) save(path, readFileSync(join(ROOT, path)))
  for (const path of ['package.json', 'package-lock.json', 'packages/plugins/package.json', 'vitest.config.js']) {
    save(`inputs/${path}`, readFileSync(join(ROOT, path)))
  }
  archive('baselines.tar.gz', baselinePaths)
  const baselines = baselinePaths.map(path => {
    const bytes = readFileSync(join(ROOT, path))
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  })
  const baselineManifest = {
    approvalReference: options.baselineApproval || null,
    approvalMeaning: 'Operator-supplied reference; this collector does not approve visual baselines.',
    demosPerBrowser: demos.length,
    exclusions: [...skippedVisualDemos],
    files: baselines,
  }
  save('baselines.json', Buffer.from(JSON.stringify(baselineManifest, null, 2) + '\n'))
  for (const item of tarballs) save(`tarballs/${item.role}.tgz`, readFileSync(item.absolute))
  for (const [index, path] of logs.entries()) save(`validation/${index + 1}-${basename(path)}`, readFileSync(path))

  const installed = {}
  for (const name of ['playwright', 'playwright-core', 'vitest', 'typescript', 'esbuild', '@zumer/snapdiff']) {
    try { installed[name] = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'))).version }
    catch { installed[name] = null }
  }
  const browserMetadata = join(ROOT, 'node_modules/playwright-core/browsers.json')
  if (existsSync(browserMetadata)) save('inputs/playwright-browsers.json', readFileSync(browserMetadata))
  const after = identity()
  if (before.head !== after.head || !before.patch.equals(after.patch) || !before.status.equals(after.status)) {
    throw new Error(`Checkout changed during collection. Incomplete output retained at ${out}; rerun into a new directory`)
  }
  for (const { path, sha256: hash } of [...baselines, ...visualInputs]) {
    if (sha256(readFileSync(join(ROOT, path))) !== hash) throw new Error(`Visual input changed during collection: ${path}`)
  }
  const missing = []
  if (!tarballs.length) missing.push('exact validated core and plugins tarballs')
  if (!options.baselineApproval) missing.push('baseline approval reference')
  if (!logs.length) missing.push('validation logs and their browser versions')
  const omittedUntracked = untracked.filter(path => !selected.includes(path))
  if (omittedUntracked.length) missing.push('untracked files omitted from source archive; assess whether they affect validation')
  const manifest = {
    schemaVersion: 1, collectedAt: new Date().toISOString(), collectionOnly: true,
    publicationPerformed: false, validationPerformedByCollector: false,
    source: { commit: before.head, dirty: !!before.status.length, patchSha256: sha256(before.patch),
      untracked, includedUntracked: selected, omittedUntracked },
    packages: { core: { name: core.name, version: core.version }, plugins: { name: plugins.name, version: plugins.version,
      peerDependencies: plugins.peerDependencies } },
    environment: { node: process.version, npm: optionalVersion('npm', ['--version']), platform: platform(),
      architecture: arch(), release: release(), macOS: platform() === 'darwin' ? optionalVersion('sw_vers', []) : null,
      installed, browserVersionEvidence: 'Bundled revisions are in inputs/playwright-browsers.json; actual launches belong in supplied validation logs.',
      validationFlags: Object.fromEntries(['BROWSER', 'REQUIRE_VISUAL', 'VITE_UPDATE_VISUAL', 'UPDATE_VISUAL', 'SNAPDOM_CANVAS_ENGINE', 'NETWORK_GATE']
        .map(name => [name, process.env[name] ?? null])) },
    baselines: { count: baselines.length, approvalReference: options.baselineApproval || null },
    visualInputs: { demosPerBrowser: demos.length, count: visualInputs.length, includedLocalInputs: selectedVisualInputs },
    missingEvidence: missing, artifacts,
  }
  // A manifest is written last. Its absence means collection failed or was interrupted.
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(`Local evidence: ${out}`)
  console.log(`Source ${before.head}${before.status.length ? ' + working-tree changes' : ''}; ${baselines.length} baselines; ${tarballs.length} tarballs`)
  if (missing.length) console.log(`Missing evidence: ${missing.join('; ')}`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) console.log(HELP)
    else collectReleaseEvidence(options)
  } catch (error) {
    console.error(`[collect-release-evidence] ${error.message}`)
    process.exitCode = 1
  }
}
