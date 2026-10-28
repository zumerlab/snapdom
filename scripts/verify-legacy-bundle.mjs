import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const jquery = function jquery() {}
const sandbox = { $: jquery }
sandbox.window = sandbox
const before = new Set(Object.getOwnPropertyNames(sandbox))

const bundle = readFileSync(new URL('../dist/snapdom.js', import.meta.url), 'utf8')
// The html-in-canvas engine ships in the default build; a define kept it out through 3.5.0.
assert.match(bundle, /drawElementImage/, 'dist/snapdom.js left out the html-in-canvas engine')
vm.runInNewContext(bundle, sandbox)

assert.equal(sandbox.$, jquery, 'dist/snapdom.js overwrote window.$')
assert.equal(typeof sandbox.snapdom, 'function', 'window.snapdom is not a function')
assert.deepEqual(
  Object.getOwnPropertyNames(sandbox).filter((name) => !before.has(name)).sort(),
  ['snapdom'],
  'dist/snapdom.js leaked internal globals'
)
