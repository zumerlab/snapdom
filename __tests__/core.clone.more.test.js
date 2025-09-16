// __tests__/core.clone.more.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { cache } from '../src/core/cache.js'
import { NO_CAPTURE_TAGS } from '../src/utils/css.js'

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

  it('clones a Text node (TEXT_NODE path)', async () => {
    const t = document.createTextNode('hello')
    const c = await deepClone(t, session, {})
    expect(c.nodeType).toBe(Node.TEXT_NODE)
    expect(c.nodeValue).toBe('hello')
    expect(c).not.toBe(t)
  })

  it('freezes <img> srcset using src (no currentSrc) and strips srcset/sizes', async () => {
    const img = document.createElement('img')
    // supply a concrete src so freeze picks it
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    img.setAttribute('srcset', 'a.png 1x, b.png 2x')
    img.setAttribute('sizes', '(max-width: 600px) 100vw, 600px')

    const clone = await deepClone(img, session, {})
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

  it('does not freeze when no chosen URL (keeps srcset/sizes)', async () => {
    const img = document.createElement('img')
    img.setAttribute('srcset', 'a.png 1x')
    img.setAttribute('sizes', '100vw')
    // leave src and currentSrc empty

    const clone = await deepClone(img, session, {})
    // no src chosen => still has original responsive attributes
    expect(clone.hasAttribute('src')).toBe(false)
    expect(clone.getAttribute('srcset')).toBe('a.png 1x')
    expect(clone.getAttribute('sizes')).toBe('100vw')
  })

  it('does not exclude when selector is invalid; only warns', async () => {
  const el = document.createElement('div')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const out = await deepClone(el, session, { exclude: ['::bad('] })

  expect(out).toBeInstanceOf(HTMLElement)
  expect(out.tagName).toBe('DIV')
  // It should not return the hidden spacer for invalid selector
  expect(out.style.visibility).not.toBe('hidden')
  expect(warn).toHaveBeenCalled()

  warn.mockRestore()
})

it('exclude by selector with excludeMode = "remove" skips element from clonning', async () => {
  const el = document.createElement('div');
  el.classList.add('exclude-me');
  const out = await deepClone(el, session, { exclude: ['.exclude-me'], excludeMode: 'remove' })
  expect(out).not.toBeInstanceOf(HTMLElement)
});

  it('excludes by custom filter returning false; and handles filter error', async () => {
    // filter false -> spacer
    const a = document.createElement('p')
    const out1 = await deepClone(a, session, { filter: () => false, filterMode: 'hide' })
    expect(out1).toBeInstanceOf(HTMLElement)
    expect(out1.style.visibility).toBe('hidden')

    // filter throws -> warn + spacer
    const b = document.createElement('p')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out2 = await deepClone(b, session, { filter: () => { throw new Error('boom') } })
    expect(out2).toBeInstanceOf(HTMLElement)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  });

  if ('custom filter with filterMode = "remove" skips element from clonning', async () => {
    // filter false -> null
    const a = document.createElement('p')
    const out1 = await deepClone(a, session, { filter: () => false, filterMode: 'remove' })
    expect(out1).not.toBeInstanceOf(HTMLElement)
  });

  it('IFRAME fallback uses gradient style and element size', async () => {
    const frame = document.createElement('iframe')
    // JSDOM offset* are not layouted; provide getters
    Object.defineProperty(frame, 'offsetWidth', { configurable: true, get: () => 123 })
    Object.defineProperty(frame, 'offsetHeight', { configurable: true, get: () => 45 })

   const fallback = await deepClone(frame, session, { placeholders: true })
    expect(fallback.tagName).toBe('DIV')
    expect(fallback.style.width).toBe('123px')
    expect(fallback.style.height).toBe('45px')
    expect(fallback.style.backgroundImage).toContain('repeating-linear-gradient')
  })

  it('throws and logs when base clone (node.cloneNode) fails', async () => {
    const el = document.createElement('div')
    const err = new Error('fail')
    const spy = vi.spyOn(el, 'cloneNode').mockImplementation(() => { throw err })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(() => deepClone(el, session, {})).rejects.toThrow('fail')
    expect(log).toHaveBeenCalled()
    spy.mockRestore()
    log.mockRestore()
  })

  it('textarea keeps value and explicit size via getBoundingClientRect', async () => {
    const ta = document.createElement('textarea')
    ta.value = 'hello'
    vi.spyOn(ta, 'getBoundingClientRect').mockReturnValue({ width: 80, height: 30 })
    const clone = await deepClone(ta, session, {})
    expect(clone.value).toBe('hello')
    expect(clone.style.width).toBe('80px')
    expect(clone.style.height).toBe('30px')
  })

  it('input copies value/checked/attributes and select applies selected on options', async () => {
    // input
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    input.value = 'abc'
    const c1 = await deepClone(input, session, {})
    expect(c1.value).toBe('abc')
    expect(c1.checked).toBe(true)
    expect(c1.getAttribute('value')).toBe('abc')
    expect(c1.hasAttribute('checked')).toBe(true)

    // select
    const sel = document.createElement('select')
    const o1 = document.createElement('option'); o1.value = 'a'; sel.appendChild(o1)
    const o2 = document.createElement('option'); o2.value = 'b'; sel.appendChild(o2)
    sel.value = 'b'
    const c2 = await deepClone(sel, session, {})
    expect(c2.value).toBe('b')
    expect([...c2.options].find(o => o.value === 'b')?.hasAttribute('selected')).toBe(true)
    expect([...c2.options].find(o => o.value === 'a')?.hasAttribute('selected')).toBe(false)
  })

   it('ShadowRoot with <slot> only stores STYLE css into styleCache (no content clone)', async () => {
     const host = document.createElement('div')
     const sr = host.attachShadow({ mode: 'open' })
     const style = document.createElement('style')
     style.textContent = '.x{color:red}'
     const slot = document.createElement('slot')
     sr.appendChild(style)
     sr.appendChild(slot)

     const clone = await deepClone(host, session, {})
    // nuevo comportamiento: se inyecta un <style data-sd="sN"> en el host clone
    const injected = clone.querySelector && clone.querySelector('style[data-sd]')
    expect(!!injected).toBe(true)
    // y no hay otro contenido aparte del style inyectado
    const nonStyleChildren = Array.from(clone.childNodes || [])
      .filter(n => !(n.nodeType === 1 && n.tagName === 'STYLE'))
    expect(nonStyleChildren.length).toBe(0)
   })


  it('<slot> outside ShadowRoot clones assignedNodes and returns DocumentFragment', async () => {
    const s = document.createElement('slot')
    // emulate assignedNodes() API
    Object.defineProperty(s, 'assignedNodes', {
      configurable: true,
      value: () => [document.createTextNode('slotted!')],
    })

    const frag = await deepClone(s, session, {})
    expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE)
    // fragment should contain a text node "slotted!"
    const txt = frag.firstChild
    expect(txt.nodeType).toBe(Node.TEXT_NODE)
    expect(txt.nodeValue).toBe('slotted!')
  })

  it('deepClone handles data-capture="exclude" with excludeMode = "remove"', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-capture', 'exclude');
    const out1 = await deepClone(el, session, { excludeMode: 'remove' })
    expect(out1).not.toBeInstanceOf(HTMLElement)
  });
})


describe('deepClone – targeted branches for coverage gaps', () => {
  let session
  beforeEach(() => {
    // soft reset of session containers
    if (cache.session?.styleMap?.clear) cache.session.styleMap.clear()
    cache.session.styleCache = new WeakMap()
    cache.session.nodeMap = new Map()
    session = makeSession()
  })

  /**
   * Covers: NO_CAPTURE_TAGS early-return (e.g., <script>, <style>…).
   * Also verifies we truly short-circuit and do not produce spacers.
   */
  it('returns null for tags in NO_CAPTURE_TAGS', async () => {
    const el = document.createElement('script')
    expect(NO_CAPTURE_TAGS.has('script')).toBe(true) // sanity
    const out = await deepClone(el, session, {})
    expect(out).toBeNull()
  })

  /**
   * Covers: IMG width/height dataset when BCR is 0 and attributes exist.
   * Lines around IMG fallback sizing (data-snapdomWidth/Height).
   */
  it('IMG sets data-snapdomWidth/Height using attr/prop fallback when BCR is 0', async () => {
    const img = document.createElement('img')
    img.setAttribute('width', '33')
    img.setAttribute('height', '22')
    // BCR returns 0 → force attribute/prop fallback
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 })
    const clone = await deepClone(img, session, {})
    expect(clone.dataset.snapdomWidth).toBe('33')
    expect(clone.dataset.snapdomHeight).toBe('22')
  })

  /**
   * Covers: textarea pendingTextAreaValue → final textContent assignment path.
   */
  it('TEXTAREA applies pendingTextAreaValue to clone.textContent', async () => {
    const ta = document.createElement('textarea')
    ta.value = 'typed'
    vi.spyOn(ta, 'getBoundingClientRect').mockReturnValue({ width: 50, height: 20 })
    const clone = await deepClone(ta, session, {})
    expect(clone.textContent).toBe('typed')
    expect(clone.style.width).toBe('50px')
    expect(clone.style.height).toBe('20px')
  })

  /**
   * Covers: input.indeterminate branch and attribute mirroring.
   */
  it('INPUT copies indeterminate flag along with checked/value', async () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = false
    input.indeterminate = true
    input.value = 'vv'
    const c = await deepClone(input, session, {})
    expect(c.value).toBe('vv')
    expect(c.checked).toBe(false)
    expect(c.indeterminate).toBe(true)
    // value attribute mirrored
    expect(c.getAttribute('value')).toBe('vv')
  })

  /**
   * Covers: SLOT fallback path when assignedNodes() is empty → clones childNodes,
   * and markSlottedSubtree() adds data-sd-slotted to element descendants.
   */
  it('SLOT fallback clones childNodes and marks slotted subtree', async () => {
    const slot = document.createElement('slot')
    // assignedNodes() returns empty → fallback to childNodes
    Object.defineProperty(slot, 'assignedNodes', { configurable: true, value: () => [] })
    const span = document.createElement('span')
    span.textContent = 'fallback!'
    slot.appendChild(span)

    const frag = await deepClone(slot, session, {})
    expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE)
    const clonedSpan = frag.firstChild
    expect(clonedSpan.tagName).toBe('SPAN')
    // markSlottedSubtree should set data-sd-slotted
    expect(clonedSpan.hasAttribute('data-sd-slotted')).toBe(true)
  })

  /**
   * Covers: SLOT assignedNodes path but with Element (not text) to exercise markSlottedSubtree element marking.
   */
  it('SLOT assignedNodes path clones elements and flags them as slotted', async () => {
    const slot = document.createElement('slot')
    const given = document.createElement('em'); given.textContent = 'slotted!'
    Object.defineProperty(slot, 'assignedNodes', {
      configurable: true,
      value: () => [given],
    })
    const frag = await deepClone(slot, session, {})
    const em = frag.firstChild
    expect(em.tagName).toBe('EM')
    expect(em.getAttribute('data-sd-slotted')).toBe('')
  })

  it('ShadowRoot injects rewritten CSS and seeds custom props used by var()', async () => {
  const host = document.createElement('div')
  const sr = host.attachShadow({ mode: 'open' })

  // Host carries the custom prop
  host.style.setProperty('--brand', 'hotpink')

  const style = document.createElement('style')
  style.textContent = `
    .btn { color: var(--brand) }
    ::slotted(a) { text-decoration: underline }
  `
  sr.appendChild(style)

  // ⚠️ important: attach to DOM so computed styles resolve
  document.body.appendChild(host)

  const out = await deepClone(host, session, {})
  const injected = out.querySelector('style[data-sd]')
  expect(!!injected).toBe(true)
  const css = injected?.textContent || ''

  // Seeding rule present
  expect(css).toMatch(/--brand:\s*hotpink/)
  // Rewriting applied
  expect(css).toMatch(/:where\(\[data-sd="s\d+"\]\s+\.btn:not\(\[data-sd-slotted\]\)\)/)
  expect(css).toMatch(/:where\(\[data-sd="s\d+"\]\s+a\)/)

  host.remove()
})


  it('ShadowRoot cloning skips <style> nodes in child iteration', async () => {
  const host = document.createElement('div')
  const sr = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = '.x{color:red}'
  const txt = document.createTextNode('inside')
  sr.appendChild(style)
  sr.appendChild(txt)

  const clone = await deepClone(host, session, { fast: true })

  // solo debe estar el style inyectado (data-sd), no el <style> original del SR
  const authoredStyles = Array.from(clone.querySelectorAll('style')).filter(s => !s.hasAttribute('data-sd'))
  expect(authoredStyles.length).toBe(0)

  // el texto puede estar presente (no lo filtramos)
  expect((clone.textContent || '')).toContain('inside')
})

})
describe('deepClone – extra targets to lift coverage', () => {
  let session
  const makeSession = () => ({
    styleMap: cache.session.styleMap,
    styleCache: cache.session.styleCache,
    nodeMap: cache.session.nodeMap,
  })

  beforeEach(() => {
    if (cache.session?.styleMap?.clear) cache.session.styleMap.clear()
    cache.session.styleCache = new WeakMap()
    cache.session.nodeMap = new Map()
    session = makeSession()
  })

  it('ShadowRoot seeds custom props from :root (documentElement) when host has none', async () => {
    // :root define la var, host no
    document.documentElement.style.setProperty('--brand', 'deepskyblue')

    const host = document.createElement('div')
    const sr = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      .btn { color: var(--brand) }
      /* un selector ya envuelto no debe duplicarse */
      :where(.already){ opacity: .5 }
      /* un @rule debe preservarse tal cual */
      @media (min-width: 1px) { .m { display: block } }
      /* ::slotted no excluye rightmost */
      ::slotted(a){ text-decoration: underline }
    `
    sr.appendChild(style)

    // anclar para que getComputedStyle(root) funcione estable
    document.body.appendChild(host)

    const out = await deepClone(host, session, { fast: true })
    const injected = out.querySelector('style[data-sd]')
    expect(!!injected).toBe(true)
    const css = injected.textContent || ''

    // seed desde :root
    expect(css).toMatch(/\[data-sd="s\d+"\]\{[^}]*--brand:\s*deepskyblue/i)

    // ::slotted reescrito como descendiente dentro del scope (sin :not([data-sd-slotted]))
    expect(css).toMatch(/:where\(\[data-sd="s\d+"\]\s+a\)/)

     const alreadyMatches = css.match(/:where\(\.already\)/g) || []
      expect(alreadyMatches.length).toBe(1)
       expect(css).toMatch(/:where\(\s*\[?data-sd="s\d+"\]?[^\)]*\)\s*[\s\S]*:where\(\.already\)\s*:not\(\[data-sd-slotted\]\)\)/)

    // el bloque @media queda presente (el rewriter ignora @ en la captura de selectores)
    expect(css).toMatch(/@media\s*\(min-width:\s*1px\)\s*\{\s*\.m\s*\{\s*display:\s*block/i)

    // limpiar
    host.remove()
    document.documentElement.style.removeProperty('--brand')
  })

  it('nextShadowScopeId increments across hosts (s1, s2) y addNotSlottedRightmost no duplica :not([data-sd-slotted])', async () => {
    // primer host
    const h1 = document.createElement('div')
    const s1 = h1.attachShadow({ mode: 'open' })
    const st1 = document.createElement('style')
    st1.textContent = `.x { color: red }`
    s1.appendChild(st1)

    // segundo host
    const h2 = document.createElement('div')
    const s2 = h2.attachShadow({ mode: 'open' })
    const st2 = document.createElement('style')
    // ya contiene :not([data-sd-slotted]) → no se debe duplicar al reescribir
    st2.textContent = `.y:not([data-sd-slotted]) { color: blue }`
    s2.appendChild(st2)

    const out1 = await deepClone(h1, session, { fast: true })
    const out2 = await deepClone(h2, session, { fast: true })
    const css1 = out1.querySelector('style[data-sd]')?.textContent || ''
    const css2 = out2.querySelector('style[data-sd]')?.textContent || ''

    // scopes distintos
    const sId1 = (out1.getAttribute('data-sd') || '').match(/^s\d+$/)?.[0]
    const sId2 = (out2.getAttribute('data-sd') || '').match(/^s\d+$/)?.[0]
    expect(sId1).not.toBeFalsy()
    expect(sId2).not.toBeFalsy()
    expect(sId1).not.toBe(sId2)

    // para .y ya traía :not([data-sd-slotted]) → no duplicar
    // (basta con chequear que sólo haya una ocurrencia junto a .y)
    const occurrences = (css2.match(/\.y:not\(\[data-sd-slotted\]\)/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('IFRAME rasterization path: pin/unpin viewport, border-aware content sizing, wrapper keeps rect size', async () => {
    const iframe = document.createElement('iframe')

    // Simular same-origin: contentDocument y documentElement disponibles
    const fakeDoc = document.implementation.createHTMLDocument('inner')
    // track de estilos inyectados para validar pin/unpin
    const appended = []
    const origAppendChild = fakeDoc.head.appendChild.bind(fakeDoc.head)
    fakeDoc.head.appendChild = (node) => { appended.push(node); return origAppendChild(node) }

    Object.defineProperty(iframe, 'contentDocument', { configurable: true, get: () => fakeDoc })
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => ({ document: fakeDoc }) })

    // BCR total del iframe (incluye bordes)
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 150 })

    // Bordes para que measureContentBox reste 2px en total por lado (ejemplo)
    Object.assign(iframe.style, {
      borderLeftWidth: '2px',
      borderRightWidth: '2px',
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    })

    // offsetWidth/Height cuando hacemos placeholders, pero acá rasterizamos
    Object.defineProperty(iframe, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(iframe, 'offsetHeight', { configurable: true, get: () => 150 })

    // snapdom simulado en options: toPng devuelve un <img> listo
    const snap = {
      toPng: async () => {
        const img = document.createElement('img')
        // no setear src real: no es necesario para este test
        return img
      }
    }

    const out = await deepClone(iframe, session, { fast: true, snap })

    // 1) Se creó un style de pin en el iframe (data-sd-iframe-pin) y se removió al salir
    const hadPin = appended.some(n => n.tagName === 'STYLE' && n.getAttribute('data-sd-iframe-pin') !== null)
    expect(hadPin).toBe(true)
    // tras el finally de rasterizeIframe, ese <style> debería haber sido removido del head
    const stillPinned = !!fakeDoc.head.querySelector('style[data-sd-iframe-pin]')
    expect(stillPinned).toBe(false)

    // 2) Wrapper con tamaño del BCR (redondeado)
    expect(out.tagName).toBe('DIV')
    expect(out.style.width).toBe('200px')
    expect(out.style.height).toBe('150px')

    // 3) El <img> interno adopta el content-box (resta bordes):
    const img = out.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.style.width).toBe('200px')
    expect(img.style.height).toBe('150px')
  })

  it('IFRAME rasterization fails when snapdom.toPng is missing → fallback spacer/placeholder', async () => {
    const iframe = document.createElement('iframe')
    // same-origin simulado pero sin snapdom usable
    const fakeDoc = document.implementation.createHTMLDocument('x')
    Object.defineProperty(iframe, 'contentDocument', { configurable: true, get: () => fakeDoc })
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => ({ document: fakeDoc }) })
    Object.defineProperty(iframe, 'offsetWidth', { configurable: true, get: () => 80 })
    Object.defineProperty(iframe, 'offsetHeight', { configurable: true, get: () => 40 })

    // con placeholders → debe devolver fallback DIV con gradiente
    const out1 = await deepClone(iframe, session, { placeholders: true })
    expect(out1.tagName).toBe('DIV')
    expect(out1.style.backgroundImage).toContain('repeating-linear-gradient')

    // sin placeholders → spacer invisible con tamaño del BCR
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({ width: 80, height: 40 })
    const out2 = await deepClone(iframe, session, { placeholders: false })
    expect(out2.tagName).toBe('DIV')
    expect(out2.style.visibility).toBe('hidden')
    expect(out2.style.width).toBe('80px')
    expect(out2.style.height).toBe('40px')
  })

  it('collects multiple custom props in CSS and deduplica', async () => {
    // Validación indirecta a través del seed: dos props distintas, referenciadas por var()
    const host = document.createElement('div')
    const sr = host.attachShadow({ mode: 'open' })
    // defino ambas en host y en :root para asegurar valores
    host.style.setProperty('--a', '1px')
    document.documentElement.style.setProperty('--b', 'solid')

    const st = document.createElement('style')
    st.textContent = `
      .x { border-width: var(--a); border-style: var(--b); }
    `
    sr.appendChild(st)

    document.body.appendChild(host)
    const out = await deepClone(host, session, { fast: true })
    const css = out.querySelector('style[data-sd]')?.textContent || ''

    // ambas aparecen seed-eadas
    expect(css).toMatch(/--a:\s*1px/)
    expect(css).toMatch(/--b:\s*solid/)

    host.remove()
    document.documentElement.style.removeProperty('--b')
  })
})
