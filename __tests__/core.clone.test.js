import { describe, it, expect } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { createContext } from '../src/core/context.js'
import { cache } from '../src/core/cache.js'

let options = createContext()
const sessionCache = {
        styleMap: cache.session.styleMap,
        styleCache: cache.session.styleCache,
        nodeMap: cache.session.nodeMap
      }

async function runClone(node) {
  return await deepClone(node, sessionCache, {...options})
}

describe('deepClone', () => {
  it('clones a simple div', async () => {
    const el = document.createElement('div')
    el.textContent = 'hello'
    const clone = await runClone(el)
    expect(clone).not.toBe(el)
    expect(clone.textContent).toBe('hello')
  })

  it('clones canvas as an image', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'red'
      ctx.fillRect(0, 0, 10, 10)
    }
    const clone = await runClone(canvas)
    expect(clone.tagName).toBe('IMG')
    expect(clone.src.startsWith('data:image/')).toBe(true)
  })

  it('renders <audio controls> as a player image (#444)', async () => {
    const audio = document.createElement('audio')
    audio.controls = true
    document.body.appendChild(audio)
    const clone = await runClone(audio)
    document.body.removeChild(audio)
    expect(clone.tagName).toBe('IMG')
    expect(clone.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('leaves <audio> without controls to the generic clone (#444)', async () => {
    const audio = document.createElement('audio')
    document.body.appendChild(audio)
    const clone = await runClone(audio)
    document.body.removeChild(audio)
    expect(clone.tagName).toBe('AUDIO')
  })

  it('deepClone handles data-capture="exclude"', async () => {
    const el = document.createElement('div')
    el.setAttribute('data-capture', 'exclude')
    const clone = await runClone(el)
    expect(clone).not.toBeNull()
  })

  it('deepClone handles data-capture="placeholder"', async () => {
    const el = document.createElement('div')
    el.setAttribute('data-capture', 'placeholder')
    el.setAttribute('data-placeholder-text', 'Placeholder!')
    const clone = await runClone(el)
    expect(clone.textContent).toContain('Placeholder!')
  })

  it('deepClone handles iframe', async () => {
    const iframe = document.createElement('iframe')
    iframe.width = 100
    iframe.height = 50
    const clone = await runClone(iframe)
    expect(clone.tagName).toBe('DIV')
  })

  it('deepClone handles input, textarea, select', async () => {
    const input = document.createElement('input')
    input.value = 'foo'
    input.checked = true

    const textarea = document.createElement('textarea')
    textarea.value = 'bar'

    const select = document.createElement('select')
    const opt = document.createElement('option')
    opt.value = 'baz'
    select.appendChild(opt)
    select.value = 'baz';

    [input, textarea, select].forEach(async el => {
      const clone = await runClone(el)
      expect(clone.value).toBe(el.value)
    })
  })

  it('deepClone handles shadow DOM', async () => {
    const el = document.createElement('div')
    const shadow = el.attachShadow({ mode: 'open' })
    const span = document.createElement('span')
    span.textContent = 'shadow'
    shadow.appendChild(span)
    const clone = await runClone(el)
    expect(clone).not.toBeNull()
  })
})

describe('deepClone — <picture> sources', () => {
  const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

  function makePicture() {
    const picture = document.createElement('picture')
    picture.innerHTML =
      '<source media="(min-width: 1367px)" srcset="https://example.com/big.jpg">' +
      '<source media="(min-width: 0px)" srcset="https://example.com/small.jpg">'
    const img = document.createElement('img')
    img.src = PX
    picture.appendChild(img)
    document.body.appendChild(picture)
    return picture
  }

  // A <source> out-ranks the <img>'s own src, so leaving it in the export re-selects an
  // external URL that svg-as-image may not load — the picture then rasterizes blank even
  // though the <img> was inlined correctly.
  it('drops <source> children of <picture> so the inlined <img> src wins', async () => {
    const picture = makePicture()
    try {
      const clone = await runClone(picture)
      expect(clone.querySelectorAll('source').length).toBe(0)
      const img = clone.querySelector('img')
      expect(img).not.toBeNull()
      expect(img.getAttribute('src')).toBe(PX)
      expect(clone.outerHTML).not.toContain('example.com')
    } finally {
      picture.remove()
    }
  })

  it('keeps <source> outside a <picture>', async () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<source srcset="https://example.com/x.jpg">'
    document.body.appendChild(wrapper)
    try {
      const clone = await runClone(wrapper)
      expect(clone.querySelectorAll('source').length).toBe(1)
    } finally {
      wrapper.remove()
    }
  })
})

describe('deepClone edge cases', () => {
  it('clones unsupported node (Comment) as a new Comment', async () => {
    const fake = document.createComment('not supported')
    const result = await runClone(fake)
    expect(result.nodeType).toBe(Node.COMMENT_NODE)
    expect(result.textContent).toBe('not supported')
    expect(result).not.toBe(fake)
  })

  it('clones attributes and children', async () => {
    const el = document.createElement('div')
    el.setAttribute('data-test', '1')
    const result = await runClone(el)
    expect(result.getAttribute('data-test')).toBe('1')
  })
})
