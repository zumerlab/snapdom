// cloneVideo's frame: an opaque frame goes out as JPEG (a decoded video frame has no codec to
// preserve).
//
// Proven to fail: 'image/png' in cloneVideo's mime turns the codec test red.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

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
    ctx.fillRect(0, 0, W, H)
    await new Promise((r) => requestAnimationFrame(r))
  }
  rec.stop()
  await stopped
  return URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }))
}

function blueShare(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let blue = 0
  for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 180 && d[i] < 80 && d[i + 1] < 80) blue++
  return blue / (d.length / 4)
}

const once = (el, ev) => new Promise((resolve, reject) => {
  el.addEventListener(ev, resolve, { once: true })
  el.addEventListener('error', () => reject(new Error(`video error ${el.error?.code}`)), { once: true })
  setTimeout(() => reject(new Error(`timed out waiting for ${ev}`)), 8000)
})

// Playwright's WebKit answers a jpeg request with png bytes; the codec assertion follows
// what the engine can actually encode.
const jpegOk = document.createElement('canvas').toDataURL('image/jpeg').startsWith('data:image/jpeg')

describe('cloneVideo — frame codec', () => {
  let clipUrl
  let wrap

  beforeAll(async () => { clipUrl = await recordBlueClip() })
  afterEach(() => { wrap?.remove(); vi.restoreAllMocks() })

  async function mountPlaying() {
    wrap = document.createElement('div')
    const video = document.createElement('video')
    video.muted = true
    video.width = W
    video.height = H
    video.preload = 'auto'
    video.src = clipUrl
    wrap.appendChild(video)
    document.body.appendChild(wrap)
    await once(video, 'loadeddata')
    video.currentTime = 0.1
    await once(video, 'seeked')
    return video
  }

  it('an opaque frame is JPEG and paints the frame', async () => {
    const video = await mountPlaying()
    let src = null
    const res = await snapdom(video, {
      burst: false,
      plugins: [{ name: 'spy', afterClone(ctx) { src = ctx.clone.getAttribute('src') || '' } }],
    })
    expect(src.startsWith(jpegOk ? 'data:image/jpeg' : 'data:image/')).toBe(true)
    expect(blueShare(await res.toCanvas({ scale: 1, dpr: 1 }))).toBeGreaterThan(0.9)
  }, 20_000)
})
