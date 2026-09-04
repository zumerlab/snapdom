// Two interactions that produce no mutation record and that the invalidation wiring does not
// cover, reproduced with pixels rather than read off the code: a hover that moved between two
// captures (styles.js keeps :hover off the epoch on purpose, and burst.js has no row for it),
// and a selection that changed under captureSelection (nothing listens to selectionchange).
// Both drive the REAL pointer / Selection, so green means the frame followed the interaction
// and red means a memo served the previous one. The control at the end runs the selection
// case with the memo off, to pin the staleness on the memo and not on the pipeline.
//
// 2026-09-04: the two hover cases are FIXED and run as plain `it` (invalidateHoverChanges in
// styles.js stamps what the :hover chain changed, once per capture; burst.js compares the same
// chain before serving). The selection case is still open and stays `it.fails`. Original note:
// PAUSED 2026-09-04: the three defects are real and unfixed, so they are marked `it.fails`
// to keep the suite green. The agreed fix is a per-capture question, not listeners: diff the
// hover chain (root.querySelectorAll(':hover') + ancestors, 18 µs on the 500-row table) against
// the previous capture and stamp what changed; compare a selection signature when serving the
// memo under captureSelection. When it lands, these go red: drop the `.fails`.
import { describe, it, expect, afterEach } from 'vitest'
import { userEvent } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'

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
})

describe('a selection that changed between two captures', () => {
  const SEL_CSS = '.zzs{background:rgb(255,255,255)} .zzs::selection{background:rgb(255,0,102)}'

  it.fails('is not served again by the burst memo', async () => {
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
