// Top-layer fidelity: an open modal <dialog> paints above everything with a ::backdrop;
// the clone must replicate paint order (moved to end of root) and synthesize the backdrop.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

describe('top-layer dialog/popover', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-tl-test]').forEach((s) => s.remove())
    document.body.innerHTML = ''
  })

  it('open modal dialog gets lifted and its ::backdrop synthesized', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-tl-test', '')
    style.textContent = 'dialog::backdrop { background-color: rgba(10, 20, 30, 0.6); }'
    document.head.appendChild(style)

    const host = document.createElement('div')
    host.style.cssText = 'width:300px;height:200px;position:relative'
    const content = document.createElement('p')
    content.textContent = 'detrás'
    const dialog = document.createElement('dialog')
    dialog.textContent = 'modal'
    host.appendChild(content)
    host.appendChild(dialog)
    document.body.appendChild(host)
    dialog.showModal()

    try {
      const res = await snapdom(host, { cache: 'disabled' })
      const svg = decodeURIComponent(res.url.split(',')[1])
      expect(svg).toContain('data-sd-backdrop')
      expect(svg).toContain('rgba(10, 20, 30, 0.6)')
      // The dialog clone paints after the backdrop (appended later in the markup).
      expect(svg.indexOf('data-sd-backdrop')).toBeLessThan(svg.indexOf('>modal<'))
    } finally {
      dialog.close()
    }
  })

  it('no top-layer content → no synthesized backdrop, zero output change', async () => {
    const host = document.createElement('div')
    host.textContent = 'plain'
    document.body.appendChild(host)
    const res = await snapdom(host, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).not.toContain('data-sd-backdrop')
  })
})
