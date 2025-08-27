// __tests__/core.clone.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { cache } from '../src/core/cache.js'

// fresh session cache each test
const makeSession = () => ({
  styleMap: cache.session.styleMap,
  styleCache: cache.session.styleCache,
  nodeMap: cache.session.nodeMap,
})

describe('deepClone – extra coverage', () => {
  let session

  beforeEach(() => {
    // reset-ish session structures if available
    if (cache.session?.styleMap?.clear) cache.session.styleMap.clear()
    if (cache.session?.styleCache?.clear) cache.session.styleCache = new WeakMap()
    if (cache.session?.nodeMap?.clear) cache.session.nodeMap = new Map()
    session = makeSession()
  })

  it('clones a Text node (TEXT_NODE path)', () => {
    const t = document.createTextNode('hello')
    const c = deepClone(t, session, {})
    expect(c.nodeType).toBe(Node.TEXT_NODE)
    expect(c.nodeValue).toBe('hello')
    expect(c).not.toBe(t)
  })

  it('freezes <img> srcset using src (no currentSrc) and strips srcset/sizes', () => {
    const img = document.createElement('img')
    // supply a concrete src so freeze picks it
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    img.setAttribute('srcset', 'a.png 1x, b.png 2x')
    img.setAttribute('sizes', '(max-width: 600px) 100vw, 600px')

    const clone = deepClone(img, session, {})
    expect(clone.tagName).toBe('IMG')
    // chosen copied to src
    expect(clone.getAttribute('src')).toContain('data:image/')
    // stripped by freezeImgSrcset
    expect(clone.hasAttribute('srcset')).toBe(false)
    expect(clone.hasAttribute('sizes')).toBe(false)
    // eager/sync hints applied
    expect(clone.loading).toBe('eager')
    expect(clone.decoding).toBe('sync')
  })

  it('does not freeze when no chosen URL (keeps srcset/sizes)', () => {
    const img = document.createElement('img')
    img.setAttribute('srcset', 'a.png 1x')
    img.setAttribute('sizes', '100vw')
    // leave src and currentSrc empty

    const clone = deepClone(img, session, {})
    // no src chosen => still has original responsive attributes
    expect(clone.hasAttribute('src')).toBe(false)
    expect(clone.getAttribute('srcset')).toBe('a.png 1x')
    expect(clone.getAttribute('sizes')).toBe('100vw')
  })

  it('does not exclude when selector is invalid; only warns', () => {
  const el = document.createElement('div')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const out = deepClone(el, session, { exclude: ['::bad('] })

  expect(out).toBeInstanceOf(HTMLElement)
  expect(out.tagName).toBe('DIV')
  // It should not return the hidden spacer for invalid selector
  expect(out.style.visibility).not.toBe('hidden')
  expect(warn).toHaveBeenCalled()

  warn.mockRestore()
})


  it('excludes by custom filter returning false; and handles filter error', () => {
    // filter false -> spacer
    const a = document.createElement('p')
    const out1 = deepClone(a, session, { filter: () => false })
    expect(out1).toBeInstanceOf(HTMLElement)
    expect(out1.style.visibility).toBe('hidden')

    // filter throws -> warn + spacer
    const b = document.createElement('p')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out2 = deepClone(b, session, { filter: () => { throw new Error('boom') } })
    expect(out2).toBeInstanceOf(HTMLElement)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('IFRAME fallback uses gradient style and element size', () => {
    const frame = document.createElement('iframe')
    // JSDOM offset* are not layouted; provide getters
    Object.defineProperty(frame, 'offsetWidth', { configurable: true, get: () => 123 })
    Object.defineProperty(frame, 'offsetHeight', { configurable: true, get: () => 45 })

    const fallback = deepClone(frame, session, {})
    expect(fallback.tagName).toBe('DIV')
    expect(fallback.style.width).toBe('123px')
    expect(fallback.style.height).toBe('45px')
    expect(fallback.style.backgroundImage).toContain('repeating-linear-gradient')
  })

  it('throws and logs when base clone (node.cloneNode) fails', () => {
    const el = document.createElement('div')
    const err = new Error('fail')
    const spy = vi.spyOn(el, 'cloneNode').mockImplementation(() => { throw err })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => deepClone(el, session, {})).toThrow('fail')
    expect(log).toHaveBeenCalled()
    spy.mockRestore()
    log.mockRestore()
  })

  it('textarea keeps value and explicit size via getBoundingClientRect', () => {
    const ta = document.createElement('textarea')
    ta.value = 'hello'
    vi.spyOn(ta, 'getBoundingClientRect').mockReturnValue({ width: 80, height: 30 })
    const clone = deepClone(ta, session, {})
    expect(clone.value).toBe('hello')
    expect(clone.style.width).toBe('80px')
    expect(clone.style.height).toBe('30px')
  })

  it('input copies value/checked/attributes and select applies selected on options', () => {
    // input
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    input.value = 'abc'
    const c1 = deepClone(input, session, {})
    expect(c1.value).toBe('abc')
    expect(c1.checked).toBe(true)
    expect(c1.getAttribute('value')).toBe('abc')
    expect(c1.hasAttribute('checked')).toBe(true)

    // select
    const sel = document.createElement('select')
    const o1 = document.createElement('option'); o1.value = 'a'; sel.appendChild(o1)
    const o2 = document.createElement('option'); o2.value = 'b'; sel.appendChild(o2)
    sel.value = 'b'
    const c2 = deepClone(sel, session, {})
    expect(c2.value).toBe('b')
    expect([...c2.options].find(o => o.value === 'b')?.hasAttribute('selected')).toBe(true)
    expect([...c2.options].find(o => o.value === 'a')?.hasAttribute('selected')).toBe(false)
  })

   it('ShadowRoot with <slot> only stores STYLE css into styleCache (no content clone)', () => {
     const host = document.createElement('div')
     const sr = host.attachShadow({ mode: 'open' })
     const style = document.createElement('style')
     style.textContent = '.x{color:red}'
     const slot = document.createElement('slot')
     sr.appendChild(style)
     sr.appendChild(slot)

     const clone = deepClone(host, session, {})
    // nuevo comportamiento: se inyecta un <style data-sd="sN"> en el host clone
    const injected = clone.querySelector && clone.querySelector('style[data-sd]')
    expect(!!injected).toBe(true)
    // y no hay otro contenido aparte del style inyectado
    const nonStyleChildren = Array.from(clone.childNodes || [])
      .filter(n => !(n.nodeType === 1 && n.tagName === 'STYLE'))
    expect(nonStyleChildren.length).toBe(0)
   })


  it('<slot> outside ShadowRoot clones assignedNodes and returns DocumentFragment', () => {
    const s = document.createElement('slot')
    // emulate assignedNodes() API
    Object.defineProperty(s, 'assignedNodes', {
      configurable: true,
      value: () => [document.createTextNode('slotted!')],
    })

    const frag = deepClone(s, session, {})
    expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE)
    // fragment should contain a text node "slotted!"
    const txt = frag.firstChild
    expect(txt.nodeType).toBe(Node.TEXT_NODE)
    expect(txt.nodeValue).toBe('slotted!')
  })
})
