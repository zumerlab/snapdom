import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { htmlExport } from '../packages/plugins/html-export.js'

/**
 * html-export is a render ENGINE, not an exporter: its input is the finished clone, not
 * pixels. It used to reach that clone the long way around, because defineExports runs after
 * core releases the stage fields:
 *
 *   clone -> serialize to SVG -> decodeURIComponent -> DOMParser -> querySelector('div')
 *
 * Now it serializes the clone once in afterRender, where the clone is still alive and
 * already sits inside the container the SVG engine built. These tests pin the two
 * observable consequences: no DOM re-parse, and no dependency on the URL being an SVG.
 */

function mount(html) {
  const host = document.createElement('div')
  host.style.cssText = 'width:200px;background:#fff'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

afterEach(() => { document.body.innerHTML = '' })

describe('html-export consumes the clone, not its own output', () => {
  it('exports without re-parsing the serialized SVG', async () => {
    const host = mount('<p class="hi">hola</p>')
    const res = await snapdom(host, { plugins: [htmlExport()] })

    const spy = vi.spyOn(DOMParser.prototype, 'parseFromString')
    const html = await res.toHtml()
    const callsDuringExport = spy.mock.calls.length

    // Control: the spy is live and would have counted the old path's single parse.
    new DOMParser().parseFromString('<a/>', 'image/svg+xml')
    expect(spy.mock.calls.length).toBe(callsDuringExport + 1)
    spy.mockRestore()

    expect(callsDuringExport).toBe(0)
    expect(html).toContain('hola')
  })

  it('still produces the captured markup and the capture CSS', async () => {
    const host = mount('<p class="hi">contenido</p>')
    const res = await snapdom(host, { plugins: [htmlExport()] })
    const html = await res.toHtml()

    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('contenido')
    expect(html).toContain('<style>')
    // The clone's generated classes must be present in BOTH halves, or the document
    // renders unstyled: that pairing is the whole point of a re-renderable export.
    const cls = (html.match(/class="([^"]+)"/) || [])[1]
    expect(cls).toBeTruthy()
    for (const c of cls.split(/\s+/)) {
      if (c) { expect(html).toContain(`.${c}`); break }
    }
  })

  it('fragment mode returns style + body without the document wrapper', async () => {
    const host = mount('<p>fragmento</p>')
    const res = await snapdom(host, { plugins: [htmlExport()] })
    const html = await res.toHtml({ fullDocument: false })
    expect(html).not.toContain('<!DOCTYPE html>')
    expect(html).toContain('<style>')
    expect(html).toContain('fragmento')
  })

  it('declaring pure keeps the capture eligible for the fast paths', async () => {
    // afterRender is a render hook, so without `pure: true` this plugin would suspend
    // auto-memoization for every capture that uses it. It only reads, so pure is honest.
    const p = htmlExport()
    expect(p.pure).toBe(true)
    expect(typeof p.afterRender).toBe('function')
  })

  it('a capture that never rendered explains itself instead of returning empty HTML', async () => {
    const host = mount('<p>x</p>')
    const plugin = htmlExport()
    // Export without a render having happened: defineExports has no frozen body.
    const exports = plugin.defineExports()
    await expect(exports.html({ artifacts: null })).rejects.toThrow(/no render/i)
    host.remove()
  })
})
