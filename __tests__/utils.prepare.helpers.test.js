// __tests__/utils.prepare.helpers.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { forceContentVisibility } from '../src/utils/prepare.helpers.js'

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
