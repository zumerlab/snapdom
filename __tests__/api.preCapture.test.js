// snapdom.preCapture(): link prefetch, translated. Intent on a control (pointer over it,
// focus, pointer down) captures the element that control asked for the last time, so the
// click that follows is a memo hit; before any control is known, the first intent warms
// the visible viewport once. Nothing runs without a human gesture.
//
// Proven to fail: removing noteCapture's learning turns the learned-control test red;
// dropping the viewport warm turns the first-intent test red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove(); vi.restoreAllMocks() })

function scene() {
  const wrap = document.createElement('div')
  wrap.innerHTML = '<div class="card" style="width:200px;padding:10px;background:#fff;border:1px solid #ccc;font:14px Arial"><h4 style="margin:0">Card</h4><p style="margin:6px 0 0">text</p></div><button type="button" style="margin-top:8px">Share <span>now</span></button>'
  document.body.appendChild(wrap)
  mounted.push(wrap)
  return { card: wrap.querySelector('.card'), button: wrap.querySelector('button') }
}
const fire = (el, type, init = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: type !== 'pointerenter', cancelable: true, pointerType: 'mouse', ...init }))
const settle = () => new Promise((r) => setTimeout(r, 30))

describe('snapdom.preCapture', () => {
  it('is armed once, idempotently', () => {
    expect(snapdom.preCapture()).toBeUndefined()
    expect(snapdom.preCapture()).toBeUndefined()
  })

  it('an unknown press does not start a viewport capture that competes with the click', async () => {
    snapdom.preCapture()
    const { button } = scene()
    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(button, 'pointerdown')
    await settle()
    expect(reads).not.toHaveBeenCalled()
  })

  it('the first early intent warms the viewport, before any control is known', async () => {
    snapdom.preCapture()
    const { button } = scene()
    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(button, 'pointerenter')
    await settle()
    expect(reads).toHaveBeenCalled() // a capture nobody asked for: the viewport warm
  })

  it('learns the control from the capture that follows a press, then prefetches on intent', async () => {
    snapdom.preCapture()
    const { card, button } = scene()
    // The app's click handler: press, then capture. embedFonts:true makes WebKit await its
    // Safari pre-step; attribution is based on when snapdom was called, not when that finishes.
    const options = { scale: 2, embedFonts: true }
    fire(button, 'pointerdown')
    await snapdom(card, options)
    // the element changes, so the memo is gone
    card.querySelector('p').textContent = 'changed'
    await settle()
    // intent on the same control: the prefetch captures the card with the same options
    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(button, 'pointerenter')
    await vi.waitFor(() => { expect(reads).toHaveBeenCalled() }, { timeout: 4000, interval: 20 })
    await settle()
    // the click's capture is a memo hit
    reads.mockClear()
    const res = await snapdom(card, options)
    expect(reads).not.toHaveBeenCalled()
    expect(decodeURIComponent(res.url.split(',')[1])).toContain('changed')
  }, 15_000)

  it('prefetches with the top-level option values used by the learned capture', async () => {
    snapdom.preCapture()
    const { card, button } = scene()
    const options = { scale: 1, embedFonts: false }
    fire(button, 'pointerdown')
    await snapdom(card, options)
    options.scale = 2
    card.querySelector('p').textContent = 'snapshotted options'
    await settle()

    fire(button, 'pointerenter')
    await settle()
    const reads = vi.spyOn(window, 'getComputedStyle')
    const result = await snapdom(card, { scale: 1, embedFonts: false })
    expect(reads).not.toHaveBeenCalled()
    expect(decodeURIComponent(result.url.split(',')[1])).toContain('snapshotted options')
  }, 15_000)

  it('a second unknown control triggers nothing once the viewport is warm', async () => {
    snapdom.preCapture()
    const { button } = scene()
    const other = document.createElement('a')
    other.href = '#'
    other.textContent = 'link'
    document.body.appendChild(other)
    mounted.push(other)
    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(other, 'pointerenter')
    await settle()
    reads.mockClear()
    fire(button, 'pointerenter')
    await settle()
    expect(reads).not.toHaveBeenCalled()
  })

  it('does not learn a capture whose impure plugin prevents automatic burst', async () => {
    snapdom.preCapture()
    const { card, button } = scene()
    let hooks = 0
    const plugin = { name: 'impure-prefetch', afterClone(state) { hooks++; return state } }
    fire(button, 'pointerdown')
    await snapdom(card, { plugins: [plugin] })
    expect(hooks).toBe(1)

    fire(button, 'pointerenter')
    await settle()
    expect(hooks).toBe(1)
  })

  it('does not attribute an unrelated capture from a later task to the press', async () => {
    snapdom.preCapture()
    const { card, button } = scene()
    fire(button, 'pointerdown')
    await settle() // attribution token has closed
    await snapdom(card)
    card.querySelector('p').textContent = 'later'
    await settle()

    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(button, 'pointerenter')
    await settle()
    expect(reads).not.toHaveBeenCalled()
  })

  it('ignores pointerenter dispatched for a descendant of a known control', async () => {
    snapdom.preCapture()
    const { card, button } = scene()
    fire(button, 'pointerdown')
    await snapdom(card)
    card.querySelector('p').textContent = 'dirty'
    await settle()

    const reads = vi.spyOn(window, 'getComputedStyle')
    fire(button.querySelector('span'), 'pointerenter')
    await settle()
    expect(reads).not.toHaveBeenCalled()

    fire(button, 'pointerenter')
    await vi.waitFor(() => { expect(reads).toHaveBeenCalled() }, { timeout: 4000, interval: 20 })
  })
})
