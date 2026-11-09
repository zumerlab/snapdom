import { describe, it, expect } from 'vitest'

// Each barrel is the documented combined-import form (README: "All: import { filter,
// asciiExport } from '@zumer/snapdom-plugins'"). A single broken named re-export there throws
// at module-evaluation time and takes every plugin down with it, so guard against that. The
// helpers next to a plugin ship through the barrel too: index.d.ts re-exports every subpath
// whole, so a name it declares has to exist at runtime (asciiStream did not). The exact key
// set also pins what the 5.0 split moved out: pdf, vector and stream are their own packages.
const BARRELS = [
  ['packages/plugins', () => import('../packages/plugins/index.js'), [
    'timestampOverlay', 'asciiExport', 'asciiFromCanvas', 'replaceText', 'filter', 'colorTint',
    'agentMap', 'contextExport', 'htmlExport', 'gifExport', 'videoExport', 'redactInputs',
  ]],
  ['packages/pdf', () => import('../packages/pdf/index.js'), ['default', 'pdf']],
  ['packages/vector', () => import('../packages/vector/index.js'), ['default', 'vector']],
  ['packages/stream', () => import('../packages/stream/index.js'), [
    'stream', 'streamExport', 'streamTexture', 'recordCanvas', 'overlayStage', 'scoreboard', 'lowerThird', 'ticker', 'liveBadge',
  ]],
]

describe('package barrels', () => {
  for (const [name, load, names] of BARRELS) {
    it(`${name}/index.js resolves exactly its named exports, each a function`, async () => {
      const mod = await load()
      for (const key of names) expect(mod[key], `expected a "${key}" export`).toBeTypeOf('function')
      expect(Object.keys(mod).sort()).toEqual([...names].sort())
    })
  }
})
