import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { stream, overlayStage, scoreboard, lowerThird, ticker, liveBadge } from '../packages/plugins/stream.js'

const stages = []
const streams = []
afterEach(() => {
  streams.splice(0).forEach(s => s.stop())
  stages.splice(0).forEach(s => s.remove())
})

function setup({ visible = true } = {}) {
  const stage = overlayStage({ width: 640, height: 360 })
  const score = scoreboard({ home: 'HOME', away: 'AWAY' })
  const lower = lowerThird({ name: 'Alex Morgan', role: 'Commentator', visible })
  const news = ticker({ items: ['First headline', 'Second headline'], speed: 12 })
  const live = liveBadge()
  stage.append(score.el, live.el, lower.el, news.el)
  document.body.append(stage)
  stages.push(stage)
  // Hold the endless animations still so a frame and a full capture can be compared.
  for (const a of stage.getAnimations({ subtree: true })) a.pause()
  let resolveNext
  const frames = []
  const s = stream(stage, { dpr: 1, embedFonts: false, onFrame: (f) => { frames.push(f); resolveNext?.(f) } })
  streams.push(s)
  s.next = () => new Promise(r => { resolveNext = r })
  s.frames = frames
  return { stage, score, lower, news, s }
}

async function differs(root, canvas) {
  const res = await snapdom(root, { dpr: 1, embedFonts: false, outerShadows: false })
  // toCanvas, not a raw decode: WebKit draws a shadow over a clear stage right only through
  // toCanvas's workaround, which the stream uses there too.
  const img = await res.toCanvas()
  const ref = document.createElement('canvas')
  ref.width = canvas.width
  ref.height = canvas.height
  ref.getContext('2d').drawImage(img, 0, 0, ref.width, ref.height)
  const a = canvas.getContext('2d').getImageData(0, 0, ref.width, ref.height).data
  const b = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data
  let bad = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])) > 32) {
      bad++
      if (bad < 6) (globalThis.__px ||= []).push(`${(i / 4) % ref.width},${Math.floor(i / 4 / ref.width)} a=${[...a.slice(i, i + 4)]} b=${[...b.slice(i, i + 4)]}`)
    }
  }
  return bad
}

// Text that was moving (a lower third sliding, a ticker paused mid-scroll) rasterizes its glyph
// edges a little differently from one render of the same frame to the next, though both svgs
// are byte-identical: after the slide 57 pixels in Chromium and 183 to 437 in WebKit, on the
// paused ticker 178 to 185 in WebKit, all of them glyph outlines, the images the same to the
// eye. Static text is held to 0.
const MOVED_TEXT = 600

const settle = (s, ms = 150) => new Promise((resolve) => {
  let last = s.frames.length
  const check = () => { if (s.frames.length === last) resolve(); else { last = s.frames.length; setTimeout(check, ms) } }
  setTimeout(check, ms)
})

describe('stream overlay templates', () => {
  it('patches a score and a clock tick', async () => {
    const { stage, score, s } = setup()
    await s.ready
    for (const step of [() => score.add('home'), () => score.add('away', 2), () => score.clock.set('12:34.5')]) {
      const next = s.next()
      step()
      const frame = await next
      expect(frame.full, frame.reason).toBe(false)
      globalThis.__px = []
      const r = stage.querySelector('.sdo-score').getBoundingClientRect(), sr = stage.getBoundingClientRect()
      expect(await differs(stage, s.canvas), `${JSON.stringify(frame.rects)} score ${r.left - sr.left},${r.top - sr.top},${r.width},${r.height} | ${globalThis.__px.join(' | ')}`).toBe(0)
    }
  })

  it('patches a lower third whose name changes length', async () => {
    const { stage, lower, s } = setup()
    await s.ready
    for (const name of ['Alexandra Morgan-Whitfield', 'Al']) {
      const next = s.next()
      lower.set({ name })
      const frame = await next
      expect(frame.full, frame.reason).toBe(false)
      expect(await differs(stage, s.canvas)).toBe(0)
    }
  })

  it('slides a lower third out and in with patches only', async () => {
    const { stage, lower, s } = setup()
    await s.ready
    const before = s.frames.length
    lower.hide()
    await new Promise(r => setTimeout(r, 600))
    await settle(s)
    expect(await differs(stage, s.canvas)).toBeLessThanOrEqual(MOVED_TEXT)
    lower.show()
    await new Promise(r => setTimeout(r, 600))
    await settle(s)
    expect(await differs(stage, s.canvas)).toBeLessThanOrEqual(MOVED_TEXT)
    const slide = s.frames.slice(before)
    expect(slide.length).toBeGreaterThan(4)
    expect(slide.filter(f => f.full).map(f => f.reason)).toEqual([])
  })

  it('patches the running ticker without repainting the rest', async () => {
    const { stage, news, s } = setup()
    await s.ready
    const run = news.el.querySelector('.sdo-run').getAnimations()[0]
    run.play()
    await new Promise(r => setTimeout(r, 400))
    run.pause()
    await settle(s)
    const moving = s.frames.slice(1)
    expect(moving.length).toBeGreaterThan(3)
    expect(moving.every(f => !f.full && f.rects.every(r => r.height <= 41))).toBe(true)
    expect(await differs(stage, s.canvas)).toBeLessThanOrEqual(MOVED_TEXT)
  })
})
