// The regression gate: the compiled checkout versus the exact npm latest artifact.
// No CDN imports, shared globals between versions, external pages or timed fixture setup.
import { chromium, firefox, webkit } from 'playwright'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync } from 'node:fs'
import { resolve, join, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus, platform, release, loadavg } from 'node:os'
import { compareRounds } from './benchmark-statistics.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const options = { rounds: 16, samples: 3, browser: 'chromium', scenes: 'card,table,css,shadow,images,fonts,deep,dashboard', modes: 'first,fresh,recapture,poll-static,poll-mutating' }
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  if (!['rounds', 'samples', 'browser', 'scenes', 'modes', 'cases', 'output', 'control'].includes(key) || !process.argv[i + 1]) {
    throw new Error('Options: --rounds N --samples N --browser chromium|firefox|webkit|all --scenes card,table,css,shadow,images,fonts,deep,dashboard --modes first,fresh,recapture,poll-static,poll-mutating --cases card:fresh,table:recapture --output DIRECTORY --control aa|slow')
  }
  options[key] = process.argv[i + 1]
}
for (const key of ['rounds', 'samples']) {
  options[key] = Number(options[key])
  if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 100) throw new Error(`${key} must be an integer from 1 to 100`)
}
if (options.rounds % 2) throw new Error('Use an even number of rounds to balance AB/BA order')
if (options.control && !['aa', 'slow'].includes(options.control)) throw new Error('control must be aa or slow')
const engines = options.browser === 'all' ? ['chromium', 'firefox', 'webkit'] : [options.browser]
if (engines.some(engine => !['chromium', 'firefox', 'webkit'].includes(engine))) throw new Error('Unknown browser')
const scenes = options.scenes.split(',')
const modes = options.modes.split(',')
if (scenes.some(scene => !['card', 'table', 'css', 'shadow', 'images', 'fonts', 'deep', 'dashboard'].includes(scene)) ||
    modes.some(mode => !['first', 'fresh', 'recapture', 'poll-static', 'poll-mutating'].includes(mode))) throw new Error('Unknown scene or mode')
let cases = scenes.flatMap(scene => modes.filter(mode => mode.startsWith('poll-') ? scene === 'dashboard' : scene !== 'dashboard').map(mode => ({ scene, mode })))
if (options.cases) {
  const requested = new Set(options.cases.split(','))
  cases = cases.filter(({ scene, mode }) => requested.has(`${scene}:${mode}`))
  if (cases.length !== requested.size) throw new Error('Unknown or excluded scene:mode in --cases')
}
if (!cases.length) throw new Error('No selected cases (polling modes use the dashboard scene)')
const output = resolve(root, options.output || `output/benchmark-stable/${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(output, { recursive: true })
mkdirSync(join(root, 'output'), { recursive: true })
const lock = join(root, 'output/benchmark-stable.running')
let lockFd
try { lockFd = openSync(lock, 'wx'); writeFileSync(lockFd, `${process.pid}\n`) }
catch { throw new Error(`Another benchmark may be running. Inspect ${lock}; do not run benchmarks concurrently.`) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = {
  schema: 1, startedAt: new Date().toISOString(), options,
  environment: { node: process.version, cpu: cpus()[0].model, cores: cpus().length, platform: platform(), release: release(), loadBefore: loadavg() },
  method: {
    output: 'snapdom -> result.toCanvas -> canvas.toDataURL(image/png); capture/raster/encode and total measured separately',
    isolation: 'one fresh browser context per arm/case/round, sequential execution, balanced AB/BA rounds; fixture and assets ready before timing',
    modes: { first: 'first capture in a fresh context; no warmup; document assets already loaded', fresh: 'new DOM per capture; two untimed warmups; library/resource caches warm', recapture: 'same DOM, changing marker, burst:false; two untimed warmups', 'poll-static': 'eight unchanged captures, automatic memo; two untimed eight-capture warmups', 'poll-mutating': 'eight captures, mutate every fourth tick; automatic memo; two untimed eight-capture warmups' },
    statistics: 'paired round medians; exact binomial rank intervals for median ratios and differences; familywise 95% Bonferroni coverage per browser across capture and total, ratio and difference; no outlier removal',
    detection: 'regression only above BOTH 5% and 1ms; no-regression-detected is not proof of zero slowdown; broad intervals or <12 rounds are inconclusive; >5% and >1ms AB/BA order effects block a passing verdict but do not hide a supported regression',
    fidelity: 'every timed canvas checks dimensions and changing colored witness; untimed native screenshots and full pixel comparisons saved per case; channel tolerance 20; native/capture mismatch >5% invalidates fixture, worsened mismatch >0.1 percentage points requires review',
  },
  results: [],
}
let server, browser
try {
  const response = await fetch('https://registry.npmjs.org/@zumer%2fsnapdom/latest', { signal: AbortSignal.timeout(30000), headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`npm latest resolution failed: HTTP ${response.status}`)
  const stable = await response.json()
  if (stable.name !== '@zumer/snapdom' || !/^\d+\.\d+\.\d+$/.test(stable.version)) throw new Error('npm latest did not resolve to a stable SnapDOM release')
  const download = await fetch(stable.dist.tarball, { signal: AbortSignal.timeout(60000) })
  if (!download.ok) throw new Error(`npm tarball failed: HTTP ${download.status}`)
  const tarball = Buffer.from(await download.arrayBuffer())
  const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64')
  if (integrity !== stable.dist.integrity) throw new Error('npm tarball integrity mismatch')
  const tarPath = join(output, 'stable.tgz')
  writeFileSync(tarPath, tarball)
  const packedManifest = JSON.parse(execFileSync('tar', ['-xOzf', tarPath, 'package/package.json'], { encoding: 'utf8' }))
  if (packedManifest.version !== stable.version) throw new Error('npm artifact version mismatch')
  const stableBundle = execFileSync('tar', ['-xOzf', tarPath, 'package/dist/snapdom.mjs'], { maxBuffer: 10 * 1024 * 1024 })
  execFileSync(process.execPath, ['esbuild.config.mjs'], { cwd: root, stdio: 'inherit' })
  const localBundle = readFileSync(join(root, 'dist/snapdom.mjs'))
  const localPackage = JSON.parse(readFileSync(join(root, 'package.json')))
  const candidateBundle = options.control ? stableBundle : localBundle
  writeFileSync(join(output, 'stable.mjs'), stableBundle)
  writeFileSync(join(output, 'candidate.mjs'), candidateBundle)
  report.stable = { version: stable.version, resolvedAt: new Date().toISOString(), tarball: stable.dist.tarball, integrity, bundleSha256: hash(stableBundle) }
  report.candidate = { version: options.control ? stable.version : localPackage.version, bundleSha256: hash(candidateBundle), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), control: options.control || null }
  const browserModule = readFileSync(join(root, 'scripts/benchmark-fixtures.mjs'))
  const sharedHarness = readFileSync(join(root, 'docs/compare/live/harness.js'))
  report.fixtureSha256 = hash(Buffer.concat([browserModule, sharedHarness]))
  writeFileSync(join(output, 'fixtures.mjs'), browserModule)
  writeFileSync(join(output, 'harness.js'), sharedHarness)
  const runnerSource = readFileSync(fileURLToPath(import.meta.url))
  const statisticsSource = readFileSync(join(root, 'scripts/benchmark-statistics.mjs'))
  report.runnerSha256 = hash(runnerSource)
  report.statisticsSha256 = hash(statisticsSource)
  writeFileSync(join(output, 'runner.mjs'), runnerSource)
  writeFileSync(join(output, 'benchmark-statistics.mjs'), statisticsSource)
  const html = '<!doctype html><meta charset="utf-8"><title>SnapDOM stable regression benchmark</title><style>html,body{margin:0;padding:0;background:white;font:14px/1.4 Arial,sans-serif}body{width:1280px}</style>'
  const assets = join(root, '__tests__/fixtures')
  server = createServer((request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname
      const fixed = { '/': [html, 'text/html'], '/stable.mjs': [stableBundle, 'text/javascript'], '/candidate.mjs': [candidateBundle, 'text/javascript'], '/fixtures.mjs': [browserModule, 'text/javascript'], '/harness.js': [sharedHarness, 'text/javascript'] }
      let item = fixed[path]
      if (!item && path.startsWith('/assets/')) {
        const file = resolve(assets, path.slice('/assets/'.length))
        if (file.startsWith(assets + sep)) item = [readFileSync(file), extname(file) === '.woff2' ? 'font/woff2' : 'image/png']
      }
      if (!item) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': item[1], 'cache-control': 'public, max-age=3600' }).end(item[0])
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`npm stable ${stable.version} (${report.stable.bundleSha256.slice(0, 12)}) vs ${options.control ? `CONTROL ${options.control}` : 'compiled checkout'} (${report.candidate.bundleSha256.slice(0, 12)})`)
  console.log(`${cases.length} cases, ${options.rounds} paired rounds, ${options.samples} samples; ${output}`)
  if (options.rounds < 12) console.log('Diagnostic run: fewer than 12 independent rounds cannot pass the regression gate.')
  for (const engine of engines) {
    browser = await ({ chromium, firefox, webkit })[engine].launch()
    const newPage = async arm => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' })
      const page = await context.newPage()
      page.setDefaultTimeout(60000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
      await page.goto(origin, { waitUntil: 'load' })
      const version = await page.evaluate(async arm => {
        window.fixture = await import('/fixtures.mjs')
        window.capture = (await import(`/${arm}.mjs`)).snapdom
        return window.capture.version
      }, arm)
      if (version !== report[arm].version) throw new Error(`${arm} loaded ${version}, expected ${report[arm].version}`)
      return { context, page, errors }
    }
    for (const item of cases) {
      const name = `${engine}-${item.scene}-${item.mode}`
      const row = { browser: engine, browserVersion: browser.version(), ...item, pairs: [] }
      report.results.push(row)
      const captures = {}
      const natives = {}
      for (const arm of ['stable', 'candidate']) {
        const { context, page, errors } = await newPage(arm)
        try {
          captures[arm] = await page.evaluate(({ scene, mode }) => fixture.oracle(capture, scene, mode), item)
          const native = await page.locator('#capture-root').screenshot({ animations: 'disabled' })
          natives[arm] = `data:image/png;base64,${native.toString('base64')}`
          writeFileSync(join(output, `${name}-${arm}.png`), Buffer.from(captures[arm].split(',')[1], 'base64'))
          writeFileSync(join(output, `${name}-${arm}-native.png`), native)
          row[`${arm}Fidelity`] = await page.evaluate(({ a, b }) => fixture.difference(a, b), { a: captures[arm], b: natives[arm] })
          if (arm === 'candidate') {
            row.captureDifference = await page.evaluate(({ a, b, c, d }) => fixture.difference(a, b, c, d), { a: captures.stable, b: captures.candidate, c: natives.stable, d: natives.candidate })
            row.sourceDifference = await page.evaluate(({ a, b }) => fixture.difference(a, b), { a: natives.stable, b: natives.candidate })
          }
          if (errors.length) throw new Error(errors.join('\n'))
        } finally { await context.close() }
      }
      const { stableFidelity: sf, candidateFidelity: cf, sourceDifference: sd } = row
      row.fidelity = sf.dimensionMismatch || cf.dimensionMismatch || sd.dimensionMismatch || sd.fraction > 0.001 || Math.max(sf.fraction, cf.fraction) > 0.05
        ? 'invalid-fixture' : row.captureDifference.newlyWrongFraction > 0.001 || cf.fraction > sf.fraction + 0.001 ? 'review-required' : 'passed'
      if (row.fidelity !== 'passed') {
        console.log(`${name}: ${row.fidelity}; timings withheld, inspect saved PNGs`)
        save()
        continue
      }
      for (let round = 0; round < options.rounds; round++) {
        const pair = { round, order: round % 2 ? ['candidate', 'stable'] : ['stable', 'candidate'] }
        const finalFrames = {}
        for (const arm of pair.order) {
          const { context, page, errors } = await newPage(arm)
          try {
            pair[arm] = await page.evaluate(config => fixture.run(capture, config), { ...item, samples: options.samples, round, delayMs: arm === 'candidate' && options.control === 'slow' ? 30 : 0 })
            if (round === options.rounds - 1) {
              const png = await page.evaluate(() => window.lastBenchmarkPng)
              const native = await page.locator('#capture-root').screenshot({ animations: 'disabled' })
              finalFrames[arm] = { png, native: `data:image/png;base64,${native.toString('base64')}` }
              writeFileSync(join(output, `${name}-${arm}-final.png`), Buffer.from(png.split(',')[1], 'base64'))
              writeFileSync(join(output, `${name}-${arm}-final-native.png`), native)
              if (finalFrames.stable && finalFrames.candidate) {
                const final = await page.evaluate(async ({ stable, candidate }) => ({
                  capture: await fixture.difference(stable.png, candidate.png, stable.native, candidate.native),
                  source: await fixture.difference(stable.native, candidate.native),
                  stable: await fixture.difference(stable.png, stable.native),
                  candidate: await fixture.difference(candidate.png, candidate.native),
                }), finalFrames)
                row.finalFidelity = final
                if (Object.values(final).some(diff => diff.dimensionMismatch) || final.source.fraction > 0.001 || Math.max(final.stable.fraction, final.candidate.fraction) > 0.05) row.fidelity = 'invalid-fixture'
                else if (final.capture.newlyWrongFraction > 0.001) row.fidelity = 'review-required'
              }
            }
            if (errors.length) throw new Error(errors.join('\n'))
          } finally { await context.close() }
        }
        row.pairs.push(pair)
        save()
      }
      // Two metrics, each with ratio + absolute-difference confidence intervals.
      row.comparison = ['captureMs', 'totalMs'].map(metric => compareRounds(row.pairs, metric, cases.length * 4))
      console.log(`${name}: ` + row.comparison.map(stat => `${stat.metric} ${stat.stableMs.toFixed(1)} -> ${stat.candidateMs.toFixed(1)}ms (${stat.ratio === null ? 'unresolved' : ((stat.ratio - 1) * 100).toFixed(1) + '%'}) ${stat.verdict}`).join('; ') + `; fidelity ${row.fidelity}`)
      save()
    }
    await browser.close(); browser = null
  }
  const verdicts = report.results.flatMap(row => row.fidelity !== 'passed' ? [row.fidelity] : row.comparison.map(stat => stat.verdict))
  report.verdict = verdicts.some(v => ['regression', 'invalid-fixture', 'review-required'].includes(v)) ? 'failed'
    : verdicts.includes('inconclusive') ? 'inconclusive' : 'no-regression-detected'
  // Controls exercise the SAME runner. They never certify the local candidate.
  if (options.control === 'slow') {
    report.controlPassed = report.results.every(row => row.fidelity === 'passed' && row.comparison.some(stat => stat.verdict === 'regression'))
    process.exitCode = report.controlPassed ? 0 : 1
  } else if (options.control === 'aa') {
    report.controlPassed = report.verdict === 'no-regression-detected'
    process.exitCode = report.controlPassed ? 0 : 1
  } else process.exitCode = report.verdict === 'no-regression-detected' ? 0 : report.verdict === 'inconclusive' ? 2 : 1
  console.log(`Result: ${report.verdict}${options.control ? `; ${options.control} control ${report.controlPassed ? 'passed' : 'FAILED'}` : ''}`)
} catch (error) {
  report.verdict = 'error'
  report.error = error.stack || String(error)
  process.exitCode = 1
  console.error(report.error)
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  report.finishedAt = new Date().toISOString()
  report.environment.loadAfter = loadavg()
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const lines = ['# SnapDOM vs npm stable', '', `Result: **${report.verdict}**${options.control ? ` (CONTROL ${options.control}; not a candidate result)` : ''}`, '', `Stable: ${report.stable?.version || 'unresolved'}; candidate: ${report.candidate?.bundleSha256 || 'not built'}`, '', '| Browser / scene / mode | Metric | Stable ms | Candidate ms | Change | Decision |', '| --- | --- | ---: | ---: | ---: | --- |']
  for (const row of report.results) {
    if (!row.comparison) lines.push(`| ${row.browser} / ${row.scene} / ${row.mode} | — | — | — | — | ${row.fidelity || 'incomplete'} |`)
    for (const stat of row.comparison || []) lines.push(`| ${row.browser} / ${row.scene} / ${row.mode} | ${stat.metric} | ${stat.stableMs.toFixed(2)} | ${stat.candidateMs.toFixed(2)} | ${stat.ratio === null ? 'unresolved' : ((stat.ratio - 1) * 100).toFixed(1) + '%'} | ${row.fidelity === 'passed' ? stat.verdict : row.fidelity} |`)
  }
  lines.push('', 'Raw samples, exact artifact hashes, confidence intervals, order effects and pixel evidence are in report.json and the adjacent PNGs. No-regression-detected bounds the slowdown to 5% or 1 ms at the reported confidence; it does not mean zero regression. First-capture assets are already loaded; polling totals sum eight capture/export latencies, excluding time between ticks. Cold network, live websites and responsiveness are separate workloads.', '')
  writeFileSync(join(output, 'report.md'), lines.join('\n'))
  closeSync(lockFd)
  rmSync(lock)
}
