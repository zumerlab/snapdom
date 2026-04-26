import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { agentMap } from '../packages/plugins/agent-map.js'

describe('agentMap plugin', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.style.cssText = 'position:relative; width:400px; height:300px;'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  /* ── Plugin shape ───────────────────────────── */

  it('returns a valid plugin with required hooks', () => {
    const p = agentMap()
    expect(p.name).toBe('agent-map')
    expect(typeof p.afterClone).toBe('function')
    expect(typeof p.defineExports).toBe('function')
  })

  it('defineExports returns an agentMap key', () => {
    const p = agentMap()
    const ex = p.defineExports()
    expect(typeof ex.agentMap).toBe('function')
  })

  /* ── Map extraction ─────────────────────────── */

  it('extracts buttons and links as interactive', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click me'
    container.appendChild(btn)

    const link = document.createElement('a')
    link.href = 'https://example.com'
    link.textContent = 'Link'
    container.appendChild(link)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    agentMap().afterClone(ctx)

    expect(ctx.__agentMapMeta.map.length).toBe(2)
    expect(ctx.__agentMapMeta.map[0].r).toBe('button')
    expect(ctx.__agentMapMeta.map[0].n).toBe('Click me')
    expect(ctx.__agentMapMeta.map[1].r).toBe('link')
    expect(ctx.__agentMapMeta.map[1].n).toBe('Link')
  })

  it('derives checkbox role and checked state', () => {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = true
    cb.setAttribute('aria-label', 'Accept terms')
    container.appendChild(cb)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.r).toBe('checkbox')
    expect(entry.n).toBe('Accept terms')
    expect(entry.s).toBeDefined()
    expect(entry.s.checked).toBe(true)
  })

  it('captures aria-expanded=false as meaningful state', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Menu'
    btn.setAttribute('aria-expanded', 'false')
    container.appendChild(btn)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.s).toBeDefined()
    expect(entry.s.expanded).toBe(false)
  })

  it('captures aria-pressed=false on toggle buttons', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Annual'
    btn.setAttribute('aria-pressed', 'false')
    container.appendChild(btn)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.s.pressed).toBe(false)
  })

  it('captures disabled state', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Delete'
    btn.disabled = true
    container.appendChild(btn)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.s.disabled).toBe(true)
  })

  it('bbox is a 4-tuple [x, y, w, h]', () => {
    const btn = document.createElement('button')
    btn.textContent = 'hi'
    container.appendChild(btn)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(Array.isArray(entry.b)).toBe(true)
    expect(entry.b.length).toBe(4)
    expect(entry.b.every(n => typeof n === 'number')).toBe(true)
  })

  it('skips semantic elements by default', () => {
    container.innerHTML = '<h1>Title</h1><p>Paragraph</p><button>Go</button>'
    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap().afterClone(ctx)

    expect(ctx.__agentMapMeta.map.length).toBe(1)
    expect(ctx.__agentMapMeta.map[0].r).toBe('button')
  })

  it('includes semantic when opt-in', () => {
    container.innerHTML = '<h1>Title</h1><p>Paragraph</p><button>Go</button>'
    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap({ semantic: true }).afterClone(ctx)

    const roles = ctx.__agentMapMeta.map.map(e => e.r).sort()
    expect(roles).toContain('heading')
    expect(roles).toContain('paragraph')
    expect(roles).toContain('button')
  })

  /* ── Fields mode ────────────────────────────── */

  it('minimal fields omits t and a', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click me'
    btn.setAttribute('aria-label', 'Accept')
    container.appendChild(btn)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap({ fields: 'minimal' }).afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.t).toBeUndefined()
    expect(entry.a).toBeUndefined()
  })

  it('full fields adds t and a when meaningful', () => {
    const link = document.createElement('a')
    link.href = 'https://example.com'
    link.textContent = 'Learn more'
    link.setAttribute('aria-label', 'Learn more about us')
    container.appendChild(link)

    const ctx = { element: container, clone: container.cloneNode(true) }
    agentMap({ fields: 'full' }).afterClone(ctx)

    const entry = ctx.__agentMapMeta.map[0]
    expect(entry.t).toBe('Learn more')
    expect(entry.a).toBeDefined()
    expect(entry.a.href).toBe('https://example.com')
  })
})
