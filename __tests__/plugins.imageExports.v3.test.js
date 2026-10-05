/** Verify official image exports against captured pixels and v3 export options. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPlugins, snapdom } from '../src/index.js'
import { asciiExport } from '../packages/plugins/ascii-export.js'

const mounted = []
afterEach(() => {
  mounted.splice(0).forEach(el => el.remove())
  clearPlugins()
  vi.restoreAllMocks()
})

function box(css = '') {
  const el = document.createElement('div')
  el.style.cssText = `width:80px;height:40px;${css}`
  document.body.append(el)
  mounted.push(el)
  return el
}

describe('official ASCII export on v3', () => {
  it('keeps character width independent of capture width and maps dark pixels to dense characters', async () => {
    const result = await snapdom(box('background:linear-gradient(to right, black 50%, white 50%)'), {
      width: 160, dpr: 1, embedFonts: false, plugins: [asciiExport({ width: 8, charset: ' @' })],
    })
    expect(await result.toAscii()).toBe('@@@@    \n'.repeat(2))
    expect(await result.toAscii({ width: 4, invert: true })).toBe('  @@\n')
  })

  it('keeps one row for a wide capture and treats transparency as the light background', async () => {
    const result = await snapdom(box('width:1000px;height:1px'), {
      dpr: 1, embedFonts: false, plugins: [asciiExport({ width: 4, charset: ' @' })],
    })
    expect(await result.toAscii()).toBe('    \n')
  })

  it('exports frozen pixels repeatedly without entering image export hooks', async () => {
    const el = box('background:black')
    const seen = []
    const result = await snapdom(el, { dpr: 1, embedFonts: false, plugins: [
      asciiExport({ width: 4, charset: ' @' }),
      { name: 'observe', beforeExport(_ctx, { format }) { seen.push(format) } },
    ] })
    el.style.background = 'white'
    expect(await result.toAscii()).toBe('@@@@\n')
    expect(await result.toAscii()).toBe('@@@@\n')
    expect(seen).toEqual(['ascii', 'ascii'])
  })

  it('renders colored HTML with preserved spacing and escaped ramp characters', async () => {
    const result = await snapdom(box('background:linear-gradient(to right, red 50%, white 50%)'), {
      dpr: 1, embedFonts: false, plugins: [asciiExport({ width: 4, charset: ' <' })],
    })
    const html = await result.toAscii({ format: 'html', contrast: 0.8 })
    const template = document.createElement('template')
    template.innerHTML = html
    const pre = template.content.querySelector('pre')
    expect(pre.textContent).toBe('<<  \n')
    expect(pre.style.whiteSpace).toBe('pre')
    expect(pre.querySelectorAll('span').length).toBe(4)
    expect(pre.querySelector('span').style.color).toBe('rgb(255, 0, 0)')
    expect(html).toContain('&lt;')
    expect(await result.toAscii()).toBe('<<  \n')
    await expect(result.toAscii({ contrast: -1 })).rejects.toThrow('contrast')
  })

})
