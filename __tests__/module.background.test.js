import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inlineBackgroundImages } from '../src/modules/background.js'
import { cache } from '../src/core/cache.js'

describe('inlineBackgroundImages', () => {
  let source, clone
  beforeEach(() => {
    source = document.createElement('div')
    clone = document.createElement('div')
    document.body.appendChild(source)
    document.body.appendChild(clone)
  })
  afterEach(() => {
    document.body.removeChild(source)
    document.body.removeChild(clone)
  })

  it('does not fail if there is no background-image', async () => {
    source.style.background = 'none'
    await expect(inlineBackgroundImages(source, clone, new WeakMap())).resolves.toBeUndefined()
  })

  it('processes a valid background-image', async () => {
    source.style.backgroundImage = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==")'
    await expect(inlineBackgroundImages(source, clone, new WeakMap())).resolves.toBeUndefined()
  })

  describe('child alignment with clone-only elements (#439)', () => {
    const attached = []

    /** Create a div, optionally with background, and append to parent */
    function div(parent, bg) {
      const el = document.createElement('div')
      if (bg) el.style.backgroundImage = bg
      if (parent) parent.appendChild(el)
      return el
    }

    /** Mount an element to the document for computed style resolution */
    function mount(el) {
      document.body.appendChild(el)
      attached.push(el)
      return el
    }

    /** Register clone→source in nodeMap */
    function link(cloneEl, srcEl) {
      cache.session.nodeMap.set(cloneEl, srcEl)
    }

    beforeEach(() => { cache.session.nodeMap = new Map() })
    afterEach(() => { attached.forEach(el => el.remove()) })

    it('skips injected SVG and applies gradient to correct clone child', async () => {
      const src = mount(document.createElement('div'))
      const srcHeader = div(src)
      const srcBody = div(src, 'linear-gradient(red, blue)')

      const cln = mount(document.createElement('div'))
      const injected = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      cln.appendChild(injected) // no nodeMap entry — clone-only
      const clnHeader = div(cln)
      const clnBody = div(cln)

      link(cln, src); link(clnHeader, srcHeader); link(clnBody, srcBody)
      await inlineBackgroundImages(src, cln, new WeakMap())

      expect(clnHeader.style.backgroundImage).not.toContain('linear-gradient')
      expect(clnBody.style.backgroundImage).toContain('linear-gradient')
    })

    it('pairs correctly without injected elements', async () => {
      const src = mount(document.createElement('div'))
      const src1 = div(src, 'linear-gradient(green, yellow)')
      const src2 = div(src, 'linear-gradient(purple, orange)')

      const cln = mount(document.createElement('div'))
      const cln1 = div(cln)
      const cln2 = div(cln)

      link(cln, src); link(cln1, src1); link(cln2, src2)
      await inlineBackgroundImages(src, cln, new WeakMap())

      expect(cln1.style.backgroundImage).toContain('rgb(0, 128, 0)')
      expect(cln2.style.backgroundImage).toContain('rgb(128, 0, 128)')
    })

    it('skips multiple injected elements at various positions', async () => {
      const src = mount(document.createElement('div'))
      const srcA = div(src, 'linear-gradient(red, blue)')
      const srcB = div(src)

      const cln = mount(document.createElement('div'))
      cln.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')) // injected
      const clnA = div(cln)
      const pseudo = document.createElement('span')
      pseudo.dataset.snapdomPseudo = '::after'
      cln.appendChild(pseudo) // injected
      const clnB = div(cln)

      link(cln, src); link(clnA, srcA); link(clnB, srcB)
      await inlineBackgroundImages(src, cln, new WeakMap())

      expect(clnA.style.backgroundImage).toContain('linear-gradient')
      expect(clnB.style.backgroundImage || '').not.toContain('linear-gradient')
    })
  })
})
