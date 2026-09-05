import { afterEach, expect, it, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'
import { sanitizeClone } from '../packages/plugins/redact-clone.js'

const mounted = []
const options = { burst: false, embedFonts: false, dpr: 1, scale: 1 }
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })
function mount(node) {
  document.body.appendChild(node)
  mounted.push(node)
  return node
}
function html(markup) {
  const node = document.createElement('div')
  node.style.cssText = 'width:160px;height:80px'
  node.innerHTML = markup
  return mount(node)
}
const raw = result => decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
const xml = result => new DOMParser().parseFromString(raw(result), 'image/svg+xml')
function png() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 3
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ed1545'
  ctx.fillRect(0, 0, 3, 3)
  return canvas.toDataURL()
}

it('keeps a fully blocked root empty after source backgrounds and pseudo content are processed', async () => {
  const image = png()
  const root = html('ROOT-SECRET')
  root.id = 'blocked-capture-root'
  root.style.backgroundImage = `url("${image}")`
  const style = document.createElement('style')
  style.textContent = '#blocked-capture-root::before{content:"PSEUDO-SECRET"}'
  mount(style)
  const result = await snapdom(root, {
    ...options, plugins: [redactInputs({ blocks: '#blocked-capture-root' })],
  })
  const text = raw(result)
  expect(text).not.toContain('ROOT-SECRET')
  expect(text).not.toContain('PSEUDO-SECRET')
  expect(text).not.toContain(image)
  const canvas = await result.toCanvas()
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  expect(pixels.some((value, i) => i % 4 === 3 && value !== 0)).toBe(false)
  expect(root.textContent).toBe('ROOT-SECRET')
})

it('removes a blocked external SVG definition copied through an unblocked use reference', async () => {
  const definitions = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  definitions.style.cssText = 'position:absolute;width:0;height:0'
  definitions.innerHTML = '<defs><symbol id="private-symbol"><title>DEFINITION-SECRET</title><rect width="30" height="30" fill="red"/></symbol></defs>'
  mount(definitions)
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  root.setAttribute('width', '30')
  root.setAttribute('height', '30')
  root.innerHTML = '<use href="#private-symbol"/>'
  mount(root)
  const result = await snapdom(root, {
    ...options, plugins: [redactInputs({ blocks: '#private-symbol' })],
  })
  expect(raw(result)).not.toContain('DEFINITION-SECRET')
  expect(xml(result).querySelector('symbol')).toBeNull()
  expect(definitions.querySelector('symbol').textContent).toBe('DEFINITION-SECRET')
})

it('removes attributes from unmapped external SVG definitions using the original selector context', async () => {
  const definitions = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  definitions.id = 'definition-scope'
  definitions.style.cssText = 'position:absolute;width:0;height:0'
  definitions.innerHTML = '<defs><symbol id="attribute-symbol" data-account="SVG-ACCOUNT-SECRET"><rect data-account="SVG-CHILD-SECRET" width="30" height="30"/></symbol></defs>'
  mount(definitions)
  const root = html('<svg width="30" height="30"><use href="#attribute-symbol"/></svg>')
  const result = await snapdom(root, {
    ...options,
    plugins: [redactInputs({ attributes: [{ selector: '#definition-scope symbol, #definition-scope rect', names: ['data-account'] }] })],
  })
  expect(raw(result)).not.toContain('SVG-ACCOUNT-SECRET')
  expect(raw(result)).not.toContain('SVG-CHILD-SECRET')
  expect(xml(result).querySelector('#attribute-symbol')).not.toBeNull()
})

it('matches all unmapped clone nodes before deleting attributes used by descendant selectors', () => {
  const original = html('<section class="private"><span data-account="ACCOUNT-SECRET">Visible</span></section>')
  const clone = original.cloneNode(true)
  const policy = {
    isBlocked: () => false,
    redactedNames(node) {
      const names = new Set()
      if (node.matches('.private')) names.add('class')
      if (node.matches('.private [data-account]')) names.add('data-account')
      return names
    },
  }
  sanitizeClone({ clone, element: original, nodeMap: new Map() }, policy)
  expect(clone.querySelector('section').hasAttribute('class')).toBe(false)
  expect(clone.querySelector('span').hasAttribute('data-account')).toBe(false)
})

it('clears dirty input and textarea values as well as their serialized value attributes', async () => {
  const root = html('<input value="DEFAULT-INPUT-SECRET"><textarea>DEFAULT-TEXTAREA-SECRET</textarea>')
  root.querySelector('input').value = 'DIRTY-INPUT-SECRET'
  root.querySelector('textarea').value = 'DIRTY-TEXTAREA-SECRET'
  const observed = []
  const observer = { name: 'observe-empty-fields', afterClone(ctx) {
    for (const field of ctx.clone.querySelectorAll('input,textarea')) observed.push([field.value, field.hasAttribute('value')])
  } }
  const result = await snapdom(root, {
    ...options,
    plugins: [redactInputs({ types: [], autocomplete: [], attributes: [{ selector: 'input,textarea', names: ['value'] }] }), observer],
  })
  expect(observed).toEqual([['', false], ['', false]])
  expect(raw(result)).not.toContain('SECRET')
  expect(root.querySelector('input').value).toBe('DIRTY-INPUT-SECRET')
  expect(root.querySelector('textarea').value).toBe('DIRTY-TEXTAREA-SECRET')
})

it('reapplies exact style removal after background inlining and before layout reconciliation', async () => {
  const root = html('<div id="strip-late-style" style="width:90px;height:30px;background-image:linear-gradient(red,blue)">Visible</div>')
  const result = await snapdom(root, {
    ...options, reconcile: true,
    plugins: [redactInputs({ attributes: [{ selector: '#strip-late-style', names: ['style'] }] })],
  })
  const target = xml(result).querySelector('#strip-late-style')
  expect(target.hasAttribute('style'), target.outerHTML).toBe(false)
  expect(root.querySelector('#strip-late-style').hasAttribute('style')).toBe(true)
})

it('does not invoke a custom field masker again in the final attribute pass', async () => {
  const root = html('<input type="email" value="secret@example.test" data-account="ATTRIBUTE-SECRET">')
  const mask = vi.fn(() => 'MASKED')
  const result = await snapdom(root, {
    ...options,
    plugins: [redactInputs({ mask, attributes: [{ selector: 'input', names: ['data-account'] }] })],
  })
  expect(mask).toHaveBeenCalledTimes(1)
  expect(xml(result).querySelector('input').getAttribute('value')).toBe('MASKED')
  expect(raw(result)).not.toContain('ATTRIBUTE-SECRET')
})
