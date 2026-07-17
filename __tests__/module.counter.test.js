// __tests__/module.counter.test.js – counter.js coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hasCounters,
  buildCounterContext,
  resolveCountersInContent
} from '../src/modules/counter.js'
import { cache } from '../src/core/cache.js'

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

  it('returns empty string for counters() when the stack is empty', () => {
    const node = document.createElement('span')
    document.body.appendChild(node)
    const ctx = buildCounterContext(node)
    // No counter named "missing" anywhere → empty stack → '' (no trailing separator)
    expect(resolveCountersInContent('counters(missing, ".")', node, ctx)).toBe('')
  })

  it('falls back to "- " when the counter context throws', () => {
    const node = document.createElement('span')
    document.body.appendChild(node)
    const throwingCtx = { get() { throw new Error('boom') }, getStack() { throw new Error('boom') } }
    expect(resolveCountersInContent('counter(x)', node, throwingCtx)).toBe('- ')
  })
})

describe('buildCounterContext – epoch invalidation', () => {
  it('rebuilds the map when the session counter epoch changes', () => {
    const root = document.createElement('div')
    const inner = document.createElement('span')
    inner.style.counterReset = 'x 5'
    root.appendChild(inner)
    document.body.appendChild(root)

    cache.session = cache.session || {}
    cache.session.__counterEpoch = 1
    const ctx = buildCounterContext(root)
    expect(ctx.get(inner, 'x')).toBe(5)

    // Mutate the DOM and bump the epoch: the next query must rebuild from the live tree.
    inner.style.counterReset = 'x 9'
    cache.session.__counterEpoch = 2
    expect(ctx.get(inner, 'x')).toBe(9)
    expect(ctx.getStack(inner, 'x')).toEqual([9])
  })
})

describe('formatCounter – negative values (NEW-6)', () => {
  it('resolves negative decimal counter as negative string', () => {
    // Manually craft a ctx that returns -3 for name 'x'
    const node = document.createElement('span')
    document.body.appendChild(node)
    const fakeCtx = {
      get: () => -3,
      getStack: () => [-3]
    }
    expect(resolveCountersInContent('counter(x)', node, fakeCtx)).toBe('-3')
  })

  it('resolves negative decimal-leading-zero counter correctly', () => {
    const node = document.createElement('span')
    document.body.appendChild(node)
    const fakeCtx = { get: () => -5, getStack: () => [-5] }
    expect(resolveCountersInContent('counter(x, decimal-leading-zero)', node, fakeCtx)).toBe('-05')
  })

  it('resolves zero decimal counter as "0" not "0" clamped', () => {
    const node = document.createElement('span')
    document.body.appendChild(node)
    const fakeCtx = { get: () => 0, getStack: () => [0] }
    expect(resolveCountersInContent('counter(x)', node, fakeCtx)).toBe('0')
  })
})
