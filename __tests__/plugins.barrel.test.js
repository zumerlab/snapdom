import { describe, it, expect } from 'vitest'

// The barrel is the documented combined-import form (README: "All: import { filter,
// asciiExport } from '@zumer/snapdom-plugins'"). A single broken named re-export here
// throws at module-evaluation time and takes every plugin down with it — guard against that.
describe('packages/plugins/index.js barrel export', () => {
  it('resolves every named export as a function', async () => {
    const mod = await import('../packages/plugins/index.js')
    const names = [
      'timestampOverlay', 'asciiExport', 'replaceText', 'filter', 'colorTint',
      'pdfImage', 'agentMap', 'htmlExport', 'gifExport', 'videoExport', 'htmlInCanvas',
    ]
    for (const name of names) {
      expect(mod[name], `expected a "${name}" export`).toBeTypeOf('function')
    }
  })
})
