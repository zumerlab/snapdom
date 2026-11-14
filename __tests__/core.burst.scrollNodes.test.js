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
})
