// excludeMode:'remove' recomputes the output height from the span of the children that
// survived. That is right for a content-sized box and wrong for every other kind: an
// author-set height does not shrink in the live DOM when a child is removed, so clamping to
// the kept span threw away the rest of the visible box.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function card(extraCss) {
  const el = document.createElement('div')
  el.style.cssText = `width:120px;background:#888;${extraCss}`
  el.innerHTML = '<p style="margin:0;height:18px">Short</p><button class="x" style="height:18px">X</button>'
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

const OPTS = { exclude: ['.x'], excludeMode: 'remove', embedFonts: false, scale: 1, dpr: 1 }

describe("excludeMode:'remove' output height", () => {
  it('keeps an author-set height', async () => {
    const el = card('height:200px')
    const canvas = await snapdom.toCanvas(el, OPTS)
    expect(canvas.height).toBeGreaterThanOrEqual(190)
  })

  it('keeps an author-set min-height', async () => {
    const el = card('min-height:150px')
    const canvas = await snapdom.toCanvas(el, OPTS)
    expect(canvas.height).toBeGreaterThanOrEqual(140)
  })

  it('still shrinks a content-sized box to what survived', async () => {
    const el = card('')  // height:auto — the case the clamp exists for
    const full = el.offsetHeight
    const canvas = await snapdom.toCanvas(el, OPTS)
    expect(canvas.height).toBeLessThan(full)
  })
})
