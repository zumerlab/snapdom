// __tests__/module.counter.test.js – counter.js coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hasCounters,
  unquoteDoubleStrings,
  buildCounterContext,
  resolveCountersInContent,
  deriveCounterCtxForPseudo,
  resolvePseudoContent
} from '../src/modules/counter.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('hasCounters', () => {
  it('detects counter()', () => {
    expect(hasCounters('content: counter(x)')).toBe(true)
    expect(hasCounters('counter(x)')).toBe(true)
  })
  it('detects counters()', () => {
    expect(hasCounters('content: counters(x, ".")')).toBe(true)
    expect(hasCounters('counters(name, sep)')).toBe(true)
  })
  it('returns false for non-counter content', () => {
    expect(hasCounters('content: "foo"')).toBe(false)
    expect(hasCounters('')).toBe(false)
    expect(hasCounters(null)).toBe(false)
  })
})

describe('unquoteDoubleStrings', () => {
  it('removes double quotes from strings', () => {
    expect(unquoteDoubleStrings('"hello"')).toBe('hello')
    expect(unquoteDoubleStrings('before "mid" after')).toBe('before mid after')
  })
  it('handles null/empty', () => {
    expect(unquoteDoubleStrings(null)).toBe('')
    expect(unquoteDoubleStrings('')).toBe('')
  })
})

describe('buildCounterContext', () => {
  it('returns get and getStack for a node', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span></span>'
    document.body.appendChild(root)
    const ctx = buildCounterContext(root)
    expect(typeof ctx.get).toBe('function')
    expect(typeof ctx.getStack).toBe('function')
    expect(ctx.get(root.querySelector('span'), 'x')).toBe(0)
    expect(ctx.getStack(root.querySelector('span'), 'x')).toEqual([])
  })

  it('applies counter-reset and counter-increment', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.style.counterReset = 'section 1'
    child.style.counterIncrement = 'section'
    root.appendChild(child)
    document.body.appendChild(root)
    const ctx = buildCounterContext(root)
    expect(ctx.get(child, 'section')).toBe(2)
  })

  it('handles LI with value attribute via counter-reset', () => {
    const ol = document.createElement('ol')
    const li = document.createElement('li')
    li.setAttribute('value', '10')
    li.style.counterReset = 'list-item 9'
    li.style.counterIncrement = 'list-item'
    li.textContent = 'x'
    ol.appendChild(li)
    document.body.appendChild(ol)
    const ctx = buildCounterContext(ol)
    expect(ctx.get(li, 'list-item')).toBe(10)
  })

  it('accepts Document as root', () => {
    const ctx = buildCounterContext(document)
    expect(ctx.get(document.documentElement, 'x')).toBe(0)
  })
})

describe('resolveCountersInContent', () => {
  it('resolves counter(name) with decimal style', () => {
    const root = document.createElement('div')
    const span = document.createElement('span')
    span.style.counterIncrement = 'step'
    root.appendChild(span)
    document.body.appendChild(root)
    const ctx = buildCounterContext(root)
    expect(resolveCountersInContent('counter(step)', span, ctx)).toBe('1')
  })
  it('resolves counter with upper-alpha', () => {
    const root = document.createElement('div')
    const span = document.createElement('span')
    span.style.counterReset = 'a 3'
    span.style.counterIncrement = 'a'
    root.appendChild(span)
    document.body.appendChild(root)
    const ctx = buildCounterContext(root)
    expect(resolveCountersInContent('counter(a, upper-alpha)', span, ctx)).toBe('D')
  })
  it('returns raw for none', () => {
    expect(resolveCountersInContent('none', null, null)).toBe('none')
  })
  it('returns empty for empty', () => {
    expect(resolveCountersInContent('', null, null)).toBe('')
  })
  it('resolves counters(name, sep)', () => {
    const root = document.createElement('div')
    const inner = document.createElement('span')
    inner.style.counterReset = 'x 1'
    inner.style.counterIncrement = 'x'
    root.appendChild(inner)
    document.body.appendChild(root)
    const ctx = buildCounterContext(root)
    expect(resolveCountersInContent('counters(x, ". ")', inner, ctx)).toBe('2')
  })
})

describe('deriveCounterCtxForPseudo', () => {
  it('applies pseudo counter-reset/increment', () => {
    const span = document.createElement('span')
    span.style.counterReset = 'item 0'
    document.body.appendChild(span)
    const baseCtx = buildCounterContext(span)
    const pseudoStyle = {
      counterReset: 'item 5',
      counterIncrement: 'item'
    }
    const derived = deriveCounterCtxForPseudo(span, pseudoStyle, baseCtx)
    expect(derived.get(span, 'item')).toBe(6)
  })
})

describe('resolvePseudoContent', () => {
  it('returns empty for none/normal', () => {
    const span = document.createElement('span')
    document.body.appendChild(span)
    const ctx = buildCounterContext(span)
    expect(resolvePseudoContent(span, '::before', ctx)).toBe('')
  })
})
