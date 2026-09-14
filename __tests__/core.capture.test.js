import { describe, it, expect, vi, afterEach } from 'vitest'
import { captureDOM } from '../src/core/capture.js'

afterEach(() => vi.restoreAllMocks())

describe('captureDOM edge cases', () => {
  it('throws for unsupported element (unknown nodeType)', async () => {
    const fakeNode = { nodeType: 999 }
    // Options provided on purpose: with none, the rejection was a TypeError on undefined
    // options hit BEFORE anything looked at the node, so the test passed for the wrong reason.
    await expect(captureDOM(fakeNode, {})).rejects.toThrow()
  })

  it('throws if element is null', async () => {
    await expect(captureDOM(null)).rejects.toThrow()
  })

  it('throws error if getBoundingClientRect fails', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => { throw new Error('fail') })

    const el = document.createElement('div')
    await expect(captureDOM(el, {})).rejects.toThrow(/fail/)
  })
})

describe('captureDOM functional', () => {
  it('captures a simple div and returns an SVG dataURL', async () => {
    const el = document.createElement('div')
    el.textContent = 'test'
    const url = await captureDOM(el, { embedFonts: false })
    expect(url.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('supports scale and width/height options', async () => {
    const el = document.createElement('div')
    el.style.width = '100px'
    el.style.height = '50px'
    for (const opts of [{ scale: 2 }, { width: 200 }, { height: 100 }]) {
      const url = await captureDOM(el, opts)
      expect(url.startsWith('data:image/svg+xml')).toBe(true)
    }
  })

  it('supports embedFonts (stubbed)', async () => {
    // opcional: stub para que no haga IO real
    // const mod = await import('../src/modules/fonts.js');
    // vi.spyOn(mod, 'embedCustomFonts').mockResolvedValue('/* inlined */');

    const el = document.createElement('div')
    await captureDOM(el, { embedFonts: true })
  })
})
