import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { htmlExport } from '../packages/plugins/html-export.js'

// #512: a <style> child of a void <input> is dropped by HTML serialization and left Safari's
// SVG unclosed. Color now rides as --sd-ph/--sd-ph-o on the clone; a static prefix rule paints
// [data-sd-ph]::placeholder. Playwright's WebKit is not Safari — `decodes the capture` passes
// on main too and does not reproduce #512. The structural assertions (no children on the
// input) are what pin the void-element fix.

const PLACEHOLDER_RULE = '[data-sd-ph]::placeholder{color:var(--sd-ph)!important;opacity:var(--sd-ph-o)!important;-webkit-text-fill-color:var(--sd-ph)!important}'

function decodeSvg(result) {
  const raw = result.toRaw()
  return decodeURIComponent(raw.slice(raw.indexOf(',') + 1))
}

let nodes = []

afterEach(() => {
  for (const n of nodes) n.remove()
  nodes = []
})

function mount() {
  const style = document.createElement('style')
  style.textContent = '#sd512 input::placeholder{color:rgb(153, 153, 153)}'
  document.head.appendChild(style)
  const target = document.createElement('div')
  target.id = 'sd512'
  target.innerHTML = '<input placeholder="Search"><div>after</div>'
  document.body.appendChild(target)
  nodes.push(style, target)
  return target
}

describe('empty input with a styled placeholder (#512)', () => {
  it('decodes the capture', async () => {
    const target = mount()
    const img = await (await snapdom(target, { embedFonts: false })).toImg()
    await img.decode()
    expect(img.naturalWidth).toBeGreaterThan(0)
  })

  it('keeps the placeholder rule in the capture CSS, not inside the input', async () => {
    const target = mount()
    const svg = decodeSvg(await snapdom(target, { embedFonts: false }))
    const input = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('input')
    expect(input.childNodes.length).toBe(0)
    expect(input.hasAttribute('data-sd-ph')).toBe(true)
    expect(input.getAttribute('style') || '').toContain('--sd-ph')
    expect(svg).toContain(PLACEHOLDER_RULE)
  })

  it('keeps the placeholder color in the html-export output', async () => {
    const target = mount()
    const result = await snapdom(target, { embedFonts: false, plugins: [htmlExport()] })
    const html = await result.toHtml()
    expect(html).toContain(PLACEHOLDER_RULE)
    expect(html).toMatch(/data-sd-ph/)
  })
})
