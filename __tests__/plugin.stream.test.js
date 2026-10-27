import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { stream, streamExport, streamTexture, recordCanvas, overlayStage, lowerThird } from '../packages/plugins/stream.js'

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
  // The stream repaints whatever gets pointerover/pointerout, since :hover can change it. The
  // runner moves its iframes under the virtual mouse under parallel load, and a card hovered
  // that way came out as one more 76px patch: two rects, the wrong first rect, or a frame
  // while nothing changed. Nothing here is about the pointer.
  root.style.pointerEvents = 'none'
  let resolveNext
  const frames = []
  const s = stream(root, {
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

describe('stream plugin', () => {
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

  function overlay() {
    const root = document.createElement('div')
    root.style.cssText = 'position:relative;width:480px;height:270px;font:16px/20px monospace;color:#fff'
    root.innerHTML = '<div class="score" style="position:absolute;left:12px;top:12px;background:#0b0f17;padding:6px 10px;border-radius:4px">1 - 0</div>' +
      '<div class="lower" style="position:absolute;left:12px;bottom:40px;display:flex;flex-direction:column">' +
      '<div class="name" style="background:#f8fafc;color:#000;padding:4px 10px;border-radius:4px 4px 0 0">Alex Morgan</div>' +
      '<div style="background:#1d4ed8;padding:4px 10px">Commentator</div></div>' +
      '<div class="badge" style="position:absolute;left:300px;top:12px;width:60px;height:24px;background:#ef4444;border-radius:12px"></div>'
    document.body.append(root)
    roots.push(root)
    return root
  }

  it('repaints an out-of-flow box that resizes over a transparent root, where it was and where it is', async () => {
    const root = overlay()
    const s = open(root)
    await s.ready
    for (const name of ['Alexandra Morgan-Whitfield', 'Al', 'Jamie Rivera']) {
      const next = s.next()
      root.querySelector('.name').textContent = name
      const frame = await next
      expect(frame.full, `${name}: ${frame.reason}`).toBe(false)
      expect(differs(s.canvas, await reference(root, s.canvas)), name).toBe(0)
    }
  })

  it('repaints an out-of-flow box that moves', async () => {
    const root = overlay()
    const s = open(root)
    await s.ready
    for (const left of ['330px', '250px']) {
      const next = s.next()
      root.querySelector('.badge').style.left = left
      const frame = await next
      expect(frame.full, `${left}: ${frame.reason}`).toBe(false)
      expect(differs(s.canvas, await reference(root, s.canvas)), left).toBe(0)
    }
  })

  it('falls back when an out-of-flow box moves onto another box', async () => {
    const root = overlay()
    const s = open(root)
    await s.ready
    const next = s.next()
    root.querySelector('.badge').style.left = '30px'
    expect((await next).full).toBe(true)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
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

  it('repaints the clipping box, not the row it cuts, when the changed row overflows it', async () => {
    // The row is the first opaque ancestor, but the 40px box above it hides half of it: a
    // patch of the whole row painted the hidden half over the root (19200 pixels off).
    const root = document.createElement('div')
    root.style.cssText = 'width:400px;padding:8px;background:#000;font:14px/20px monospace;color:#000'
    root.innerHTML = '<div style="overflow:hidden;height:40px;background:#000">' +
      '<div style="height:80px;background:#fff;padding:4px"><span>row text</span></div></div>' +
      '<div style="height:300px;background:#000"></div>'
    document.body.append(root)
    roots.push(root)
    const s = open(root)
    await s.ready
    const next = s.next()
    root.querySelector('span').textContent = 'changed'
    const frame = await next
    expect(frame.full, frame.reason).toBe(false)
    expect(frame.rects[0].height).toBe(40)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
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

  it('repaints an edit that lands while the first frame is being captured', async () => {
    const root = grid()
    // afterRender runs once the capture has read the DOM: an edit there is after the read
    // and before the frame is done, the window the first frame used to lose.
    let edited = false
    const editOnce = { name: 'edit-once', afterRender() {
      if (edited) return
      edited = true
      root.children[7].querySelector('.v').textContent = 'during the first frame'
    } }
    const s = open(root, { plugins: [editOnce] })
    await s.ready
    expect(edited).toBe(true)
    // A patch, not the keyframe that would heal it 2 s later.
    const frame = await s.next()
    expect(frame.full, frame.reason).toBe(false)
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

  it('streams a capture result through toStream(), with the capture\'s options', async () => {
    const root = grid()
    const res = await snapdom(root, { dpr: 1, embedFonts: false, plugins: [streamExport()] })
    let resolveNext
    const s = await res.toStream({ onFrame: (f) => resolveNext?.(f) })
    streams.push(s)
    await s.ready
    const next = new Promise(r => { resolveNext = r })
    root.children[4].querySelector('.v').textContent = 'via toStream'
    const frame = await next
    expect(frame.full).toBe(false)
    expect(differs(s.canvas, await reference(root, s.canvas))).toBe(0)
  })

  it('keeps a WebGL texture equal to the stream canvas while uploading only the dirty rects', async () => {
    const root = grid()
    const gl = document.createElement('canvas').getContext('webgl2')
    const tex = streamTexture(gl)
    const s = open(root)
    await s.ready
    expect(tex.update(s.frames[0])).toBe(s.canvas.width * s.canvas.height)
    const next = s.next()
    root.children[9].querySelector('.v').textContent = 'on the GPU'
    const frame = await next
    const uploaded = tex.update(frame)
    expect(frame.full).toBe(false)
    expect(uploaded).toBe(frame.rects.reduce((a, r) => a + r.width * r.height, 0))
    expect(uploaded).toBeLessThan(s.canvas.width * s.canvas.height / 10)
    // Read the texture back through a framebuffer and compare it with the canvas.
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.texture, 0)
    const w = s.canvas.width, h = s.canvas.height
    const gpu = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, gpu)
    const cpu = s.canvas.getContext('2d').getImageData(0, 0, w, h).data
    let bad = 0
    for (let i = 0; i < gpu.length; i += 4) if (Math.abs(gpu[i] - cpu[i]) > 2 || Math.abs(gpu[i + 1] - cpu[i + 1]) > 2) bad++
    expect(bad).toBe(0)
  })

  it('reports only rects inside the canvas while a lower third slides out past its edge', async () => {
    // The template hides by sliding to left:-720px; each step patched where the box was and
    // where it is, partly off the canvas, and texSubImage2D rejected those uploads.
    const stage = overlayStage({ width: 960, height: 540 })
    const lower = lowerThird({ name: 'Alex Morgan', role: 'Match commentator' })
    stage.append(lower.el)
    document.body.append(stage)
    roots.push(stage)
    const gl = document.createElement('canvas').getContext('webgl2')
    const tex = streamTexture(gl)
    const s = open(stage)
    await s.ready
    tex.update(s.frames[0])
    lower.hide()
    await new Promise(resolve => setTimeout(resolve, 700))
    const frames = s.frames.slice(1)
    expect(frames.length).toBeGreaterThan(0)
    const { width: w, height: h } = s.canvas
    for (const f of frames) {
      tex.update(f)
      for (const r of f.rects) {
        expect(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= w && r.y + r.height <= h, JSON.stringify(r)).toBe(true)
      }
    }
    expect(gl.getError()).toBe(gl.NO_ERROR)
  })

  it('records the stream canvas to a video blob', async () => {
    if (typeof MediaRecorder === 'undefined' || !['video/mp4', 'video/webm'].some(t => MediaRecorder.isTypeSupported(t))) return
    const root = grid()
    const s = open(root)
    await s.ready
    const rec = recordCanvas(s.canvas, { duration: 400 })
    const tick = setInterval(() => { root.children[0].querySelector('.v').textContent = String(Math.random()) }, 50)
    const blob = await rec.done
    clearInterval(tick)
    expect(blob.type).toMatch(/^video\//)
    expect(blob.size).toBeGreaterThan(0)
  })
})
