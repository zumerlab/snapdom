// Interactions that produce no mutation record, reproduced with pixels rather than inferred
// from code: hover is synchronously stamped before a memo decision, while selection capture
// conservatively bypasses memoization.
// Both drive the REAL pointer / Selection, so green means the frame followed the interaction
// and red means a memo served the previous one. The control at the end runs the selection
// case with the memo off, to pin the staleness on the memo and not on the pipeline.
//
// The assertions are intentionally independent of event-delivery timing.
import { describe, it, expect, afterEach, vi, inject } from 'vitest'
import { userEvent } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'

// The real pointer is the slow part of this file, and only under BROWSER=all: the first
// pointer command in a fresh test iframe took 6.6 s on webkit with eight files running
// (chromium 0.6 s, firefox 0.8 s) and more than 15 s in the full suite, where the first
// hover test failed on webkit. Every later pointer command took 40 to 340 ms, a capture
// under 100 ms, a raw command round trip to node 5 to 35 ms (measured 2026-09-04). Same
// sizing rule as visual.demos.shared.js: the engine count is the load.
const ENGINES = inject('engines') ?? 1
vi.setConfig({ testTimeout: 15000 * ENGINES })

let mounted
let style
afterEach(async () => {
  window.getSelection().removeAllRanges()
  if (mounted) { try { await userEvent.unhover(mounted) } catch { /* already gone */ } }
  mounted?.remove()
  style?.remove()
  mounted = style = null
})

function mountCSS(css) {
  style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}

function mountBox(className) {
  mounted = document.createElement('div')
  mounted.className = className
  mounted.style.cssText = 'width:240px;font:16px Arial'
  mounted.textContent = 'SELECT THIS TEXT'
  document.body.appendChild(mounted)
  return mounted
}

function selectAll(el) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Pixels within 40 of the given rgb. */
function hits(canvas, [r, g, b]) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 40 && Math.abs(data[i + 1] - g) < 40 && Math.abs(data[i + 2] - b) < 40) n++
  }
  return n
}

const RED = [255, 0, 0]
const PINK = [255, 0, 102]
const BASE = { dpr: 1, scale: 1, embedFonts: false }
// Backgrounds live in the sheet: an inline background would outrank the :hover rule.
const HOVER_CSS = '.zzh{color:white;background:rgb(255,255,255)} .zzh:hover{background:rgb(255,0,0)}'

describe('a hover that left between two captures', () => {
  it('is not served again by the snapshot cache', async () => {
    mountCSS(HOVER_CSS)
    mountBox('zzh')
    await userEvent.hover(mounted)
    expect(mounted.matches(':hover')).toBe(true) // precondition: the real pointer is over it
    expect(hits(await snapdom.toCanvas(mounted, BASE), RED)).toBeGreaterThan(1000)

    await userEvent.unhover(mounted)
    expect(mounted.matches(':hover')).toBe(false)
    expect(hits(await snapdom.toCanvas(mounted, BASE), RED)).toBe(0)
  })

  it('is not served again by the burst memo', async () => {
    mountCSS(HOVER_CSS)
    mountBox('zzh')
    const opts = { ...BASE, burst: true }
    await userEvent.hover(mounted)
    expect(mounted.matches(':hover')).toBe(true)
    const r1 = await snapdom(mounted, opts)
    expect(hits(await r1.toCanvas(), RED)).toBeGreaterThan(1000)

    await userEvent.unhover(mounted)
    expect(mounted.matches(':hover')).toBe(false)
    const r2 = await snapdom(mounted, opts)
    expect(r2).not.toBe(r1)
    expect(hits(await r2.toCanvas(), RED)).toBe(0)
  })

  it('invalidates a captured sibling styled by an outside :hover trigger', async () => {
    mountCSS('.zz-trigger{display:block;width:40px;height:20px}.zz-hover-sibling{width:240px;height:70px;background:rgb(0,0,255)}.zz-trigger:hover ~ .zz-hover-sibling{background:rgb(255,0,0)}')
    mounted = document.createElement('div')
    mounted.innerHTML = '<button class="zz-trigger">H</button><div class="zz-hover-sibling"></div>'
    document.body.appendChild(mounted)
    const trigger = mounted.firstElementChild
    const target = mounted.lastElementChild
    await snapdom(target, BASE)

    await userEvent.hover(trigger)
    expect(trigger.matches(':hover')).toBe(true)
    const automatic = await snapdom.toCanvas(target, BASE)
    const full = await snapdom.toCanvas(target, { ...BASE, burst: false })
    expect(hits(full, RED)).toBeGreaterThan(10_000)
    expect(hits(automatic, RED)).toBeGreaterThan(10_000)
  })

  it('invalidates :hover sibling styles inside an open shadow root', async () => {
    mounted = document.createElement('div')
    document.body.appendChild(mounted)
    const shadow = mounted.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>.trigger{display:block;width:40px;height:20px}.target{width:240px;height:70px;background:rgb(0,0,255)}.trigger:hover ~ .target{background:rgb(255,0,0)}</style><button class="trigger">H</button><div class="target"></div>'
    const trigger = shadow.querySelector('.trigger')
    await snapdom(mounted, BASE)

    await userEvent.hover(trigger)
    expect(trigger.matches(':hover')).toBe(true)
    const automatic = await snapdom.toCanvas(mounted, BASE)
    const full = await snapdom.toCanvas(mounted, { ...BASE, burst: false })
    expect(hits(full, RED)).toBeGreaterThan(10_000)
    expect(hits(automatic, RED)).toBeGreaterThan(10_000)
  })

  it('invalidates shadow siblings from a retargeted focus interaction', async () => {
    mounted = document.createElement('div')
    document.body.appendChild(mounted)
    const shadow = mounted.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>.target{width:240px;height:70px;background:rgb(0,0,255)}.trigger:focus ~ .target{background:rgb(255,0,0)}</style><button class="trigger">FOCUS</button><div class="target"></div>'
    const trigger = shadow.querySelector('.trigger')
    await snapdom(mounted, BASE)

    trigger.focus()
    expect(shadow.activeElement).toBe(trigger)
    const automatic = await snapdom.toCanvas(mounted, BASE)
    const full = await snapdom.toCanvas(mounted, { ...BASE, burst: false })
    expect(hits(full, RED)).toBeGreaterThan(10_000)
    expect(hits(automatic, RED)).toBeGreaterThan(10_000)
  })
})

describe('a selection that changed between two captures', () => {
  const SEL_CSS = '.zzs{background:rgb(255,255,255)} .zzs::selection{background:rgb(255,0,102)}'

  it('is not served again by the burst memo', async () => {
    mountCSS(SEL_CSS)
    mountBox('zzs')
    const opts = { ...BASE, burst: true, captureSelection: true }
    selectAll(mounted)
    const r1 = await snapdom(mounted, opts)
    expect(hits(await r1.toCanvas(), PINK)).toBeGreaterThan(200)

    window.getSelection().removeAllRanges()
    const r2 = await snapdom(mounted, opts)
    expect(r2).not.toBe(r1)
    expect(hits(await r2.toCanvas(), PINK)).toBe(0)
  })

  it('control: with the memo off the second capture follows the selection', async () => {
    mountCSS(SEL_CSS)
    mountBox('zzs')
    const opts = { ...BASE, burst: false, captureSelection: true }
    selectAll(mounted)
    expect(hits(await snapdom.toCanvas(mounted, opts), PINK)).toBeGreaterThan(200)
    window.getSelection().removeAllRanges()
    expect(hits(await snapdom.toCanvas(mounted, opts), PINK)).toBe(0)
  })
})

describe(':active captured by preCapture', () => {
  it('does not leak the pressed frame into the click capture', async () => {
    mountCSS('.zz-active{color:white;background:rgb(0,0,255)}.zz-active:active{background:rgb(255,0,0)}')
    mounted = document.createElement('button')
    mounted.className = 'zz-active'
    mounted.style.cssText = 'width:240px;height:70px;border:0'
    mounted.textContent = 'PRESS'
    document.body.appendChild(mounted)
    snapdom.preCapture()

    // Learn this button → element mapping the same way an app's pointerdown handler does.
    mounted.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    await snapdom(mounted, BASE)

    // The known-control prefetch now starts on the real pointerdown while :active is true.
    let activeDuringDown = false
    mounted.addEventListener('pointerdown', () => { activeDuringDown = mounted.matches(':active') })
    await userEvent.click(mounted)
    await new Promise((r) => setTimeout(r, 80))
    expect(mounted.matches(':active')).toBe(false)

    const automatic = await snapdom.toCanvas(mounted, BASE)
    const full = await snapdom.toCanvas(mounted, { ...BASE, burst: false })
    expect(hits(full, [0, 0, 255])).toBeGreaterThan(5000)
    expect(hits(automatic, [0, 0, 255])).toBeGreaterThan(5000)
    expect(hits(automatic, RED)).toBe(0)
    // Chromium/WebKit expose :active during pointerdown; Firefox's automation currently
    // does not. The final frame assertion remains valid in all three engines.
    expect(activeDuringDown || /Firefox/.test(navigator.userAgent)).toBe(true)
  })
})
