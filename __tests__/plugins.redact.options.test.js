import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'
import { htmlExport } from '../packages/plugins/html-export.js'

const mounted = []
const options = { dpr: 1, scale: 1, embedFonts: false }
const raw = result => decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
function mount(markup) {
  const root = document.createElement('div')
  root.style.cssText = 'width:160px;height:80px;background:white;color:black;font:16px Arial'
  root.innerHTML = markup
  document.body.append(root)
  mounted.push(root)
  return root
}
afterEach(() => mounted.splice(0).forEach(root => root.remove()))
async function pixels(result) {
  const canvas = await result.toCanvas()
  return { width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data }
}

describe('redactInputs extended options', () => {
  it.each([
    { blocks: [null] }, { blocks: '' }, { blocks: {} },
    { attributes: {} }, { attributes: [{ selector: '', names: ['id'] }] },
    { attributes: [{ selector: 'div', names: ['data-*'] }] },
  ])('rejects malformed rules instead of returning a misleadingly private capture (%j)', invalid => {
    expect(() => redactInputs(invalid)).toThrow(TypeError)
  })

  it.each([{ blocks: '[' }, { attributes: [{ selector: '[', names: ['id'] }] }])('rejects an invalid new selector before cloning (%j)', async rules => {
    let cloned = false
    const root = mount('PRIVATE-CONTENT')
    await expect(snapdom(root, { ...options, plugins: [redactInputs(rules), {
      name: 'observe-invalid-rules', afterClone() { cloned = true },
    }] })).rejects.toThrow('invalid privacy selector')
    expect(cloned).toBe(false)
    expect(root.textContent).toBe('PRIVATE-CONTENT')
  })

  it('keeps public pixels and layout while hiding a block in both SVG and HTML', async () => {
    const root = mount('<div class="private" style="height:30px;background:blue">PRIVATE-TEXT</div><div style="height:40px;background:red">Public</div>')
    const original = root.outerHTML
    const result = await snapdom(root, { ...options, plugins: [htmlExport(), redactInputs({ blocks: '.private' })] })
    expect(raw(result)).not.toContain('PRIVATE-TEXT')
    const html = await result.toHtml()
    expect(html).not.toContain('PRIVATE-TEXT')
    expect(html).toContain('Public')
    expect(root.outerHTML).toBe(original)
    root.querySelector('.private').style.visibility = 'hidden'
    expect(await pixels(result)).toEqual(await pixels(await snapdom(root, options)))
  })

  it('merges block selectors with frozen capture exclusions without mutating caller options', async () => {
    const root = mount('<div class="excluded">EXCLUDED-CONTENT</div><div class="private">PRIVATE-CONTENT</div><b>Public</b>')
    const exclude = Object.freeze(['.excluded'])
    const blocks = Object.freeze(['.private'])
    const plugins = [redactInputs({ blocks })]
    for (const excludeMode of ['hide', 'remove']) {
      const result = await snapdom(root, { ...options, exclude, excludeMode, plugins })
      expect(raw(result)).not.toContain('EXCLUDED-CONTENT')
      expect(raw(result)).not.toContain('PRIVATE-CONTENT')
      expect(raw(result)).toContain('Public')
    }
    expect(exclude).toEqual(['.excluded'])
    expect(blocks).toEqual(['.private'])
  })

  it('reevaluates source ancestors outside the capture root on repeated captures', async () => {
    const parent = mount('<section style="width:160px;height:60px">PRIVATE-CONTENT</section>')
    const root = parent.firstElementChild
    const captureOptions = { ...options, plugins: [redactInputs({ blocks: '.private' })] }
    const visible = await snapdom(root, captureOptions)
    expect(raw(visible)).toContain('PRIVATE-CONTENT')
    parent.classList.add('private')
    const hidden = await snapdom(root, captureOptions)
    expect(raw(hidden)).not.toContain('PRIVATE-CONTENT')
    expect((await pixels(hidden)).data.some((value, i) => i % 4 === 3 && value !== 0)).toBe(false)
    await expect(snapdom(root, { ...captureOptions, excludeMode: 'remove' })).rejects.toThrow('cannot remove the capture root')
    parent.classList.remove('private')
    expect(raw(await snapdom(root, captureOptions))).toContain('PRIVATE-CONTENT')
    expect(root.textContent).toBe('PRIVATE-CONTENT')
  })

  it('removes metadata without changing any rendered pixels or the source DOM', async () => {
    const root = mount('<a href="#PRIVATE-HREF" data-token="PRIVATE-TOKEN" title="PRIVATE-TITLE">Public text</a>')
    const original = root.outerHTML
    const baseline = await snapdom(root, options)
    const result = await snapdom(root, { ...options, plugins: [redactInputs({ attributes: [
      { selector: 'a', names: ['href', 'data-token', 'title'] },
    ] }), htmlExport()] })
    expect(raw(result)).not.toContain('PRIVATE-')
    expect(await result.toHtml()).not.toContain('PRIVATE-')
    expect(await pixels(result)).toEqual(await pixels(baseline))
    expect(root.outerHTML).toBe(original)
  })

  it('keeps a directly captured slotted child inside its private rendered ancestor', async () => {
    const host = mount('<span style="display:block;width:160px;height:30px">PRIVATE-SLOTTED-CONTENT</span>')
    host.attachShadow({ mode: 'open' }).innerHTML = '<section class="private"><slot></slot></section>'
    const child = host.firstElementChild
    const result = await snapdom(child, { ...options, plugins: [redactInputs({ blocks: '.private' })] })
    expect(raw(result)).not.toContain('PRIVATE-SLOTTED-CONTENT')
    expect((await pixels(result)).data.some((value, i) => i % 4 === 3 && value !== 0)).toBe(false)
    expect(child.textContent).toBe('PRIVATE-SLOTTED-CONTENT')
  })
})
