// Where the per-capture data: URL is decoded (imported from @frostin/snapdom).
//
// A browser keeps a resource-cache entry for every unique image URL for the lifetime of the
// document that fetched it, and nothing can evict one. A loop of captures mints a fresh
// multi-megabyte data: URL per frame, so the renderer grows by that much per frame, for good.
// Decoding inside a throwaway iframe makes those resources die with its document, and the
// frame is recycled on a byte budget.
import { describe, it, expect, afterEach } from 'vitest'
import { toCanvas } from '../src/exporters/toCanvas.js'

const decodeFrames = () => [...document.querySelectorAll('iframe[data-snapdom-internal]')]

/** An SVG data URL of roughly `bytes` length that still decodes to a 4x4 red square. */
function bulkySvg(bytes) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">' +
    `<rect width="4" height="4" fill="rgb(255,0,0)"/><!--${'p'.repeat(Math.max(0, bytes))}--></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

afterEach(() => { document.body.innerHTML = '' })

describe('toCanvas — decode host', () => {
  it('decodes in a hidden throwaway iframe and reuses it across captures', async () => {
    await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    const frames = decodeFrames()
    expect(frames.length).toBe(1)
    const frame = frames[0]
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.style.visibility).toBe('hidden')

    const documentBefore = frame.contentDocument
    await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    expect(decodeFrames()).toEqual([frame])
    expect(frame.contentDocument).toBe(documentBefore)
  })

  it('still produces a readable, untainted canvas', async () => {
    const canvas = await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    // getImageData throws on a tainted canvas, which is the trap the blob: alternative fell
    // into: Chromium taints a canvas that drew a foreignObject SVG fetched from a blob URL.
    const data = canvas.getContext('2d').getImageData(1, 1, 1, 1).data
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })

  it('recycles the frame once the decoded bytes pass the budget', async () => {
    await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    const first = decodeFrames()[0]
    expect(first.isConnected).toBe(true)

    // 24MB budget: nine passes of ~3MB each cross it.
    for (let i = 0; i < 9; i++) await toCanvas(bulkySvg(3 * 1024 * 1024), { scale: 1, dpr: 1 })

    expect(first.isConnected).toBe(false)
    const current = decodeFrames()
    expect(current.length).toBe(1)
    expect(current[0]).not.toBe(first)
  })

  it('keeps decoding correctly after a recycle', async () => {
    for (let i = 0; i < 9; i++) await toCanvas(bulkySvg(3 * 1024 * 1024), { scale: 1, dpr: 1 })
    const canvas = await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    const data = canvas.getContext('2d').getImageData(1, 1, 1, 1).data
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })

  it('does not recycle while another decode is in flight', async () => {
    await toCanvas(bulkySvg(64), { scale: 1, dpr: 1 })
    const frame = decodeFrames()[0]
    // Two heavy decodes started together: the one that finishes first must not tear the
    // document down under the other, whose bitmap lives in it.
    const both = await Promise.all([
      toCanvas(bulkySvg(13 * 1024 * 1024), { scale: 1, dpr: 1 }),
      toCanvas(bulkySvg(13 * 1024 * 1024), { scale: 1, dpr: 1 }),
    ])
    for (const canvas of both) {
      const data = canvas.getContext('2d').getImageData(1, 1, 1, 1).data
      expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
    }
    expect(frame.isConnected).toBe(true) // the budget was only crossed by the pair itself
  })

  it('retires a tiled decode host after drawing, including its concurrent ordinary export', async () => {
    const options = { scale: 1, dpr: 1 }
    const single = await toCanvas(bulkySvg(64), { ...options, __releaseDecodeFrame: true })
    expect([...single.getContext('2d').getImageData(1, 1, 1, 1).data]).toEqual([255, 0, 0, 255])
    expect(decodeFrames()).toHaveLength(0)

    await toCanvas(bulkySvg(64), options)
    const shared = decodeFrames()[0]
    const blue = bulkySvg(3 * 1024 * 1024).replace(encodeURIComponent('rgb(255,0,0)'), encodeURIComponent('rgb(0,0,255)'))
    // Start both before awaiting either: retiring the small image must leave the larger
    // in-flight decode's document alive through its final draw.
    const both = await Promise.all([
      toCanvas(bulkySvg(64), { ...options, __releaseDecodeFrame: true }),
      toCanvas(blue, options),
    ])
    expect([...both[0].getContext('2d').getImageData(1, 1, 1, 1).data]).toEqual([255, 0, 0, 255])
    expect([...both[1].getContext('2d').getImageData(1, 1, 1, 1).data]).toEqual([0, 0, 255, 255])
    expect(shared.isConnected).toBe(false)
    expect(decodeFrames()).toHaveLength(0)
  })

  it('retires failed decodes without leaving the next export guarded or unreadable', async () => {
    const options = { scale: 1, dpr: 1, __releaseDecodeFrame: true }
    const malformed = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><broken></svg>')
    await expect(toCanvas(malformed, options)).rejects.toThrow()
    expect(decodeFrames()).toHaveLength(0)

    const canvas = await toCanvas(bulkySvg(64), options)
    expect([...canvas.getContext('2d').getImageData(1, 1, 1, 1).data]).toEqual([255, 0, 0, 255])
    // A leaked in-flight guard would allow drawing but prevent this retirement forever.
    expect(decodeFrames()).toHaveLength(0)
  })
})
