// __tests__/module.lineClamp.test.js – lineClamp coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { lineClamp, lineClampTree } from '../src/modules/lineClamp.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('lineClamp', () => {
  it('returns no-op for null element', () => {
    const undo = lineClamp(null)
    expect(typeof undo).toBe('function')
    undo()
  })

  it('returns no-op when no -webkit-line-clamp', () => {
    const div = document.createElement('div')
    div.textContent = 'Hello world'
    document.body.appendChild(div)
    lineClamp(div)
    expect(div.textContent).toBe('Hello world')
  })

  it('returns no-op when not plain text container (has child elements)', () => {
    const div = document.createElement('div')
    div.style.webkitLineClamp = '2'
    div.appendChild(document.createElement('span'))
    div.appendChild(document.createTextNode('text'))
    document.body.appendChild(div)
    lineClamp(div)
    expect(div.childNodes.length).toBe(2)
  })

  it('clamps text and returns undo when content overflows', () => {
    const div = document.createElement('div')
    div.style.webkitLineClamp = '2'
    div.style.lineHeight = '20px'
    div.style.fontSize = '16px'
    div.style.padding = '0'
    div.style.width = '200px'
    div.style.overflow = 'hidden'
    const longText = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
    div.textContent = longText
    document.body.appendChild(div)
    const undo = lineClamp(div)
    expect(div.textContent).toContain('…')
    undo()
    expect(div.textContent).toBe(longText)
  })

  it('returns no-op when content fits in N lines', () => {
    const div = document.createElement('div')
    div.style.webkitLineClamp = '5'
    div.style.lineHeight = '20px'
    div.style.fontSize = '16px'
    div.textContent = 'Short'
    document.body.appendChild(div)
    lineClamp(div)
    expect(div.textContent).toBe('Short')
  })
})

describe('lineClampTree (#386)', () => {
  it('clamps nested element with -webkit-line-clamp', () => {
    const outer = document.createElement('div')
    outer.style.width = '200px'
    const inner = document.createElement('div')
    inner.style.webkitLineClamp = '2'
    inner.style.lineHeight = '20px'
    inner.style.fontSize = '16px'
    inner.style.padding = '0'
    inner.style.overflow = 'hidden'
    const longText = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore.'
    inner.textContent = longText
    outer.appendChild(inner)
    document.body.appendChild(outer)

    const undo = lineClampTree(outer)
    expect(inner.textContent).toContain('…')
    undo()
    expect(inner.textContent).toBe(longText)
  })

  it('returns no-op for null', () => {
    const undo = lineClampTree(null)
    expect(typeof undo).toBe('function')
    undo()
  })
})
