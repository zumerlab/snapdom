import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import requireVisual from './require-visual.mjs'
import { distNeedsBuild } from './ensure-fresh-dist.mjs'
import { assertVisualBaselineMode } from './visual-policy.mjs'
import { loadEnv } from 'vite'

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
