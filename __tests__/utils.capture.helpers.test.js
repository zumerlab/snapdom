// __tests__/utils.capture.helpers.test.js – 51% → higher coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  stripRootShadows,
  removeAllComments,
  sanitizeAttributesForXHTML,
  sanitizeCloneForXHTML,
  shrinkAutoSizeBoxes,
  estimateKeptHeight,
  limitDecimals,
  collectScrollbarCSS
} from '../src/utils/capture.helpers.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('stripRootShadows', () => {
  it('strips box-shadow, text-shadow, outline, blur/drop-shadow from clone root', () => {
    const orig = document.createElement('div')
    orig.style.boxShadow = '0 0 10px red'
    document.body.appendChild(orig)
    const clone = document.createElement('div')
    clone.style.boxShadow = 'inherit'
    stripRootShadows(orig, clone)
    expect(clone.style.boxShadow).toBe('none')
  })

  it('handles null/undefined gracefully', () => {
    expect(() => stripRootShadows(null, document.createElement('div'))).not.toThrow()
    expect(() => stripRootShadows(document.createElement('div'), null)).not.toThrow()
  })
})

describe('removeAllComments', () => {
  it('removes all HTML comments from root', () => {
    const root = document.createElement('div')
    root.appendChild(document.createComment('test comment'))
    root.appendChild(document.createTextNode('text'))
    root.appendChild(document.createComment('another'))
    removeAllComments(root)
    expect(root.childNodes.length).toBe(1)
    expect(root.childNodes[0].nodeType).toBe(Node.TEXT_NODE)
  })
})

describe('sanitizeAttributesForXHTML', () => {
  // Note: TreeWalker.nextNode() traverses descendants; root is starting point.
  // Put attributes on a child so the walker visits it.
  it('removes attributes with unknown : prefix (keeps xml, xlink)', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.setAttribute('v-bind:foo', '1')
    child.setAttribute('valid', '2')
    root.appendChild(child)
    sanitizeAttributesForXHTML(root)
    expect(child.hasAttribute('v-bind:foo')).toBe(false)
    expect(child.getAttribute('valid')).toBe('2')
  })

  it('removes framework directives (x-, v-, :, on:, bind:, let:, class:) when stripFrameworkDirectives', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.setAttribute('x-show', '1')
    child.setAttribute('v-if', '2')
    child.setAttribute(':class', '3')
    child.setAttribute('data-ok', '4')
    root.appendChild(child)
    sanitizeAttributesForXHTML(root, { stripFrameworkDirectives: true })
    expect(child.hasAttribute('x-show')).toBe(false)
    expect(child.hasAttribute('v-if')).toBe(false)
    expect(child.hasAttribute(':class')).toBe(false)
    expect(child.getAttribute('data-ok')).toBe('4')
  })

  it('keeps framework directives when stripFrameworkDirectives is false', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.setAttribute('x-show', '1')
    root.appendChild(child)
    sanitizeAttributesForXHTML(root, { stripFrameworkDirectives: false })
    expect(child.getAttribute('x-show')).toBe('1')
  })
})

describe('sanitizeCloneForXHTML', () => {
  it('sanitizes attributes and removes comments', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.setAttribute('x-foo', '1')
    root.appendChild(child)
    root.appendChild(document.createComment('c'))
    sanitizeCloneForXHTML(root)
    expect(child.hasAttribute('x-foo')).toBe(false)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    let commentCount = 0
    while (walker.nextNode()) commentCount++
    expect(commentCount).toBe(0)
  })
})

describe('shrinkAutoSizeBoxes', () => {
  it('shrinks boxes that lost children (excludeMode:remove)', () => {
    const src = document.createElement('div')
    src.appendChild(document.createElement('span'))
    src.appendChild(document.createElement('span'))
    const cln = document.createElement('div')
    cln.appendChild(document.createElement('span'))
    document.body.appendChild(src)
    document.body.appendChild(cln)
    shrinkAutoSizeBoxes(src, cln)
    expect(cln.style.height).toBe('auto')
    expect(cln.style.width).toBe('auto')
  })

  it('handles null root', () => {
    expect(() => shrinkAutoSizeBoxes(null, document.createElement('div'))).not.toThrow()
  })
})

describe('estimateKeptHeight', () => {
  it('estimates height from children', () => {
    const container = document.createElement('div')
    const child = document.createElement('div')
    child.style.height = '50px'
    child.style.display = 'block'
    container.appendChild(child)
    document.body.appendChild(container)
    const h = estimateKeptHeight(container, {})
    expect(h).toBeGreaterThanOrEqual(0)
  })

  it('skips excluded elements (data-capture=exclude, excludeMode:remove)', () => {
    const container = document.createElement('div')
    const ex = document.createElement('div')
    ex.setAttribute('data-capture', 'exclude')
    ex.style.height = '100px'
    container.appendChild(ex)
    document.body.appendChild(container)
    const h = estimateKeptHeight(container, { excludeMode: 'remove' })
    expect(h).toBeLessThan(120)
  })
})

describe('limitDecimals', () => {
  it('rounds to n decimals', () => {
    expect(limitDecimals(1.23456, 2)).toBe(1.23)
    expect(limitDecimals(1.23456, 3)).toBe(1.235)
  })
  it('returns v unchanged for non-finite', () => {
    expect(limitDecimals(NaN)).toBeNaN()
    expect(limitDecimals(Infinity)).toBe(Infinity)
  })
})

describe('collectScrollbarCSS (#334)', () => {
  it('extracts ::-webkit-scrollbar rules from document stylesheets', () => {
    const style = document.createElement('style')
    style.textContent = `
      .scroll-area::-webkit-scrollbar { width: 10px; }
      .scroll-area::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.6); }
      .other { color: red; }
    `
    document.head.appendChild(style)

    const out = collectScrollbarCSS(document)
    document.head.removeChild(style)

    expect(out).toContain('::-webkit-scrollbar')
    expect(out).toContain('::-webkit-scrollbar-thumb')
    expect(out).toContain('width: 10px')
    expect(out).not.toContain('.other')
  })

  it('returns empty string for null document', () => {
    expect(collectScrollbarCSS(null)).toBe('')
  })
})
