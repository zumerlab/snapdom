import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { videoExport } from '../packages/plugins/video-export.js'

describe('videoExport plugin', () => {
  let el

  beforeEach(() => {
    el = document.createElement('div')
    el.style.cssText = 'width:48px;height:32px;background:#222;color:#0f0'
    el.textContent = 'vid'
    document.body.appendChild(el)
  })

  afterEach(() => {
    el.remove()
  })

  it('returns a valid plugin exposing an mp4 export', () => {
    const p = videoExport()
    expect(p.name).toBe('video-export')
    expect(typeof p.defineExports().mp4).toBe('function')
  })

  it('exposes result.toMp4()', async () => {
    const result = await snapdom(el, { plugins: [videoExport()] })
    expect(typeof result.toMp4).toBe('function')
  })

  it('records a non-empty video blob via MediaRecorder', async () => {
    // chromium exposes MediaRecorder + canvas.captureStream
    expect(typeof MediaRecorder).toBe('function')

    const result = await snapdom(el, { plugins: [videoExport()] })
    const blob = await result.toMp4({ frames: 4, fps: 8 })

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type.startsWith('video/')).toBe(true)
    expect(blob.size).toBeGreaterThan(0)
  }, 30000)
})
