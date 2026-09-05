import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { agentMap } from '../packages/plugins/agent-map.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'

const mounted = []
const options = { dpr: 1, embedFonts: false, burst: false }
function mount(html) {
  const root = document.createElement('div')
  root.style.cssText = 'width:400px;background:white;color:black;font:16px Arial'
  root.innerHTML = html
  document.body.append(root)
  mounted.push(root)
  return root
}
afterEach(() => mounted.splice(0).forEach(root => root.remove()))

function semanticPlugins() {
  return [agentMap({ image: false, fields: 'full', semantic: true }), contextExport()]
}
async function outputs(result) {
  return {
    map: await result.toAgentMap(),
    outline: await result.toContext(),
    tree: await result.toContext({ format: 'json' }),
  }
}
function flatten(node) {
  return node ? [node, ...(node.children || []).flatMap(flatten)] : []
}

describe('shared redactInputs policy in semantic exports', () => {
  it.each(['first', 'last'])('applies blocks and named attribute rules with the privacy plugin %s', async order => {
    const root = mount('<section class="private-block"><a href="/PRIVATE-BLOCK-LINK">PRIVATE-BLOCK-TEXT</a></section><a data-private-meta id="PRIVATE-ID" class="PRIVATE-CLASS" href="/PRIVATE-HREF" title="PRIVATE-TITLE" aria-label="PRIVATE-ARIA" name="PRIVATE-NAME">Public link</a><input data-private-meta data-private-field value="PRIVATE-FIELD" placeholder="PRIVATE-PLACEHOLDER" aria-label="PRIVATE-FIELD-LABEL">')
    const original = root.outerHTML
    const privacy = redactInputs({
      blocks: '.private-block',
      attributes: [
        { selector: '[data-private-meta]', names: ['id', 'class', 'href', 'title', 'aria-label', 'name', 'placeholder'] },
        { selector: '[data-private-field]', names: ['value'] },
      ],
    })
    const semantics = semanticPlugins()
    const plugins = order === 'first' ? [privacy, ...semantics] : [...semantics, privacy]
    const out = await outputs(await snapdom(root, { ...options, plugins }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(out.outline).toContain('Public link')
    expect(out.map.map.find(entry => entry.n === 'Public link').a).toBeUndefined()
    const field = out.map.map.find(entry => entry.r === 'textbox')
    expect(field.s.hasValue).toBe(true)
    expect(field.s.value).toBeUndefined()
    expect(flatten(out.tree.root).find(node => node.tag === 'input').state.value).toBeUndefined()
    expect(root.outerHTML).toBe(original)
    expect(root.querySelector('input').value).toBe('PRIVATE-FIELD')
  })

  it('keeps baseline semantic masks when no policy matches and omits only selected field values', async () => {
    const root = mount('<input data-redact aria-label="Selected" value="secret"><input aria-label="Ordinary" value="public"><textarea data-redact aria-label="Notes">private notes</textarea>')
    const baseline = await outputs(await snapdom(root, { ...options, plugins: semanticPlugins() }))
    expect(baseline.map.map.find(entry => entry.n === 'Selected').s.value).toBe('••••••')
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ types: [], autocomplete: [], selector: '[data-redact]', mask: () => 'MASK' }),
    ] }))
    expect(out.map.map.find(entry => entry.n === 'Selected').s.value).toBeUndefined()
    expect(out.map.map.find(entry => entry.n === 'Notes').s.value).toBeUndefined()
    expect(out.map.map.find(entry => entry.n === 'Ordinary').s.value).toBe('••••••')
    const nodes = flatten(out.tree.root)
    expect(nodes.find(node => node.state?.label === 'Selected').state.value).toBeUndefined()
    expect(nodes.find(node => node.state?.label === 'Notes').state.value).toBeUndefined()
    expect(nodes.find(node => node.state?.label === 'Ordinary').state.value).toBe('••••••')
    expect(root.querySelector('textarea').value).toBe('private notes')
  })

  it('blocks private ancestors and descendants of labels outside the capture root', async () => {
    const root = mount('<div class="private"><span id="secret-label">PRIVATE-EXTERNAL-LABEL</span></div><span id="mixed-label">Public <b class="private">PRIVATE-LABEL-DESCENDANT</b> label</span><div data-target><button aria-labelledby="secret-label mixed-label">Public fallback</button></div>')
    const out = await outputs(await snapdom(root.querySelector('[data-target]'), { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ blocks: '.private' }),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(out.map.map[0].n.replace(/\s+/g, ' ')).toBe('Public label')
    expect(root.querySelector('#secret-label').textContent).toBe('PRIVATE-EXTERNAL-LABEL')
  })

  it('honors redacted accessible-name and ARIA state attributes without suppressing public text', async () => {
    const root = mount('<span id="private-label">PRIVATE-LABEL-TEXT</span><button aria-labelledby="private-label" aria-label="PRIVATE-ARIA" title="PRIVATE-TITLE" aria-expanded="true" aria-pressed="false" aria-selected="true">Public fallback</button>')
    const button = root.querySelector('button')
    const out = await outputs(await snapdom(button, { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ attributes: [{ selector: 'button', names: ['aria-labelledby', 'aria-label', 'title', 'aria-expanded', 'aria-pressed', 'aria-selected'] }] }),
    ] }))
    expect(out.map.map[0].n).toBe('Public fallback')
    expect(out.map.map[0].s?.expanded).toBeUndefined()
    expect(out.map.map[0].s?.pressed).toBeUndefined()
    expect(out.map.map[0].s?.selected).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('omits attributes mirrored through native state and names', async () => {
    const root = mount('<input type="checkbox" checked disabled aria-label="Public checkbox"><details open><summary>Public summary</summary></details><img alt="PRIVATE-ALT" title="PRIVATE-TITLE" width="20" height="20">')
    const privacy = redactInputs({ attributes: [
      { selector: 'input', names: ['checked', 'disabled'] },
      { selector: 'details', names: ['open'] },
      { selector: 'img', names: ['alt', 'title'] },
    ] })
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      agentMap({ image: false, fields: 'full', interactiveSelector: 'input, details, img' }), contextExport(), privacy,
    ] }))
    const field = out.map.map.find(entry => entry.r === 'checkbox')
    expect(field.s?.checked).toBeUndefined()
    expect(field.s?.disabled).toBeUndefined()
    expect(out.map.map.find(entry => entry.r === 'group').s?.open).toBeUndefined()
    const nodes = flatten(out.tree.root)
    expect(nodes.find(node => node.tag === 'input').state?.checked).toBeUndefined()
    expect(nodes.find(node => node.tag === 'input').state?.disabled).toBeUndefined()
    expect(nodes.find(node => node.tag === 'details').state?.open).toBeUndefined()
    expect(nodes.find(node => node.tag === 'img').state?.alt).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(root.querySelector('input').checked).toBe(true)
    expect(root.querySelector('input').disabled).toBe(true)
    expect(root.querySelector('details').open).toBe(true)
  })

  it('applies blocked ancestry across a shadow boundary', async () => {
    const root = mount('<div class="private" data-private-host></div><button>Public action</button>')
    const host = root.querySelector('[data-private-host]')
    host.attachShadow({ mode: 'open' }).innerHTML = '<span id="shadow-label">PRIVATE-SHADOW-LABEL</span><button aria-labelledby="shadow-label">PRIVATE-SHADOW-CONTROL</button>'
    const original = host.shadowRoot.innerHTML
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      redactInputs({ blocks: '.private' }), ...semanticPlugins(),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(out.map.map.map(entry => entry.n)).toEqual(['Public action'])
    expect(host.shadowRoot.innerHTML).toBe(original)
  })

  it('blocks composed ancestors of a slotted label outside the capture root', async () => {
    const root = mount('<div data-label-host><span slot="private" id="slotted-label">PRIVATE-SLOTTED-LABEL</span></div><button aria-labelledby="slotted-label">Public fallback</button>')
    const host = root.querySelector('[data-label-host]')
    host.attachShadow({ mode: 'open' }).innerHTML = '<section class="private"><slot name="private"></slot></section>'
    const original = root.outerHTML
    const out = await outputs(await snapdom(root.querySelector('button'), { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ blocks: '.private' }),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(out.map.map[0].n).toBe('Public fallback')
    expect(root.outerHTML).toBe(original)
    expect(host.querySelector('span').assignedSlot).toBe(host.shadowRoot.querySelector('slot'))
  })

  it('omits controls assigned to slots inside blocked shadow sections', async () => {
    const root = mount('<div data-control-host><button slot="private">PRIVATE-SLOTTED-CONTROL</button><button slot="public">Public control</button></div>')
    const host = root.querySelector('[data-control-host]')
    host.attachShadow({ mode: 'open' }).innerHTML = '<section class="private"><slot name="private"></slot></section><div><slot name="public"></slot></div>'
    const out = await outputs(await snapdom(host, { ...options, plugins: [
      redactInputs({ blocks: '.private' }), ...semanticPlugins(),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    expect(out.map.map.map(entry => entry.n)).toEqual(['Public control'])
    expect(out.outline).toContain('Public control')
    expect(host.querySelector('[slot="private"]').textContent).toBe('PRIVATE-SLOTTED-CONTROL')
  })

  it('does not recover blocked selected options through live control state', async () => {
    const root = mount('<select aria-label="Choice"><optgroup class="private" label="PRIVATE-GROUP"><option selected value="PRIVATE-VALUE">PRIVATE-SELECTED-TEXT</option></optgroup><option>Public choice</option></select>')
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ blocks: '.private' }),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    const select = out.map.map.find(entry => entry.r === 'combobox')
    expect(select.s?.value).toBeUndefined()
    expect(select.s?.selectedText).toBeUndefined()
    expect(root.querySelector('select').value).toBe('PRIVATE-VALUE')
  })

  it('does not expose a removed option value through the select property', async () => {
    const root = mount('<select aria-label="Choice"><option selected value="PRIVATE-OPTION-VALUE">Public selected label</option></select>')
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ attributes: [{ selector: 'option', names: ['value'] }] }),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    const select = out.map.map.find(entry => entry.r === 'combobox')
    expect(select.s?.value).toBeUndefined()
    expect(select.s.selectedText).toBe('Public selected label')
    expect(out.outline).toContain('Public selected label')
    expect(root.querySelector('select').value).toBe('PRIVATE-OPTION-VALUE')
  })

  it.each([false, true])('prunes blocked descendants from selected option text with explicit value: %s', async explicitValue => {
    const root = mount('<select aria-label="Choice"></select>')
    const select = root.querySelector('select')
    const option = document.createElement('option')
    const privateText = document.createElement('span')
    privateText.className = 'private'
    privateText.textContent = 'PRIVATE-OPTION-DESCENDANT'
    option.append('Public ', privateText, ' choice')
    if (explicitValue) option.value = 'public-choice'
    select.append(option)
    option.selected = true
    const original = root.outerHTML
    const originalValue = select.value
    const out = await outputs(await snapdom(root, { ...options, plugins: [
      ...semanticPlugins(), redactInputs({ blocks: '.private' }),
    ] }))
    expect(JSON.stringify(out)).not.toContain('PRIVATE-')
    const node = flatten(out.tree.root).find(entry => entry.tag === 'select')
    expect(node.state.value.replace(/\s+/g, ' ')).toBe('Public choice')
    const mapped = out.map.map.find(entry => entry.r === 'combobox')
    expect(mapped.s.selectedText).toBe('Public choice')
    expect(mapped.s.value).toBe(explicitValue ? 'public-choice' : 'Public choice')
    expect(root.outerHTML).toBe(original)
    expect(select.value).toBe(originalValue)
  })

  it.each([false, true])('preserves native reflection with an unmatched privacy policy: %s', async enabled => {
    const root = mount('<input id="native-field" type="unknown-widget" placeholder="Public&#10;placeholder" aria-label="Native field"><select><option selected>Public&nbsp;label</option></select>')
    const plugins = semanticPlugins()
    if (enabled) plugins.push(redactInputs({ attributes: [{ selector: '.absent', names: ['type', 'id', 'placeholder'] }] }))
    const out = await outputs(await snapdom(root, { ...options, plugins }))
    const input = root.querySelector('input')
    expect(out.map.map.find(entry => entry.n === 'Native field').r).toBe('textbox')
    const field = flatten(out.tree.root).find(node => node.tag === 'input')
    expect(field.id).toBe(input.id)
    expect(field.state.placeholder).toBe(input.placeholder)
    expect(out.map.map.find(entry => entry.r === 'combobox').s.selectedText).toBe(root.querySelector('option').text)
  })

  it('keeps policies and frozen semantic snapshots isolated between concurrent captures', async () => {
    const root = mount('<a data-link href="/PRIVATE-HREF">Public link</a><section class="private">PRIVATE-BLOCK-TEXT</section>')
    const semantics = semanticPlugins()
    const privacy = redactInputs({ blocks: '.private', attributes: [{ selector: '[data-link]', names: ['href'] }] })
    const [redacted, plain] = await Promise.all([
      snapdom(root, { ...options, plugins: [...semantics, privacy] }),
      snapdom(root, { ...options, plugins: semantics }),
    ])
    const before = await outputs(redacted)
    const ordinary = await outputs(plain)
    expect(JSON.stringify(before)).not.toContain('PRIVATE-')
    expect(JSON.stringify(ordinary)).toContain('PRIVATE-HREF')
    expect(JSON.stringify(ordinary)).toContain('PRIVATE-BLOCK-TEXT')
    root.querySelector('a').href = '/CHANGED-HREF'
    root.querySelector('a').textContent = 'CHANGED-TEXT'
    root.querySelector('section').textContent = 'CHANGED-BLOCK'
    expect(await outputs(redacted)).toEqual(before)
    expect(await outputs(plain)).toEqual(ordinary)
  })
})
