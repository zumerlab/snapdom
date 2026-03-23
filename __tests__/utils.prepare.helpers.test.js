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

  it('forces content-visibility:hidden to visible on descendants', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    child.style.contentVisibility = 'hidden'
    parent.appendChild(child)
    document.body.appendChild(parent)

    const undo = forceContentVisibility(parent)
    expect(child.style.contentVisibility).toBe('visible')

    undo()
    expect(child.style.contentVisibility).toBe('hidden')
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
})
