import { it, expect } from 'vitest'
import '../src/index.browser.js'

// The browser entry's whole contract is the two globals it assigns — CLAUDE.md calls this
// load-bearing ("the entry owns the global"): the file exports nothing, so asserting the
// imported namespace is defined could never fail. Assert what the entry actually promises.
it('assigns window.snapdom', () => {
  expect(typeof window.snapdom).toBe('function')
})
