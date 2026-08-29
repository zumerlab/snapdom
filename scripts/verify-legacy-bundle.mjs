import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const jquery = function jquery() {}
const sandbox = { $: jquery }
sandbox.window = sandbox
const before = new Set(Object.getOwnPropertyNames(sandbox))

vm.runInNewContext(
  readFileSync(new URL('../dist/snapdom.js', import.meta.url), 'utf8'),
  sandbox
)

assert.equal(sandbox.$, jquery, 'dist/snapdom.js overwrote window.$')
assert.equal(typeof sandbox.snapdom, 'function', 'window.snapdom is not a function')
assert.equal(typeof sandbox.preCache, 'function', 'window.preCache is not a function')
assert.deepEqual(
  Object.getOwnPropertyNames(sandbox).filter((name) => !before.has(name)).sort(),
  ['preCache', 'snapdom'],
  'dist/snapdom.js leaked internal globals'
)
