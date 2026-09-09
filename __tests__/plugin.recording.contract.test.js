import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { gifExport } from '../packages/plugins/gif-export.js'
import { videoExport } from '../packages/plugins/video-export.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearPlugins(); document.querySelectorAll('[data-recording-test]').forEach(el => el.remove()) })

function source() {
  const el = document.createElement('div')
  el.dataset.recordingTest = ''
  el.style.cssText = 'width:32px;height:16px;background:white'
  document.body.appendChild(el)
  return el
}

async function gifCanvas(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas
  } finally { URL.revokeObjectURL(url) }
}

const pixel = (canvas, x = 8, y = 8) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]

// For solid-color fixtures, each local palette's first entry identifies its frame.
// Browser decoding above separately verifies the encoded stream is a drawable GIF.
async function gifFrameColors(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const colors = []
  let offset = 13
  const skipBlocks = () => { while (bytes[offset]) offset += bytes[offset] + 1; offset++ }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) break
    if (marker === 0x21) { offset++; skipBlocks(); continue }
    if (marker !== 0x2c) throw new Error('unexpected GIF block')
    offset += 8
    const packed = bytes[offset++]
    colors.push([...bytes.slice(offset, offset + 3)])
    offset += 3 * (1 << ((packed & 7) + 1))
    offset++ // minimum LZW code size
    skipBlocks()
  }
  return colors
}

// Real capture/raster work, with only the platform recorder replaced so failure and
// cleanup paths are deterministic on engines with different installed codecs.
function recorder({ requestFrame = true, error, constructorError, actualType = 'video/webm', onFrame } = {}) {
  const streams = [], instances = [], painted = []
  vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(function (fps) {
    const canvas = this
    const track = { stop: vi.fn() }
    if (requestFrame) track.requestFrame = () => {
      painted.push({ width: canvas.width, height: canvas.height, color: pixel(canvas) })
      onFrame?.(painted.length)
    }
    const stream = { canvas, fps, getVideoTracks: () => [track], getTracks: () => [track] }
    streams.push(stream)
    return stream
  })
  class Recorder {
    static isTypeSupported() { return false }
    constructor(stream) {
      if (constructorError) throw constructorError
      this.stream = stream; this.mimeType = actualType; this.state = 'inactive'; instances.push(this)
    }
    start() { this.state = 'recording'; if (error) queueMicrotask(() => this.onerror?.({ error })) }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['frame'], { type: actualType }) })
      queueMicrotask(() => this.onstop?.())
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder)
  return { streams, instances, painted }
}

describe('recording plugins preserve v3 capture contracts', () => {
  it('honors the GIF factory scale despite normalized export defaults', async () => {
    const result = await snapdom(source(), { dpr: 1, plugins: [gifExport({ scale: 2 })] })
    const canvas = await gifCanvas(await result.toGif({ frames: 1 }))
    expect([canvas.width, canvas.height]).toEqual([64, 32])
  })

  it.each(['selector', 'predicate'])('GIF recaptures retain %s exclusions and dpr/width', async mode => {
    const el = source()
    el.innerHTML = '<div class="private" style="width:16px;height:16px;background:red"></div>'
    const exclude = mode === 'selector' ? '.private' : node => node.classList.contains('private')
    const result = await snapdom(el, { exclude, width: 64, dpr: 2, plugins: [gifExport()] })
    const canvas = await gifCanvas(await result.toGif({ frames: 1 }))
    expect([canvas.width, canvas.height]).toEqual([128, 64])
    expect(pixel(canvas)).toEqual([255, 255, 255, 255])
  })

  // A blue sibling after the filtered box: 'hide' keeps a white spacer at (8,8), 'remove'
  // shifts the sibling into that spot, so a recapture that drops filterMode goes red.
  it.each(['hide', 'remove'])('GIF and video recaptures retain filter with filterMode %s', async filterMode => {
    const rec = recorder()
    const el = source()
    el.style.display = 'flex'
    el.innerHTML = '<div class="secret" style="width:16px;height:16px;background:red"></div><div style="width:16px;height:16px;background:blue"></div>'
    const filter = node => !node.matches('.secret')
    const expected = filterMode === 'remove' ? [0, 0, 255, 255] : [255, 255, 255, 255]
    const result = await snapdom(el, { dpr: 1, filter, filterMode, plugins: [gifExport(), videoExport()] })
    expect(pixel(await gifCanvas(await result.toGif({ frames: 2, fps: 100 })))).toEqual(expected)
    await result.toMp4({ frames: 2, fps: 100 })
    expect(rec.painted.map(frame => frame.color)).toEqual([expected, expected])
  })

  it('GIF recaptures retain local capture plugins', async () => {
    const tint = { name: 'recording-tint', afterClone(ctx) { ctx.clone.style.backgroundColor = 'lime' } }
    const result = await snapdom(source(), { dpr: 1, plugins: [gifExport(), tint] })
    expect(pixel(await gifCanvas(await result.toGif({ frames: 1 })))).toEqual([0, 255, 0, 255])
  })

  it('video retains factory scale, capture exclusions and plugins', async () => {
    const rec = recorder()
    const el = source()
    el.innerHTML = '<div class="private" style="width:16px;height:16px;background:red"></div>'
    const tint = { name: 'recording-tint', afterClone(ctx) { ctx.clone.style.backgroundColor = 'lime' } }
    const result = await snapdom(el, { dpr: 1, exclude: node => node.classList.contains('private'), plugins: [videoExport({ scale: 2 }), tint] })
    await result.toMp4({ frames: 1, fps: 100 })
    expect(rec.painted).toEqual([{ width: 64, height: 32, color: [0, 255, 0, 255] }])
  })

  it('video stops stream tracks after success and reports the actual recorder MIME', async () => {
    const rec = recorder({ actualType: 'video/mp4' })
    const result = await snapdom(source(), { plugins: [videoExport()] })
    const blob = await result.toMp4({ frames: 1, fps: 100 })
    expect(blob.type).toBe('video/mp4')
    expect(rec.streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1)
  })

  it('video stops tracks when recorder construction throws', async () => {
    const failure = new Error('unsupported recorder configuration')
    const rec = recorder({ constructorError: failure })
    const result = await snapdom(source(), { plugins: [videoExport()] })
    await expect(result.toMp4({ frames: 1, fps: 100 })).rejects.toBe(failure)
    expect(rec.streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1)
  })

  it('video rejects recorder errors and releases every track', async () => {
    const failure = new Error('encoder failure')
    const rec = recorder({ error: failure })
    const result = await snapdom(source(), { plugins: [videoExport()] })
    await expect(result.toMp4({ frames: 1, fps: 100 })).rejects.toBe(failure)
    expect(rec.streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1)
  })

  it('video uses a timed stream where requestFrame is unavailable', async () => {
    const rec = recorder({ requestFrame: false })
    const result = await snapdom(source(), { plugins: [videoExport()] })
    await result.toMp4({ frames: 1, fps: 25 })
    expect(rec.streams.at(-1).fps).toBe(25)
    for (const stream of rec.streams) expect(stream.getTracks()[0].stop).toHaveBeenCalledTimes(1)
  })

  it('GIF inherits capture scale and honors an explicit scale:1 override of the factory', async () => {
    const inherited = await snapdom(source(), { scale: 2, dpr: 1, plugins: [gifExport()] })
    expect((await gifCanvas(await inherited.toGif({ frames: 1 }))).width).toBe(64)
    const overridden = await snapdom(source(), { dpr: 1, plugins: [gifExport({ scale: 2 })] })
    expect((await gifCanvas(await overridden.toGif({ frames: 1, scale: 1 }))).width).toBe(32)
  })

  it('records the current live state when GIF/video export starts after capture', async () => {
    const rec = recorder()
    const el = source()
    el.style.backgroundColor = 'red'
    const result = await snapdom(el, { dpr: 1, plugins: [gifExport(), videoExport()] })
    el.style.backgroundColor = 'blue'
    expect(pixel(await gifCanvas(await result.toGif({ frames: 1 })))).toEqual([0, 0, 255, 255])
    await result.toMp4({ frames: 1, fps: 100 })
    expect(rec.painted[0].color).toEqual([0, 0, 255, 255])
  })

  it('video keeps its initial stage size while capturing later DOM changes', async () => {
    const el = source()
    el.style.backgroundColor = 'red'
    const rec = recorder({ onFrame(index) {
      if (index === 1) { el.style.width = '64px'; el.style.height = '32px'; el.style.backgroundColor = 'blue' }
    } })
    const result = await snapdom(el, { dpr: 1, plugins: [videoExport()] })
    await result.toMp4({ frames: 2, fps: 100 })
    expect(rec.painted).toEqual([
      { width: 32, height: 16, color: [255, 0, 0, 255] },
      { width: 32, height: 16, color: [0, 0, 255, 255] }
    ])
  })

  it('GIF captures changed later frames and keeps the first frame dimensions after resize', async () => {
    const el = source()
    el.style.backgroundColor = 'red'
    const result = await snapdom(el, { dpr: 1, plugins: [gifExport()] })
    const original = CanvasRenderingContext2D.prototype.getImageData
    let extracted = 0
    vi.spyOn(CanvasRenderingContext2D.prototype, 'getImageData').mockImplementation(function (...args) {
      const data = original.apply(this, args)
      if (this.canvas.width === 32 && this.canvas.height === 16 && args[2] === 32 && args[3] === 16 && ++extracted === 1) {
        el.style.backgroundColor = 'blue'; el.style.width = '64px'; el.style.height = '32px'
      }
      return data
    })
    const blob = await result.toGif({ frames: 2, fps: 100 })
    expect(await gifFrameColors(blob)).toEqual([[255, 0, 0], [0, 0, 255]])
    const canvas = await gifCanvas(blob)
    expect([canvas.width, canvas.height]).toEqual([32, 16])
  })

  it('a shared GIF plugin keeps concurrent recordings of different elements separate', async () => {
    const plugin = gifExport()
    const a = source(), b = source()
    a.style.backgroundColor = 'red'; b.style.backgroundColor = 'blue'
    const first = await snapdom(a, { dpr: 1, plugins: [plugin] })
    const second = await snapdom(b, { dpr: 1, plugins: [plugin] })
    const blobs = await Promise.all([first.toGif({ frames: 2, fps: 100 }), second.toGif({ frames: 2, fps: 100 })])
    expect(await gifFrameColors(blobs[0])).toEqual([[255, 0, 0], [255, 0, 0]])
    expect(await gifFrameColors(blobs[1])).toEqual([[0, 0, 255], [0, 0, 255]])
  })

  it('video stops its recorder and tracks when a later capture fails, then allows retry', async () => {
    let fail = false
    const failure = new Error('frame capture failed')
    const rec = recorder({ onFrame(index) { if (index === 1) fail = true } })
    const probe = { name: 'recording-failure', beforeClone() { if (fail) throw failure } }
    const result = await snapdom(source(), { dpr: 1, plugins: [videoExport(), probe] })
    await expect(result.toMp4({ frames: 2, fps: 100 })).rejects.toBe(failure)
    expect(rec.instances[0].state).toBe('inactive')
    expect(rec.streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1)
    fail = false
    expect(await result.toMp4({ frames: 1, fps: 100 })).toBeInstanceOf(Blob)
    expect(rec.streams[1].getTracks()[0].stop).toHaveBeenCalledTimes(1)
  })

  it.each(['gif', 'video'])('%s rejects invalid frame/timing inputs before recording', async type => {
    const rec = recorder()
    const result = await snapdom(source(), { plugins: [type === 'gif' ? gifExport() : videoExport()] })
    const run = options => type === 'gif' ? result.toGif(options) : result.toMp4(options)
    for (const options of [{ frames: NaN }, { frames: 1.5 }, { frames: 1, fps: 0 }, { frames: 1, scale: Infinity }, { duration: NaN }]) {
      await expect(run(options)).rejects.toBeInstanceOf(RangeError)
    }
    expect(rec.streams).toHaveLength(0)
  })

  it('uses plugin filename defaults and explicit filename/download overrides', async () => {
    recorder({ actualType: 'video/mp4' })
    const names = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); URL.revokeObjectURL(this.href) })
    const result = await snapdom(source(), { plugins: [gifExport({ filename: 'animation.gif' }), videoExport({ filename: 'animation.mp4' })] })
    await result.toGif({ frames: 1, download: true })
    await result.toGif({ frames: 1, download: true, filename: 'explicit.gif' })
    await result.toGif({ frames: 1, download: 'direct.gif' })
    await result.toMp4({ frames: 1, fps: 100, download: true })
    await result.toMp4({ frames: 1, fps: 100, download: true, filename: 'explicit.mp4' })
    expect(names).toEqual(['animation.gif', 'explicit.gif', 'direct.gif', 'animation.mp4', 'explicit.mp4'])
  })
})
