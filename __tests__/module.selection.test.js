// SEL-1 (fork): the user's live text selection is rendered into the clone.
import { describe, it, expect, afterEach } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { createContext } from '../src/core/context.js'
import { snapdom } from '../src/api/snapdom.js'
import {
  prepareSelectionContext,
  applyTextFieldSelectionLayers,
} from '../src/modules/selection.js'

const added = []

function mount(el) {
  document.body.appendChild(el)
  added.push(el)
  return el
}

function select(node, start, endNode = node, end = start) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(endNode, end)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

afterEach(() => {
  window.getSelection().removeAllRanges()
  while (added.length) added.pop().remove()
})

describe('selection capture (SEL-1)', () => {
  it('prepareSelectionContext is null with no selection', () => {
    const el = mount(document.createElement('div'))
    el.textContent = 'nothing selected'
    expect(prepareSelectionContext(el)).toBeNull()
  })

  it('prepareSelectionContext is null when the selection is elsewhere', () => {
    const el = mount(document.createElement('div'))
    el.textContent = 'not me'
    const other = mount(document.createElement('div'))
    other.textContent = 'me instead'
    select(other.firstChild, 0, other.firstChild, 2)
    expect(prepareSelectionContext(el)).toBeNull()
  })

  it('wraps the selected run with the UA highlight when no rule matches', async () => {
    const el = mount(document.createElement('div'))
    el.textContent = 'hello world'
    select(el.firstChild, 6, el.firstChild, 11)
    const { clone } = await prepareClone(el, createContext({ captureSelection: true }))
    const span = clone.querySelector('[data-snapdom-selection]')
    expect(span).not.toBeNull()
    expect(span.textContent).toBe('world')
    expect(span.style.backgroundColor.toLowerCase()).toBe('highlight')
    // No authored ::selection color: the run keeps the element's own. Gecko resolves the
    // wrapper's `all:unset` into every longhand when read back through the CSSOM, so an
    // untouched colour reads as 'unset' there and '' elsewhere; neither is an authored value.
    expect(['', 'unset']).toContain(span.style.color)
    // The split leaves the text itself intact.
    expect(clone.textContent).toBe('hello world')
  })

  it('carries authored ::selection background and color', async () => {
    const style = mount(document.createElement('style'))
    style.textContent =
      '.sel-authored::selection { background-color: rgb(255, 0, 0); color: rgb(255, 255, 255); }'
    const el = mount(document.createElement('div'))
    el.className = 'sel-authored'
    el.textContent = 'painted'
    select(el.firstChild, 0, el.firstChild, 7)
    const { clone } = await prepareClone(el, createContext({ captureSelection: true }))
    const span = clone.querySelector('[data-snapdom-selection]')
    expect(span).not.toBeNull()
    expect(span.style.backgroundColor).toBe('rgb(255, 0, 0)')
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('spans a selection across elements, wrapping each side\'s run', async () => {
    const el = mount(document.createElement('div'))
    el.innerHTML = '<p>first line</p><p>second line</p>'
    const [a, b] = el.querySelectorAll('p')
    select(a.firstChild, 6, b.firstChild, 6)
    const { clone } = await prepareClone(el, createContext({ captureSelection: true }))
    const spans = clone.querySelectorAll('[data-snapdom-selection]')
    expect(spans.length).toBe(2)
    expect(spans[0].textContent).toBe('line')
    expect(spans[1].textContent).toBe('second')
  })

  it('paints no highlight over user-select: none', async () => {
    const el = mount(document.createElement('div'))
    el.textContent = 'unselectable'
    // Both spellings: this WebKit build does not know the unprefixed property at all, so
    // assigning only that one left the element selectable and the highlight correct.
    el.style.setProperty('user-select', 'none')
    el.style.setProperty('-webkit-user-select', 'none')
    select(el.firstChild, 0, el.firstChild, 12)
    const { clone } = await prepareClone(el, createContext({ captureSelection: true }))
    expect(clone.querySelector('[data-snapdom-selection]')).toBeNull()
  })

  it('is off by default', async () => {
    const el = mount(document.createElement('div'))
    el.textContent = 'selected but unasked'
    select(el.firstChild, 0, el.firstChild, 8)
    const { clone } = await prepareClone(el, createContext())
    expect(clone.querySelector('[data-snapdom-selection]')).toBeNull()
  })

  it('paints a focused input\'s selection as a background layer', async () => {
    const input = mount(document.createElement('input'))
    input.value = 'hello world'
    input.focus()
    input.setSelectionRange(6, 11)
    const { clone, nodeMap } = await prepareClone(input, createContext({ captureSelection: true }))
    applyTextFieldSelectionLayers(nodeMap)
    expect(clone.style.backgroundImage).toContain('linear-gradient')
    expect(clone.style.backgroundRepeat).toContain('no-repeat')
    // One run on one line, plus the trailing transparent clip-carrier layer.
    expect(clone.style.backgroundSize.split(',').length).toBe(2)
  })

  it('paints a wrapped textarea selection as one layer per line box', async () => {
    const textarea = mount(document.createElement('textarea'))
    textarea.style.width = '120px'
    textarea.style.font = '16px monospace'
    textarea.value = 'a long value that will definitely wrap across several lines'
    textarea.focus()
    textarea.setSelectionRange(2, 45)
    const { clone, nodeMap } = await prepareClone(textarea, createContext({ captureSelection: true }))
    applyTextFieldSelectionLayers(nodeMap)
    const highlights = clone.style.backgroundImage
      .split('linear-gradient').length - 1
    // Several line boxes plus the trailing transparent layer.
    expect(highlights).toBeGreaterThan(2)
  })

  it('paints no field highlight while the field is unfocused', async () => {
    const input = mount(document.createElement('input'))
    input.value = 'hello world'
    input.setSelectionRange(0, 5)
    expect(document.activeElement).not.toBe(input)
    const { clone, nodeMap } = await prepareClone(input, createContext({ captureSelection: true }))
    applyTextFieldSelectionLayers(nodeMap)
    expect(clone.style.backgroundImage).toBe('')
  })

  it('carries an authored ::selection background into a field highlight', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.sel-field::selection { background-color: rgb(0, 128, 0); }'
    const input = mount(document.createElement('input'))
    input.className = 'sel-field'
    input.value = 'painted'
    input.focus()
    input.setSelectionRange(0, 7)
    const { clone, nodeMap } = await prepareClone(input, createContext({ captureSelection: true }))
    applyTextFieldSelectionLayers(nodeMap)
    expect(clone.style.backgroundImage).toContain('rgb(0, 128, 0)')
  })

  it('survives the background-inline pass in a full capture', async () => {
    // Regression: the background pass rewrites a field's background longhands
    // from the source's computed style, which flattened the highlight into a
    // full-box fill (size/position/repeat reset to initials).
    const textarea = mount(document.createElement('textarea'))
    textarea.rows = 3
    textarea.style.cssText = 'width:200px;font:14px monospace;padding:8px;background:#fff'
    textarea.value = 'a longer value that wraps across a couple of lines in here'
    textarea.focus()
    textarea.setSelectionRange(9, 40)
    const result = await snapdom(textarea, { captureSelection: true })
    const svg = decodeURIComponent(result.url.split(',')[1])
    const styleAttr = svg.match(/<textarea[^>]*style="([^"]*)"/)?.[1] ?? ''
    expect(styleAttr).toContain('linear-gradient')
    // The highlight layers keep their measured px positions and sizes. Blink and WebKit
    // collapse the longhands into the background shorthand; Gecko keeps them apart, so the
    // measured pixels are asserted wherever the engine chose to put them.
    const collapsed =
      /linear-gradient\([^)]*\) [\d.]+px [\d.]+px \/ [\d.]+px [\d.]+px no-repeat/.test(styleAttr)
    const longhands =
      /background-position:[^;]*[\d.]+px [\d.]+px/.test(styleAttr) &&
      /background-size:[^;]*[\d.]+px [\d.]+px/.test(styleAttr) &&
      /background-repeat:[^;]*no-repeat/.test(styleAttr)
    expect(collapsed || longhands).toBe(true)
  })
})
