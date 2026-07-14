import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { clearPlugins } from '../src/core/plugins.js'

describe('resolveNode per-node plugin hook', () => {
  let el
  afterEach(() => {
    el?.remove()
    clearPlugins()
  })

  it('replaces matched nodes with the returned clone', async () => {
    el = document.createElement('div')
    el.innerHTML = '<span data-secret>hidden-payload</span><span>visible-text</span>'
    document.body.appendChild(el)
    const plugin = {
      name: 'redact',
      resolveNode(node) {
        if (node.nodeType === 1 && node.hasAttribute?.('data-secret')) {
          const s = document.createElement('span')
          s.textContent = 'REDACTED'
          return s
        }
      },
    }
    const result = await snapdom(el, { plugins: [plugin] })
    const svg = decodeURIComponent(result.url)
    expect(svg).toContain('REDACTED')
    expect(svg).not.toContain('hidden-payload')
    expect(svg).toContain('visible-text')
  })

  it('skips nodes when the hook returns null', async () => {
    el = document.createElement('div')
    el.innerHTML = '<span class="drop">drop-me</span><span>keep-me</span>'
    document.body.appendChild(el)
    const plugin = {
      name: 'dropper',
      resolveNode: (node) =>
        node.nodeType === 1 && node.classList?.contains('drop') ? null : undefined,
    }
    const result = await snapdom(el, { plugins: [plugin] })
    const svg = decodeURIComponent(result.url)
    expect(svg).not.toContain('drop-me')
    expect(svg).toContain('keep-me')
  })

  it('undefined falls through to the normal pipeline', async () => {
    el = document.createElement('div')
    el.textContent = 'plain-content'
    document.body.appendChild(el)
    const plugin = { name: 'noop-hook', resolveNode: () => undefined }
    const result = await snapdom(el, { plugins: [plugin] })
    expect(decodeURIComponent(result.url)).toContain('plain-content')
  })
})
