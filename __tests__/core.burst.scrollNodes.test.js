// Scroll-node listing in the burst memo. Firefox reports the text width of an inline box as its
// scrollWidth, so listing every inline element made the list change length with each inserted
// <span>: the sample before a capture differed from the one at commit and the next capture ran
// the full pipeline instead of hitting the memo. The first test is red on Firefox only; the
// other two guard what the narrower listing must keep, on every engine.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

afterEach(() => { document.body.innerHTML = '' })

describe('scroll nodes of the burst memo', () => {
  it('an inserted inline element does not cost the next capture a full run', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:200px;padding:4px'
    el.innerHTML = '<p>one <span>two</span></p><p>three <span>four</span></p>'
    document.body.appendChild(el)
    for (let i = 0; i < 3; i++) await snapdom(el)
    el.querySelector('p').appendChild(document.createElement('span')).textContent = 'new'
    await new Promise((r) => setTimeout(r, 0))
    const absorbed = await snapdom(el)
    const next = await snapdom(el)
    expect(next).toBe(absorbed)
  })

  it('a scrolled overflow box inside the root still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;padding:4px'
    el.innerHTML = '<div class="scroller" style="width:60px;height:30px;overflow:auto"><div style="width:60px;height:200px;background:linear-gradient(red,blue)"></div></div>'
    document.body.appendChild(el)
    for (let i = 0; i < 3; i++) await snapdom(el)
    const before = await snapdom(el)
    el.querySelector('.scroller').scrollTop = 100
    const after = await snapdom(el)
    expect(after).not.toBe(before)
  })

  it('a scroll container with no client size still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;height:80px'
    el.innerHTML = '<div class="scroller" style="width:0.4px;height:0.4px;overflow:hidden;transform:scale(100);transform-origin:0 0"><div style="width:0.4px;height:3px;background:linear-gradient(red,blue)"></div></div>'
    document.body.appendChild(el)
    const scroller = el.querySelector('.scroller')
    expect(scroller.clientHeight).toBe(0)
    for (let i = 0; i < 3; i++) await snapdom(el)
    const before = await snapdom(el)
    scroller.scrollTop = 1.5
    expect(scroller.scrollTop).toBeGreaterThan(0)
    const after = await snapdom(el)
    expect(after).not.toBe(before)
  })

  // The light tree is walked through styleScan's scroll gate, not element by element: a
  // scroller made one by a stylesheet rule, or by the UA sheet alone, must still be listed.
  it('a box a stylesheet rule makes scrollable still invalidates the memo', async () => {
    const style = document.createElement('style')
    style.textContent = '.zz-sheet-scroller { width: 60px; height: 30px; overflow-y: auto }'
    document.head.appendChild(style)
    try {
      const el = document.createElement('div')
      el.style.cssText = 'width:80px;padding:4px'
      el.innerHTML = '<div class="zz-sheet-scroller"><div style="height:200px;background:linear-gradient(red,blue)"></div></div>'
      document.body.appendChild(el)
      for (let i = 0; i < 3; i++) await snapdom(el)
      const before = await snapdom(el)
      el.querySelector('.zz-sheet-scroller').scrollTop = 100
      const after = await snapdom(el)
      expect(after).not.toBe(before)
    } finally {
      style.remove()
    }
  })

  it('a textarea scrolled by the page still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;padding:4px'
    el.innerHTML = `<textarea rows="2" cols="8">${'line\n'.repeat(30)}</textarea>`
    document.body.appendChild(el)
    for (let i = 0; i < 3; i++) await snapdom(el)
    const before = await snapdom(el)
    el.querySelector('textarea').scrollTop = 40
    const after = await snapdom(el)
    expect(after).not.toBe(before)
  })
})

// A shadow root in the capture turns the gate off, as an unreadable sheet does: every element
// is walked, and Chromium's precheck reads each one's computed overflow instead of matching rules.
describe('scroll nodes of the burst memo, without the scroll gate', () => {
  const withShadowRoot = (el) => {
    el.appendChild(document.createElement('div')).attachShadow({ mode: 'open' }).innerHTML = '<span>shadow</span>'
    return el
  }
  const scrolledAway = async (el, scroll) => {
    for (let i = 0; i < 3; i++) await snapdom(el)
    const before = await snapdom(el)
    scroll()
    const after = await snapdom(el)
    return after !== before
  }

  it('a box a stylesheet rule makes scrollable still invalidates the memo', async () => {
    const style = document.createElement('style')
    style.textContent = '.zz-walk-scroller { width: 60px; height: 30px; overflow-y: auto }'
    document.head.appendChild(style)
    try {
      const el = document.createElement('div')
      el.style.cssText = 'width:80px;padding:4px'
      el.innerHTML = '<div class="zz-walk-scroller"><div style="height:200px;background:linear-gradient(red,blue)"></div></div>'
      document.body.appendChild(withShadowRoot(el))
      expect(await scrolledAway(el, () => { el.querySelector('.zz-walk-scroller').scrollTop = 100 })).toBe(true)
    } finally {
      style.remove()
    }
  })

  // The memo's first walk lists what the walk at commit lists, or the first capture is not kept.
  it('serves the first capture again with scroll containers in the walk', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;padding:4px'
    el.innerHTML = `<div style="width:60px;height:30px;overflow:auto"><div style="height:200px"></div></div>
      <input style="width:50px" value="${'wide text '.repeat(10)}">`
    document.body.appendChild(withShadowRoot(el))
    const first = await snapdom(el)
    expect(await snapdom(el)).toBe(first)
  })

  it('a box a shadow root sheet makes scrollable still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;padding:4px'
    const root = el.appendChild(document.createElement('div')).attachShadow({ mode: 'open' })
    root.innerHTML = '<style>.s { width: 60px; height: 30px; overflow: auto }</style><div class="s"><div style="height:200px;background:linear-gradient(red,blue)"></div></div>'
    document.body.appendChild(el)
    expect(await scrolledAway(el, () => { root.querySelector('.s').scrollTop = 100 })).toBe(true)
  })

  it('a scroll container with no client size still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;height:80px'
    el.innerHTML = '<div class="scroller" style="width:0.4px;height:0.4px;overflow:hidden;transform:scale(100);transform-origin:0 0"><div style="width:0.4px;height:3px;background:linear-gradient(red,blue)"></div></div>'
    document.body.appendChild(withShadowRoot(el))
    const scroller = el.querySelector('.scroller')
    expect(await scrolledAway(el, () => { scroller.scrollTop = 1.5 })).toBe(true)
  })

  it('a text input scrolled by the page still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;padding:4px'
    el.innerHTML = `<input style="width:50px" value="${'wide text '.repeat(10)}">`
    document.body.appendChild(withShadowRoot(el))
    const input = el.querySelector('input')
    expect(await scrolledAway(el, () => { input.scrollLeft = 60 })).toBe(true)
    expect(input.scrollLeft).toBeGreaterThan(0)
  })

  it('a textarea scrolled by the page still invalidates the memo', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;padding:4px'
    el.innerHTML = `<textarea rows="2" cols="8">${'line\n'.repeat(30)}</textarea>`
    document.body.appendChild(withShadowRoot(el))
    expect(await scrolledAway(el, () => { el.querySelector('textarea').scrollTop = 40 })).toBe(true)
  })
})
