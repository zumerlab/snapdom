// __tests__/utils.prepare.helpers.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { forceContentVisibility, stabilizeLayout } from '../src/utils/prepare.helpers.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('forceContentVisibility (#281)', () => {
  it('forces content-visibility:auto to visible and restores on undo', () => {
    const el = document.createElement('div')
    el.style.contentVisibility = 'auto'
    document.body.appendChild(el)

    const undo = forceContentVisibility(el)
    expect(el.style.contentVisibility).toBe('visible')

    undo()
    expect(el.style.contentVisibility).toBe('auto')
  })

  it('leaves content-visibility:hidden alone on descendants', () => {
    // This pass exists for `auto`, whose contents the browser skips only as an offscreen
    // optimization. `hidden` is an authoring decision: the browser paints the element's
    // own box and skips its contents outright. Forcing it to visible un-hid the whole
    // subtree into the capture, and also erased the value modules/styles.js reads to carry
    // the declaration into the snapshot - see core.contentVisibility.test.js.
    const parent = document.createElement('div')
    const child = document.createElement('div')
    child.style.contentVisibility = 'hidden'
    parent.appendChild(child)
    document.body.appendChild(parent)

    const undo = forceContentVisibility(parent)
    expect(child.style.contentVisibility).toBe('hidden')

    undo()
    expect(child.style.contentVisibility).toBe('hidden')
  })

  it('forces content-visibility:auto on descendants, not just on the root', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    child.style.contentVisibility = 'auto'
    parent.appendChild(child)
    document.body.appendChild(parent)

    const undo = forceContentVisibility(parent)
    expect(child.style.contentVisibility).toBe('visible')

    undo()
    expect(child.style.contentVisibility).toBe('auto')
  })

  it('leaves elements without content-visibility unchanged', () => {
    const el = document.createElement('div')
    el.style.color = 'red'
    document.body.appendChild(el)

    forceContentVisibility(el)
    expect(el.style.contentVisibility).toBe('')
  })

  it('returns a no-op undo function when nothing was changed', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const undo = forceContentVisibility(el)
    expect(() => undo()).not.toThrow()
  })

  it('handles null/empty root gracefully', () => {
    expect(() => forceContentVisibility(null)).not.toThrow()
    expect(() => forceContentVisibility(document.createElement('div'))).not.toThrow()
  })

  it('overrides an important author rule and restores the inline priority', () => {
    const el = document.createElement('div')
    el.style.setProperty('content-visibility', 'auto', 'important')
    document.body.appendChild(el)
    const undo = forceContentVisibility(el)
    expect(getComputedStyle(el).contentVisibility).toBe('visible')
    undo()
    expect(el.style.getPropertyValue('content-visibility')).toBe('auto')
    expect(el.style.getPropertyPriority('content-visibility')).toBe('important')
  })

  it('does not overwrite an application update made during capture', () => {
    const el = document.createElement('div')
    el.style.contentVisibility = 'auto'
    document.body.appendChild(el)
    const undo = forceContentVisibility(el)
    el.style.contentVisibility = 'hidden'
    undo()
    expect(el.style.contentVisibility).toBe('hidden')
  })

  it('keeps the override until both concurrent captures finish', () => {
    const el = document.createElement('div')
    el.style.contentVisibility = 'auto'
    document.body.appendChild(el)
    const first = forceContentVisibility(el)
    const second = forceContentVisibility(el)
    first()
    expect(el.style.contentVisibility).toBe('visible')
    first() // A cleanup may be called twice; it must release only its own claim.
    expect(el.style.contentVisibility).toBe('visible')
    second()
    expect(el.style.contentVisibility).toBe('auto')
  })

  it('forces an important stylesheet rule without leaving an empty style attribute', () => {
    const css = document.createElement('style')
    css.textContent = '.auto-content {content-visibility:auto!important}'
    const el = document.createElement('div')
    el.className = 'auto-content'
    document.body.append(css, el)
    const undo = forceContentVisibility(el)
    expect(getComputedStyle(el).contentVisibility).toBe('visible')
    undo()
    expect(el.getAttribute('style')).toBeNull()
    expect(getComputedStyle(el).contentVisibility).toBe('auto')
  })
})

describe('stabilizeLayout - one-sided borders', () => {
  // The transparent-border shim exists for roots that have an outline but NO border. The
  // gate read the `border-width` SHORTHAND through parseFloat, which sees only the first of
  // the four serialized widths, so a bottom-only border tested as "no border". Two things
  // then went wrong: the capture got a transparent border on all four sides instead of the
  // real one, and the undo assigned `element.style.border = ''`, which per CSSOM is
  // removeProperty('border') - deleting the author's inline border from the LIVE page.
  it('does not shim an element whose border is only on one side', () => {
    const el = document.createElement('div')
    el.style.outline = '2px solid red'
    el.style.borderBottom = '1px solid black'
    document.body.appendChild(el)

    const undo = stabilizeLayout(el)
    expect(el.style.borderTopWidth).toBe('')
    expect(getComputedStyle(el).borderBottomWidth).toBe('1px')
    undo()
    expect(el.style.borderBottom).toBe('1px solid black')
  })

  it('leaves the live inline border intact after undo', () => {
    const el = document.createElement('div')
    el.style.outline = '2px solid red'
    el.style.borderLeft = '3px solid blue'
    document.body.appendChild(el)

    stabilizeLayout(el)()
    expect(getComputedStyle(el).borderLeftWidth).toBe('3px')
    expect(getComputedStyle(el).borderLeftColor).toBe('rgb(0, 0, 255)')
  })

  it('still shims a genuinely border-less element with an outline', () => {
    const el = document.createElement('div')
    el.style.outline = '2px solid red'
    document.body.appendChild(el)

    const undo = stabilizeLayout(el)
    expect(getComputedStyle(el).borderTopWidth).toBe('2px')
    expect(getComputedStyle(el).borderTopColor).toBe('rgba(0, 0, 0, 0)')
    undo()
    expect(el.style.border).toBe('')
  })

  it('restores border longhands and priorities when border-style was none', () => {
    const el = document.createElement('div')
    el.style.cssText = 'outline:2px solid red;border-left-color:blue!important;border-top-width:7px'
    document.body.appendChild(el)
    const before = el.style.cssText
    const undo = stabilizeLayout(el)
    undo()
    expect(el.style.cssText).toBe(before)
  })

  it('keeps border-image declarations intact while applying the shim', () => {
    const el = document.createElement('div')
    el.style.cssText = 'outline:2px solid red;border-image-source:linear-gradient(red,blue)'
    document.body.appendChild(el)
    const source = el.style.borderImageSource
    const undo = stabilizeLayout(el)
    expect(el.style.borderImageSource).toBe(source)
    undo()
    expect(el.style.borderImageSource).toBe(source)
  })

  it('preserves application changes made while the border shim is active', () => {
    const el = document.createElement('div')
    el.style.cssText = 'outline:2px solid red;border-left-color:blue!important'
    document.body.appendChild(el)
    const undo = stabilizeLayout(el)
    el.style.borderTop = '3px dashed green'
    el.style.color = 'purple'
    undo()
    expect(el.style.borderTop).toBe('3px dashed green')
    expect(el.style.borderLeftColor).toBe('blue')
    expect(el.style.getPropertyPriority('border-left-color')).toBe('important')
    expect(el.style.color).toBe('purple')
  })

  it('restores the original border after the last concurrent capture', () => {
    const el = document.createElement('div')
    el.style.outline = '2px solid red'
    document.body.appendChild(el)
    const first = stabilizeLayout(el)
    const second = stabilizeLayout(el)
    first()
    expect(getComputedStyle(el).borderTopWidth).toBe('2px')
    second()
    expect(el.style.border).toBe('')
  })
})
