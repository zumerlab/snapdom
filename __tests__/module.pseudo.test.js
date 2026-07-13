// __tests__/modules.pseudo.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inlinePseudoElements } from '../src/modules/pseudo.js'

// Mock de utils y fonts con importActual para que Vitest Browser no rompa
vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils')
  return {
    ...actual,
    fetchImage: vi.fn(),
    inlineSingleBackgroundEntry: vi.fn(), // agregado para cubrir casos extra
  }
})

vi.mock('../src/modules/fonts.js', async () => {
  const actual = await vi.importActual('../src/modules/fonts.js')
  return {
    ...actual,
    iconToImage: vi.fn(),
  }
})

import * as helpers from '../src/utils/index.js'
import * as fonts from '../src/modules/fonts.js'

const sessionCache = {
  styleMap: new Map(),
  styleCache: new WeakMap()
}

describe('inlinePseudoElements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not fail with simple elements', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    await expect(inlinePseudoElements(el, clone, sessionCache, {})).resolves.toBeUndefined()
  })

  it('handles ::before with text content', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? '"★"'
            : prop === 'font-family' ? 'Arial'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'none'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with icon font', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? '"★"'
            : prop === 'font-family' ? 'Font Awesome'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'none'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Font Awesome'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    fonts.iconToImage.mockResolvedValue('data:image/png;base64,icon')
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with url content', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? 'url("https://test.com/img.png")'
            : prop === 'font-family' ? 'Arial'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'none'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    helpers.fetchImage.mockResolvedValue('data:image/png;base64,img')
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with background-image (data url)', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? 'none'
            : prop === 'font-family' ? 'Arial'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'url("data:image/png;base64,abc")'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with background-image (fetch ok)', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? 'none'
            : prop === 'font-family' ? 'Arial'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'url("https://test.com/img.png")'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    helpers.fetchImage.mockResolvedValue('data:image/png;base64,img')
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with background-image (fetch error)', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) =>
          prop === 'content' ? 'none'
            : prop === 'font-family' ? 'Arial'
            : prop === 'font-size' ? '32'
            : prop === 'font-weight' ? '400'
            : prop === 'color' ? '#000'
            : prop === 'background-image' ? 'url("https://test.com/img.png")'
            : prop === 'background-color' ? 'transparent'
            : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '', color: '', fontSize: '', fontWeight: '', fontFamily: '' }
    })
    helpers.fetchImage.mockRejectedValue(new Error('fail'))
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('cubre el catch de error en inlineSingleBackgroundEntry', async () => {
    helpers.inlineSingleBackgroundEntry.mockRejectedValue(new Error('fail'))
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'background-image' ? 'url("data:image/png;base64,abc")' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('cubre el inlining exitoso con inlineSingleBackgroundEntry', async () => {
    helpers.inlineSingleBackgroundEntry.mockResolvedValue('url("data:image/png;base64,abc")')
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'background-image' ? 'url("https://test.com/img.png")' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::before with no visible box', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return { getPropertyValue: () => 'none' }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles ::first-letter with no textNode', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ getPropertyValue: () => '' }))
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('handles error in pseudo processing', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('fail') })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('ignores if source no es Element', async () => {
    const notElement = {}
    const clone = document.createElement('div')
    await expect(inlinePseudoElements(notElement, clone, sessionCache, {})).resolves.toBeUndefined()
  })

  it('ignores if clone no es Element', async () => {
    const el = document.createElement('div')
    const notElement = {}
    await expect(inlinePseudoElements(el, notElement, {})).resolves.toBeUndefined()
  })

  it('inserta pseudoEl como ::after', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::after') return {
        getPropertyValue: (prop) => prop === 'content' ? '"after"' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('inserta pseudoEl como ::before', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return {
        getPropertyValue: (prop) => prop === 'content' ? '"before"' : '',
        color: '#000', fontSize: '32px', fontWeight: '400', fontFamily: 'Arial'
      }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('maneja ::first-letter meaningful', async () => {
    const el = document.createElement('div')
    el.textContent = 'Test'
    const clone = document.createElement('div')
    clone.textContent = 'Test'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::first-letter') return {
        getPropertyValue: (prop) => prop === 'color' ? '#f00' : '', color: '#f00', fontSize: '32px'
      }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('inserta ambos pseudoEl ::before y ::after', async () => {
    const el = document.createElement('div')
    const clone = document.createElement('div')
    vi.spyOn(window, 'getComputedStyle').mockImplementation((_, pseudo) => {
      if (pseudo === '::before') return { getPropertyValue: () => '"before"' }
      if (pseudo === '::after') return { getPropertyValue: () => '"after"' }
      return { getPropertyValue: () => '' }
    })
    await inlinePseudoElements(el, clone, sessionCache, {})
    window.getComputedStyle.mockRestore()
  })

  it('should inline ::first-letter when style is meaningful', async () => {
    const el = document.createElement('p')
    el.textContent = '¡Hola mundo!'
    el.style.setProperty('color', 'black')
    document.body.appendChild(el)
    const clone = el.cloneNode(true)
    const style = document.createElement('style')
    style.textContent = `
      p::first-letter {
        color: red;
        font-size: 200%;
      }
    `
    document.head.appendChild(style)
    await inlinePseudoElements(el, clone, sessionCache, {})
    const firstLetterEl = clone.querySelector('[data-snapdom-pseudo="::first-letter"]')
    expect(firstLetterEl).toBeTruthy()
    expect(firstLetterEl.textContent.length).toBeGreaterThan(0)
  })

  it('#447: does not wrap the first letter of a textarea (would drop it from the value)', async () => {
    const ta = document.createElement('textarea')
    ta.value = 'ajdalfjllalkj'
    document.body.appendChild(ta)
    const style = document.createElement('style')
    style.textContent = 'li::before { content: "x"; }'
    document.head.appendChild(style)
    const clone = ta.cloneNode(true)
    clone.textContent = ta.value
    await inlinePseudoElements(ta, clone, sessionCache, {})
    expect(clone.querySelector('[data-snapdom-pseudo]')).toBeNull()
    expect(clone.value).toBe('ajdalfjllalkj')
  })

  it('should inline background-image entries for pseudo-element', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const style = document.createElement('style')
    style.textContent = `
      div::after {
        content: " ";
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='blue'/%3E%3C/svg%3E");
        display: inline-block;
        width: 10px;
        height: 10px;
      }
    `
    document.head.appendChild(style)
    const clone = el.cloneNode(true)
    await inlinePseudoElements(el, clone, sessionCache, {})
    const pseudoAfter = clone.querySelector('[data-snapdom-pseudo="::after"]')
    expect(pseudoAfter).toBeTruthy()
    expect(pseudoAfter.style.backgroundImage.startsWith('url("data:image/')).toBeTruthy()
  })

  // Regression: issue #235 — `content: counter(x) ")"` rendered as `1 )` (with space),
  // causing the `)` to wrap onto a separate line under display:grid/flex parents.
  it('joins counter() with adjacent string token without source whitespace', async () => {
    const ol = document.createElement('ol')
    ol.className = 'reg-235-ol'
    const li = document.createElement('li')
    li.className = 'reg-235-li'
    li.textContent = 'item'
    ol.appendChild(li)
    document.body.appendChild(ol)

    const style = document.createElement('style')
    style.textContent = `
      .reg-235-ol { counter-reset: item; list-style: none; }
      .reg-235-li::before {
        counter-increment: item;
        content: counter(item) ")";
      }
    `
    document.head.appendChild(style)

    const cloneOl = ol.cloneNode(true)
    const cloneLi = cloneOl.firstElementChild
    await inlinePseudoElements(li, cloneLi, sessionCache, {})

    const before = cloneLi.querySelector('[data-snapdom-pseudo="::before"]')
    expect(before).toBeTruthy()
    expect(before.textContent).toBe('1)')
  })

  // #19: a pseudo's own counter-set must override the counter value before resolving content.
  it('applies counter-set on a pseudo element', async () => {
    const ol = document.createElement('ol')
    ol.className = 'cset-ol'
    const li = document.createElement('li')
    li.className = 'cset-li'
    li.textContent = 'x'
    ol.appendChild(li)
    document.body.appendChild(ol)

    const style = document.createElement('style')
    style.textContent = `
      .cset-ol { counter-reset: item; list-style: none; }
      .cset-li::before {
        counter-set: item 41;
        content: counter(item);
      }
    `
    document.head.appendChild(style)

    const cloneOl = ol.cloneNode(true)
    const cloneLi = cloneOl.firstElementChild
    await inlinePseudoElements(li, cloneLi, sessionCache, {})

    const before = cloneLi.querySelector('[data-snapdom-pseudo="::before"]')
    expect(before).toBeTruthy()
    expect(before.textContent).toBe('41')

    ol.remove()
    style.remove()
  })

  // #419: a single-side border (border-bottom) on a pseudo must be rendered. The shorthand
  // border-width "0px 0px 1px 0px" parsed as parseFloat→0 made the pseudo look border-less,
  // so an empty-content pseudo (no other reason to render) was dropped entirely.
  it('renders an empty-content pseudo that only has a border-bottom', async () => {
    const el = document.createElement('div')
    el.className = 'b419-empty'
    el.textContent = 'host'
    document.body.appendChild(el)

    const style = document.createElement('style')
    style.textContent = `
      .b419-empty::before {
        content: "";
        position: absolute;
        bottom: 0;
        width: 100%;
        border-bottom: 1px solid red;
      }
    `
    document.head.appendChild(style)

    const clone = el.cloneNode(true)
    await inlinePseudoElements(el, clone, { styleMap: new Map(), styleCache: new WeakMap() }, {})

    const before = clone.querySelector('[data-snapdom-pseudo="::before"]')
    expect(before).toBeTruthy() // was dropped before the fix

    el.remove()
    style.remove()
  })

  it('keeps the border-bottom in the snapshot of a content+border pseudo', async () => {
    const el = document.createElement('div')
    el.className = 'b419-text'
    el.textContent = 'host'
    document.body.appendChild(el)

    const style = document.createElement('style')
    style.textContent = `
      .b419-text::before {
        content: "B";
        border-bottom: 1px solid red;
      }
    `
    document.head.appendChild(style)

    const sessionCache2 = { styleMap: new Map(), styleCache: new WeakMap() }
    const clone = el.cloneNode(true)
    await inlinePseudoElements(el, clone, sessionCache2, {})

    const before = clone.querySelector('[data-snapdom-pseudo="::before"]')
    expect(before).toBeTruthy()
    const key = sessionCache2.styleMap.get(before) || ''
    expect(key).toMatch(/border-bottom-width:\s*1px/)
    expect(key).toMatch(/border-bottom-style:\s*solid/)

    el.remove()
    style.remove()
  })

  // #418: antd centers a modal with an empty `::before` spacer (display:inline-block;
  // height:100%; vertical-align:middle). It paints nothing, so it was dropped and the
  // vertical centering collapsed. A box-generating pseudo with real size must be kept.
  it('keeps an empty box-generating pseudo used as a layout spacer', async () => {
    const wrap = document.createElement('div')
    wrap.className = 'centerer'
    wrap.textContent = 'modal'
    document.body.appendChild(wrap)

    const style = document.createElement('style')
    style.textContent = `
      .centerer { height: 200px; text-align: center; }
      .centerer::before {
        content: "";
        display: inline-block;
        width: 0;
        height: 100%;
        vertical-align: middle;
      }
    `
    document.head.appendChild(style)

    const sessionCache3 = { styleMap: new Map(), styleCache: new WeakMap() }
    const clone = wrap.cloneNode(true)
    await inlinePseudoElements(wrap, clone, sessionCache3, {})

    const before = clone.querySelector('[data-snapdom-pseudo="::before"]')
    expect(before).toBeTruthy() // was dropped before the fix → centering collapsed
    const key = sessionCache3.styleMap.get(before) || ''
    expect(key).toMatch(/display:\s*inline-block/)
    expect(key).toMatch(/vertical-align:\s*middle/)

    wrap.remove()
    style.remove()
  })
})
