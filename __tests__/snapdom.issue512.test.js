import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { htmlExport } from '../packages/plugins/html-export.js'

// #512: the ::placeholder color rule was prepended as a <style> child of the cloned
// <input>. <input> is a void element: Safari serialized it as an input that is never
// closed, so the SVG was malformed and the whole capture failed to decode, and HTML
// serialization (html-export's outerHTML) dropped the rule, losing the placeholder color.

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
  // WebKit reports the element's own color for ::placeholder; assert what the engine reads.
  const color = getComputedStyle(target.querySelector('input'), '::placeholder').color
  return { target, rule: (cls) => `.${cls}::placeholder{color:${color}!important` }
}

describe('empty input with a styled placeholder (#512)', () => {
  it('decodes the capture', async () => {
    const { target } = mount()
    const img = await (await snapdom(target, { embedFonts: false })).toImg()
    await img.decode()
    expect(img.naturalWidth).toBeGreaterThan(0)
  })

  it('keeps the placeholder rule in the capture CSS, not inside the input', async () => {
    const { target, rule } = mount()
    const svg = decodeSvg(await snapdom(target, { embedFonts: false }))
    const input = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('input')
    expect(input.childNodes.length).toBe(0)
    const phClass = [...input.classList].find(c => c.startsWith('snapdom-ph-'))
    expect(phClass).toBeTruthy()
    expect(svg).toContain(rule(phClass))
  })

  it('keeps the placeholder color in the html-export output', async () => {
    const { target, rule } = mount()
    const result = await snapdom(target, { embedFonts: false, plugins: [htmlExport()] })
    const html = await result.toHtml()
    const phClass = html.match(/class="[^"]*(snapdom-ph-\d+)/)?.[1]
    expect(phClass).toBeTruthy()
    expect(html).toContain(rule(phClass))
  })
})
