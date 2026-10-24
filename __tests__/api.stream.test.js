import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const roots = []
const streams = []
afterEach(() => {
  streams.splice(0).forEach(s => s.stop())
  roots.splice(0).forEach(r => r.remove())
})

function grid(cardCss = 'background:#1e293b') {
  const root = document.createElement('div')
  root.style.cssText = 'width:640px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;background:#0f172a;font:14px/1.4 monospace;color:#e2e8f0'
  for (let i = 0; i < 24; i++) {
    const card = document.createElement('div')
    card.style.cssText = `${cardCss};border-radius:8px;padding:8px;height:60px;box-shadow:0 2px 6px #000a`
    card.innerHTML = `<b style="color:#38bdf8">Card ${i}</b><div class="v">${i * 11}</div>`
    root.append(card)
  }
  document.body.append(root)
  roots.push(root)
  return root
}

function open(root, options = {}) {
  let resolveNext
  const frames = []
  const s = snapdom.stream(root, {
    dpr: 1, embedFonts: false, ...options,
    onFrame: (f) => { frames.push(f); resolveNext?.(f) },
  })
  streams.push(s)
  s.next = () => new Promise(resolve => { resolveNext = resolve })
  s.frames = frames
  return s
}

// What a full capture of the same DOM state paints, at the stream canvas size.
async function reference(root, canvas) {
  const res = await snapdom(root, { dpr: 1, embedFonts: false, outerShadows: false })
  const img = new Image()
  img.src = res.url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c
}

// Pixels whose largest channel difference exceeds a hinting-level tolerance.
function differs(a, b) {
  const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data
  const y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
  let bad = 0
  for (let i = 0; i < x.length; i += 4) {
    const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]), Math.abs(x[i + 3] - y[i + 3]))
    if (d > 32) bad++
  }
  return bad
}

describe('snapdom.stream', () => {
  it('repaints a changed card as a patch that matches a full capture, frame after frame', async () => {
    const root = grid()
    const s = open(root)
    await s.ready
    for (let f = 0; f < 6; f++) {
      const next = s.next()
      root.children[(f * 5) % 24].querySelector('.v').textContent = `changed ${f}`
      const frame = await next
      expect(frame.full, `frame ${f}`).toBe(false)
      expect(frame.rects).toHaveLength(1)
      expect(frame.rects[0].width).toBeLessThan(s.canvas.width / 3)
      expect(differs(s.canvas, await reference(root, s.canvas)), `frame ${f}`).toBe(0)
    }
    expect(s.stats.patch).toBe(6)
  })

  it('patches boxes at fractional offsets, as 1fr columns produce', async () => {
    // White on black: a partly covered edge pixel drawn twice is off by up to 64 levels.
    const root = grid('background:#fff;color:#000')
    root.style.background = '#000'
    root.style.gridTemplateColumns = 'repeat(5, 1fr)'
    root.style.width = '641px'
    const s = open(root)
    await s.ready
    for (const i of [1, 2, 3, 7]) {
      expect(root.children[i].getBoundingClientRect().left % 1, `card ${i}`).not.toBe(0)
      const next = s.next()
      root.children[i].querySelector('.v').textContent = `fractional ${i}`
      const frame = await next
      expect(frame.full, `card ${i}`).toBe(false)
      expect(differs(s.canvas, await reference(root, s.canvas)), `card ${i}`).toBe(0)
    }
  })

  function cells(gap) {
    const root = document.createElement('div')
    root.style.cssText = 'width:503px;padding:7px;background:#000'
    const grid = document.createElement('div')
    grid.style.cssText = `display:grid;grid-template-columns:repeat(13,1fr);gap:${gap}px;background:#000`
    for (let i = 0; i < 78; i++) {
      const b = document.createElement('b')
      b.style.cssText = 'display:block;height:17px;background:#fff;border-radius:4px'
      grid.append(b)
    }
    root.append(grid)
    document.body.append(root)
    roots.push(root)
    return { root, grid }
  }

  it('repaints just a restyled cell over its solid backdrop, rounded edges included', async () => {
    const { root, grid } = cells(3)
    const s = open(root)
    await s.ready
    for (const i of [1, 5, 40]) {
      const cell = grid.children[i]
      expect(cell.getBoundingClientRect().left % 1, `cell ${i}`).not.toBe(0)
      const next = s.next()
      cell.style.background = '#f43f5e'
      cell.style.borderRadius = '8px'
      const frame = await next
      expect(frame.full, `cell ${i}`).toBe(false)
      expect(frame.rects[0].width, `cell ${i}`).toBeLessThan(cell.getBoundingClientRect().width + 3)
      expect(differs(s.canvas, await reference(root, s.canvas)), `cell ${i}`).toBe(0)
    }
  })

  it('keeps a backdrop fill off a neighbour that shares the edge pixel', async () => {
    const { root, grid } = cells(0)
    const s = open(root)
    await s.ready
    for (const i of [1, 5]) {
      const next = s.next()
      // Padded text: ink that spills past a box edge onto a shared pixel is the one case a
      // patch cannot redraw (the pixel is half the neighbour's); the keyframe heals it.
      grid.children[i].style.padding = '0 3px'
      grid.children[i].style.font = '12px/17px monospace'
      grid.children[i].textContent = 'x'
      const frame = await next
      expect(differs(s.canvas, await reference(root, s.canvas)), `cell ${i} ${frame.reason}`).toBe(0)
    }
  })

  it('patches typing into a field, which leaves no mutation record', async () => {
    const root = grid()
    const input = document.createElement('input')
    input.style.cssText = 'width:120px;background:#fff;color:#000;border:0'
    root.children[3].append(input)
    const s = open(root)
    await s.ready
    const next = s.next()
    input.value = 'typed text'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const frame = await next
    expect(frame.full).toBe(false)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('falls back to a full frame when the change moves geometry', async () => {
    // Shrinking one card leaves its row, and so the root, the same size: only the card's
    // own rect tells that the old pixels below it are now stale.
    const root = grid()
    const s = open(root)
    await s.ready
    const next = s.next()
    root.children[2].style.height = '30px'
    const frame = await next
    expect(frame.full).toBe(true)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('repaints the enclosing box when a change resizes a box inside it', async () => {
    const root = grid()
    const track = document.createElement('div')
    track.style.cssText = 'background:#334155;height:8px;margin-top:4px'
    track.innerHTML = '<div style="background:#22d3ee;height:8px;width:20%"></div>'
    root.children[6].append(track)
    // Whole-pixel lines put the bar on whole pixels, so the bar itself is the first host.
    root.children[6].style.lineHeight = '20px'
    const s = open(root)
    await s.ready
    for (const width of ['70%', '35%']) {
      const next = s.next()
      track.firstChild.style.width = width
      const frame = await next
      expect(frame.full, width).toBe(false)
      expect(frame.rects[0].height, width).toBe(8)
      expect(differs(s.canvas, await reference(root, s.canvas)), width).toBe(0)
    }
  })

  it('falls back when the changed box is transparent, since old pixels would show through', async () => {
    const root = grid('background:transparent')
    const s = open(root)
    await s.ready
    const next = s.next()
    root.children[1].querySelector('.v').textContent = ''
    expect((await next).full).toBe(true)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('falls back when a positioned element paints over the changed box', async () => {
    const root = grid()
    root.style.position = 'relative'
    const badge = document.createElement('div')
    badge.style.cssText = 'position:absolute;left:20px;top:20px;width:60px;height:30px;background:#f43f5e'
    root.append(badge)
    const s = open(root)
    await s.ready
    const next = s.next()
    root.children[0].querySelector('.v').textContent = 'under the badge'
    expect((await next).full).toBe(true)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('patches above an ancestor with opacity instead of below it', async () => {
    const root = grid()
    const card = root.children[5]
    const inner = document.createElement('div')
    inner.style.cssText = 'background:#fbbf24;color:#000;opacity:.5'
    inner.innerHTML = '<span>faded</span>'
    // First child: on whole pixels, so only the effect rule can keep the patch above it.
    card.prepend(inner)
    const s = open(root)
    await s.ready
    const next = s.next()
    inner.firstChild.textContent = 'still faded'
    const frame = await next
    expect(frame.full).toBe(false)
    expect(frame.rects[0].width).toBeGreaterThan(card.getBoundingClientRect().width - 2)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('emits nothing while the element is unchanged', async () => {
    const root = grid()
    const s = open(root)
    await s.ready
    const before = s.frames.length
    await new Promise(r => setTimeout(r, 200))
    // A window resize repaints on purpose (media queries change no rect); the runner resizes
    // its iframes under parallel load, so only frames with another reason count.
    const extra = s.frames.slice(before).filter(f => f.reason !== 'resize')
    expect(extra.length, extra.map(f => f.reason).join(', ')).toBe(0)
    expect(s.stats.skipped).toBeGreaterThan(0)
  })
})
