// <video> → <img>: the screen shows the poster until playback first starts or a seek (the
// HTML "show poster flag"), whatever frames are already decoded. drawImage of such a video
// paints frame 0 on Chromium/Firefox and nothing on WebKit, and a blank canvas still
// serializes to a valid PNG — so every arm here asserts on pixels, never on the src.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isSafari } from '../src/utils/browser.js'

const W = 160
const H = 90

function solid(color) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, W, H)
  return c
}

// A ~300ms all-blue clip, recorded in-browser so the suite needs no fixture and no network.
async function recordBlueClip() {
  const c = solid('rgb(0,0,255)')
  const rec = new MediaRecorder(c.captureStream(30))
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise((r) => { rec.onstop = r })
  rec.start()
  const ctx = c.getContext('2d')
  const t0 = performance.now()
  while (performance.now() - t0 < 300) {
    ctx.fillRect(0, 0, W, H) // captureStream only emits frames when the canvas is drawn to
    await new Promise((r) => requestAnimationFrame(r))
  }
  rec.stop()
  await stopped
  return URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }))
}

function paint(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const n = d.length / 4
  let red = 0
  let blue = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue
    if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) red++
    else if (d[i + 2] > 180 && d[i] < 80 && d[i + 1] < 80) blue++
  }
  return { red: red / n, blue: blue / n }
}

const once = (el, ev) => new Promise((resolve, reject) => {
  el.addEventListener(ev, resolve, { once: true })
  el.addEventListener('error', () => reject(new Error(`video error ${el.error?.code}`)), { once: true })
  setTimeout(() => reject(new Error(`timed out waiting for ${ev}`)), 8000)
})

describe('cloneVideo — poster vs current frame', () => {
  let clipUrl
  let video

  beforeAll(async () => { clipUrl = await recordBlueClip() })

  afterEach(() => video?.remove())

  function mount({ src } = {}) {
    video = document.createElement('video')
    video.muted = true
    video.width = W
    video.height = H
    video.preload = 'auto'
    video.setAttribute('poster', solid('rgb(255,0,0)').toDataURL())
    if (src) video.src = src
    document.body.appendChild(video)
    return video
  }

  const capture = () => snapdom.toCanvas(video, { burst: false, scale: 1, dpr: 1 })

  it('paints the poster when no frame has loaded', async () => {
    mount()
    expect(video.readyState).toBe(0)
    const { red } = paint(await capture())
    expect(red).toBeGreaterThan(0.9)
  })

  it('paints the poster, not the decoded first frame, until playback starts', async () => {
    mount({ src: clipUrl })
    await once(video, 'loadeddata')
    expect(video.readyState).toBeGreaterThanOrEqual(2)
    const { red, blue } = paint(await capture())
    expect(red).toBeGreaterThan(0.9)
    expect(blue).toBe(0)
  }, 15000)

  it('paints the current frame, not the poster, after a seek', async () => {
    mount({ src: clipUrl })
    await once(video, 'loadeddata')
    video.currentTime = 0.1
    await once(video, 'seeked')
    const { red, blue } = paint(await capture())
    expect(blue).toBeGreaterThan(0.9)
    expect(red).toBe(0)
  }, 15000)

  // Headless WebKit never advances playback (currentTime stays 0 and `played` stays empty
  // after play()), so the rewind cannot be distinguished from a never-played video there.
  it.skipIf(isSafari())('paints the current frame after playing and rewinding to 0', async () => {
    mount({ src: clipUrl })
    await once(video, 'loadeddata')
    await video.play()
    while (!video.played.length) await new Promise((r) => setTimeout(r, 20))
    video.pause()
    video.currentTime = 0
    await once(video, 'seeked')
    expect(video.currentTime).toBe(0)
    const { red, blue } = paint(await capture())
    expect(blue).toBeGreaterThan(0.9)
    expect(red).toBe(0)
  }, 15000)
})
