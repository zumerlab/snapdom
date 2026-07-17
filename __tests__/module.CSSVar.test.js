// __tests__/module.CSSVar.test.js – resolveCSSVars var() materialization
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveCSSVars, isInSvgTemplate } from '../src/modules/CSSVar.js'

let host
beforeEach(() => {
  host = document.createElement('div')
  host.style.setProperty('--x', 'rgb(255, 0, 0)')
  document.body.appendChild(host)
})
afterEach(() => {
  host.remove()
})

describe('isInSvgTemplate', () => {
  it('is true for descendants of svg template containers', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    defs.appendChild(rect)
    svg.appendChild(defs)
    host.appendChild(svg)
    expect(isInSvgTemplate(rect)).toBe(true)
    expect(isInSvgTemplate(svg)).toBe(false)
  })
})

describe('resolveCSSVars', () => {
  it('ignores non-element inputs', () => {
    expect(() => resolveCSSVars(null, null)).not.toThrow()
    expect(() => resolveCSSVars(host, null)).not.toThrow()
  })

  it('bails out for elements inside an svg template (does not materialize)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('style', 'fill: var(--x)')
    defs.appendChild(rect)
    svg.appendChild(defs)
    host.appendChild(svg)

    const clone = rect.cloneNode(true)
    resolveCSSVars(rect, clone)
    // still the raw var() — not frozen to the dead template context
    expect(clone.style.fill).toContain('var(')
  })

  it('resolves var() used in an inline style onto the clone', () => {
    const src = document.createElement('div')
    src.style.setProperty('color', 'var(--x)')
    host.appendChild(src)

    const clone = document.createElement('div')
    resolveCSSVars(src, clone)

    expect(clone.style.color).toBe('rgb(255, 0, 0)')
  })

  it('resolves var() used in a presentation attribute onto the clone', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('fill', 'var(--x)')
    svg.appendChild(rect)
    host.appendChild(svg)

    const clone = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    resolveCSSVars(rect, clone)

    expect(clone.style.fill).toBe('rgb(255, 0, 0)')
  })

  it('materializes a class-driven KEY_PROP that differs from the baseline', () => {
    const style = document.createElement('style')
    style.textContent = '.cssvar-fill { color: var(--x); }'
    document.head.appendChild(style)

    const src = document.createElement('div')
    src.className = 'cssvar-fill'
    host.appendChild(src)

    const clone = document.createElement('div')
    resolveCSSVars(src, clone)

    expect(clone.style.color).toBe('rgb(255, 0, 0)')
    style.remove()
  })
})
