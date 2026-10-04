import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import requireVisual from './require-visual.mjs'
import { distNeedsBuild } from './ensure-fresh-dist.mjs'
import { assertVisualBaselineMode } from './visual-policy.mjs'
import { loadEnv } from 'vite'
import { createServer } from 'node:http'
import { createNetworkGate } from '../vitest.network.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'snapdom-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, time = 10) => {
    const file = join(root, path)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '')
    utimesSync(file, time, time)
  }
  return { root, put }
}

test('release requires a baseline for every eligible demo in each selected engine', t => {
  const { root, put } = fixture(t)
  put('demos/d-one.html')
  put('demos/d-two.html')
  put('demos/demo.html') // intentionally animated, shared exclusion
  const env = { REQUIRE_VISUAL: '1', BROWSER: 'all' }
  put('__snapshots__/visual/d-one.png')
  assert.throws(() => requireVisual(root, env), /visual is missing 1 baselines: d-two/)
  for (const engine of ['visual', 'visual-firefox', 'visual-webkit']) {
    for (const name of ['d-one', 'd-two']) put(`__snapshots__/${engine}/${name}.png`)
  }
  assert.doesNotThrow(() => requireVisual(root, env))
  assert.throws(() => requireVisual(root, { ...env, VITE_UPDATE_VISUAL: '1' }), /baseline updates are enabled/)
  rmSync(join(root, '__snapshots__/visual-webkit/d-two.png'))
  assert.throws(() => requireVisual(root, env), /visual-webkit is missing 1 baselines: d-two/)
  assert.doesNotThrow(() => requireVisual(root, { ...env, BROWSER: 'chromium' }))
})

test('ordinary contributor runs do not require local visual baselines', t => {
  const { root } = fixture(t)
  assert.doesNotThrow(() => requireVisual(root, {}))
  assert.throws(() => requireVisual(root, { REQUIRE_VISUAL: '1' }), /no demos/)
})

test('browser gate rejects baseline-update flags resolved from Vite env files', t => {
  const { root } = fixture(t)
  writeFileSync(join(root, '.env.test.local'), 'VITE_UPDATE_VISUAL=1\n')
  const resolved = loadEnv('test', root)
  const update = ['1', 'true', 'yes'].includes(String(resolved.VITE_UPDATE_VISUAL).toLowerCase())
  assert.equal(update, true)
  assert.throws(() => assertVisualBaselineMode(true, update), /cannot update visual baselines/)
  assert.doesNotThrow(() => assertVisualBaselineMode(false, update))
  assert.doesNotThrow(() => assertVisualBaselineMode(true, false))
})

test('freshness checks both bundles, source, build config and package version', t => {
  const { root, put } = fixture(t)
  put('src/index.js')
  put('esbuild.config.mjs')
  put('package.json')
  put('dist/snapdom.mjs', 20)
  assert.equal(distNeedsBuild(root), true, 'missing browser bundle')
  put('dist/snapdom.js', 5)
  assert.equal(distNeedsBuild(root), true, 'stale browser bundle')
  put('dist/snapdom.js', 20)
  assert.equal(distNeedsBuild(root), false)
  for (const input of ['src/index.js', 'esbuild.config.mjs', 'package.json']) {
    put(input, 30)
    assert.equal(distNeedsBuild(root), true, input)
    put(input, 10)
  }
})

test('network gate tightens on a confirmed mid-run slowdown, not on one slow reading', async t => {
  // 100KB answered after `delay` ms: 400ms reads ~250KB/s, between the run threshold (120) and
  // the idle one scaled for three workers (360); 1200ms reads ~83KB/s, below both.
  let delay = 0
  const body = Buffer.alloc(100 * 1024)
  const server = createServer((req, res) => setTimeout(() => res.end(body), delay))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}/`
  const gate = createNetworkGate({ payload: [url], warmup: url, workers: 3, ttlMs: 1 })
  const read = async (ms) => { delay = ms; await new Promise(r => setTimeout(r, 5)); return (await gate.status()).mode }

  assert.equal(await read(0), 'parallel')     // the idle reading before any browser starts
  assert.equal(await read(400), 'parallel')   // mid-run load is already in the reading
  assert.equal(await read(1200), 'parallel')  // one slow reading: a CPU spike looks like this
  assert.equal(await read(1200), 'serial')    // confirmed by the next one
  assert.equal(await read(0), 'serial')       // and never relaxed inside the run
})
