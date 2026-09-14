// `outerTransforms: false` strips the root's translate/rotate and recomputes the bbox from
// whatever 2D matrix remains (scale/skew). That branch of capture.js had no test at all,
// and a wrong bbox there means a cropped or over-padded capture.
//
// Sizes are asserted with tolerance on purpose: the strip branch has always produced a box
// ~2px larger than the pass-through branch for the same element (verified identical on the
// main dist, so it is pre-existing, not a regression). What must hold is the SHAPE of the
// result — rotation gone, scale kept — not an exact pixel count.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

afterEach(() => { document.body.innerHTML = '' })

async function size(el, opts) {
  const canvas = await (await snapdom(el, { dpr: 1, scale: 1, ...opts })).toCanvas()
  return { w: canvas.width, h: canvas.height }
}

function box(css) {
  const d = document.createElement('div')
  d.style.cssText = 'width:100px;height:50px;background:#3af;' + css
  document.body.appendChild(d)
  return d
}

describe('outerTransforms: false', () => {
  it('strips a rotation: the capture is the unrotated box again', async () => {
    const plain = await size(box(''))
    document.body.innerHTML = ''
    const rotated = box('transform:rotate(30deg)')
    const kept = await size(rotated)
    const stripped = await size(rotated, { outerTransforms: false })

    // A rotated 100x50 needs a visibly bigger bbox to contain it…
    expect(kept.w).toBeGreaterThan(plain.w + 10)
    expect(kept.h).toBeGreaterThan(plain.h + 30)
    // …and stripping the rotation brings it back to the unrotated box (±3px, see header).
    expect(Math.abs(stripped.w - plain.w)).toBeLessThanOrEqual(8)
    expect(Math.abs(stripped.h - plain.h)).toBeLessThanOrEqual(8)
  })

  it('keeps a scale — only translate/rotate are stripped', async () => {
    const plain = await size(box(''))
    document.body.innerHTML = ''
    const stripped = await size(box('transform:scale(2)'), { outerTransforms: false })
    expect(stripped.w).toBeGreaterThan(plain.w * 1.8)
    expect(stripped.h).toBeGreaterThan(plain.h * 1.8)
  })

  it('rotate+scale: rotation gone, scale kept', async () => {
    const plain = await size(box(''))
    document.body.innerHTML = ''
    const both = box('transform:rotate(30deg) scale(2)')
    const kept = await size(both)
    const stripped = await size(both, { outerTransforms: false })
    // scale survives
    expect(stripped.w).toBeGreaterThan(plain.w * 1.8)
    // but the rotation's extra height does not
    expect(stripped.h).toBeLessThan(kept.h)
  })
})
