// snapdom.fromString: capture SSR markup / HTML strings without wiring a mount.
import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

describe('snapdom.fromString', () => {
  it('captures a single-root HTML string with page CSS applied', async () => {
    const style = document.createElement('style')
    style.textContent = '.zz-fs { color: rgb(9, 99, 9); font-weight: 700; }'
    document.head.appendChild(style)
    try {
      const res = await snapdom.fromString('<div class="zz-fs" style="width:120px">desde string</div>')
      const svg = decodeURIComponent(res.url.split(',')[1])
      expect(svg).toContain('desde string')
      expect(svg).toContain('rgb(9, 99, 9)')
      // Mount is cleaned up.
      expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
    } finally {
      style.remove()
    }
  })

  it('multi-root strings capture through the wrapper', async () => {
    const res = await snapdom.fromString('<p>uno</p><p>dos</p>')
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('uno')
    expect(svg).toContain('dos')
  })

  it('rejects empty input', async () => {
    await expect(snapdom.fromString('')).rejects.toThrow()
  })
})
