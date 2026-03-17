// __tests__/module.changeCSS.test.js – freezeSticky coverage
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freezeSticky } from '../src/modules/changeCSS.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('freezeSticky', () => {
  it('returns early for null roots', () => {
    const clone = document.createElement('div')
    expect(() => freezeSticky(null, clone)).not.toThrow()
    expect(() => freezeSticky(document.createElement('div'), null)).not.toThrow()
  })

  it('returns early when scrollTop is 0', () => {
    const orig = document.createElement('div')
    orig.style.height = '200px'
    orig.style.overflow = 'auto'
    const sticky = document.createElement('div')
    sticky.style.position = 'sticky'
    sticky.style.top = '0'
    orig.appendChild(sticky)
    document.body.appendChild(orig)
    const clone = orig.cloneNode(true)
    freezeSticky(orig, clone)
    expect(clone.querySelector('[data-snap-ph]')).toBeNull()
  })

  it('freezes sticky elements when scrollTop > 0', async () => {
    const orig = document.createElement('div')
    orig.style.cssText = 'height:100px; overflow:auto; position:relative;'
    const sticky = document.createElement('div')
    sticky.style.cssText = 'position:sticky; top:0; height:24px; min-height:24px;'
    sticky.textContent = 'sticky'
    orig.appendChild(sticky)
    const filler = document.createElement('div')
    filler.style.height = '200px'
    filler.textContent = 'filler'
    orig.appendChild(filler)
    document.body.appendChild(orig)
    orig.scrollTop = 50
    await new Promise(r => requestAnimationFrame(r))
    const clone = orig.cloneNode(true)
    document.body.appendChild(clone)
    freezeSticky(orig, clone)
    const cloneSticky = Array.from(clone.children).find(c => !c.hasAttribute('data-snap-ph'))
    if (cloneSticky) {
      expect(cloneSticky.style.position).toBe('absolute')
    }
    expect(clone.querySelector('[data-snap-ph="1"]')).toBeTruthy()
  })
})
