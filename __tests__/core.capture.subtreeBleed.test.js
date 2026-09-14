// outerShadows: 'subtree' — the capture is widened by what DESCENDANTS paint past the root's
// box (imported from @frostin/snapdom, element-mirror; the cases are theirs, the assertions are
// rewritten against v3's geometry contract, where contentX/contentY carry what their
// originX/originY did and w0/h0 are the element's own box).
//
// Measured on v3 before the change: a child's 6px ring against the root's edge was cloned and
// then clipped away by the viewBox, 0 ring pixels in the raster.
import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/index.js'

async function rasterize(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { ctx, w: c.width, h: c.height }
}

/** Whether anything at all is painted in a column of the raster. */
function columnPainted(ctx, w, h, x) {
  const d = ctx.getImageData(x, 0, 1, h).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true
  return false
}

/**
 * A capture is the root's box, so a child's outer ink against the root's edge
 * falls outside it. `outerShadows: 'subtree'` is what widens the capture by as
 * much ink as there is.
 */
function fixture(childStyle, hostStyle = '') {
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;top:120px;left:120px;width:200px;height:60px;${hostStyle}`
  const child = document.createElement('div')
  // Flush against the host's left edge and as tall as it, so ink on those sides
  // has nowhere to go but outside the captured box.
  child.style.cssText = `width:100px;height:60px;background:rgb(0,128,0);${childStyle}`
  host.appendChild(child)
  document.body.appendChild(host)
  return { host, child }
}

describe('subtree bleed', () => {
  it('leaves a capture alone when nothing paints outside', async () => {
    const { host } = fixture('')
    try {
      const plain = await snapdom(host)
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      expect(subtree.meta.vbW).toBe(plain.meta.vbW)
      expect(subtree.meta.vbH).toBe(plain.meta.vbH)
      expect(subtree.meta.contentX).toBe(0)
      expect(subtree.meta.contentY).toBe(0)
    } finally {
      host.remove()
    }
  })

  it("widens for a child's ring, on the sides it reaches past", async () => {
    const { host } = fixture('box-shadow:0 0 0 4px rgb(255,0,0);')
    try {
      const plain = await snapdom(host)
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      // Left, top and bottom are flush, so the ring lands outside on three
      // sides; the right edge is 100px inside the host and needs no room.
      expect(subtree.meta.vbW - plain.meta.vbW).toBe(4)
      expect(subtree.meta.vbH - plain.meta.vbH).toBe(8)
      // The element's own box moved in by as much as was added before it, and is still
      // its own size: contentX/contentY are where it starts inside the widened viewBox.
      expect(subtree.meta.contentX).toBe(4)
      expect(subtree.meta.contentY).toBe(4)
      expect(subtree.meta.w0).toBe(200)
      expect(subtree.meta.h0).toBe(60)
    } finally {
      host.remove()
    }
  })

  it('paints the ring it made room for', async () => {
    const { host } = fixture('box-shadow:0 0 0 4px rgb(255,0,0);')
    try {
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      const { ctx, w, h } = await rasterize(subtree.url)
      // The ring is the leftmost thing in the raster now, where a capture of the
      // box alone would have had nothing at all.
      expect(columnPainted(ctx, w, h, 0)).toBe(true)
      expect(columnPainted(ctx, w, h, 1)).toBe(true)
    } finally {
      host.remove()
    }
  })

  it('does not widen for ink the root clips away', async () => {
    const { host } = fixture(
      'box-shadow:0 0 0 4px rgb(255,0,0);',
      'overflow:hidden;'
    )
    try {
      const plain = await snapdom(host)
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      expect(subtree.meta.vbW).toBe(plain.meta.vbW)
      expect(subtree.meta.vbH).toBe(plain.meta.vbH)
    } finally {
      host.remove()
    }
  })

  it('bounds ink by an ancestor that clips it, not by the effect', async () => {
    const host = document.createElement('div')
    host.style.cssText =
      'position:absolute;top:120px;left:120px;width:200px;height:60px;'
    // The scroller starts 10px in, so a 40px shadow inside it can reach 10px
    // past the host at most.
    const scroller = document.createElement('div')
    scroller.style.cssText =
      'margin-left:10px;width:100px;height:60px;overflow:hidden;'
    const child = document.createElement('div')
    child.style.cssText =
      'width:100px;height:60px;background:rgb(0,128,0);box-shadow:0 0 0 40px rgb(255,0,0);'
    scroller.appendChild(child)
    host.appendChild(scroller)
    document.body.appendChild(host)

    try {
      const plain = await snapdom(host)
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      expect(subtree.meta.vbW).toBe(plain.meta.vbW)
      expect(subtree.meta.contentX).toBe(0)
    } finally {
      host.remove()
    }
  })

  it('reports the same geometry for a scaled root, in the root\'s own pixels', async () => {
    const outer = document.createElement('div')
    outer.style.cssText = 'position:absolute;top:120px;left:120px;transform:scale(2);'
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;height:60px;'
    const child = document.createElement('div')
    child.style.cssText =
      'width:100px;height:60px;background:rgb(0,128,0);box-shadow:0 0 0 4px rgb(255,0,0);'
    host.appendChild(child)
    outer.appendChild(host)
    document.body.appendChild(outer)

    try {
      // An ancestor's scale doubles the ink measured on the page; the capture is
      // in the root's own pixels, so the room made must be the ring's own 4px.
      const subtree = await snapdom(host, { outerShadows: 'subtree' })
      expect(subtree.meta.contentX).toBe(4)
      expect(subtree.meta.contentY).toBe(4)
    } finally {
      outer.remove()
    }
  })
})
