// #536: WebP stores each side in 14 bits, so no encoder writes past 16383px. On a capture
// taller or wider than that, Chromium's toDataURL returned "data:," (a zero-byte download, a
// toWebp() <img> that failed to load), and toBlob handed back a 16383px blob with the rest of
// the capture cut off. The canvas limits themselves are pinned by exporters.rasterLimit.test.js.
import { describe, test, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index'
import { WEBP_MAX_SIDE } from '../src/exporters/toCanvas.js'

let mounted = []
afterEach(() => {
  for (const el of mounted) el.remove()
  mounted = []
  vi.restoreAllMocks()
})

function mount(width, height) {
  const el = document.createElement('div')
  el.style.cssText = `width:${width}px;height:${height}px;background:linear-gradient(#000,#fff)`
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function size(blob) {
  const bitmap = await createImageBitmap(blob)
  const out = [bitmap.width, bitmap.height]
  bitmap.close()
  return out
}

// WebKit has no WebP encoder (toBlob answers image/png) and caps the canvas at 16384px,
// which clamps these scenes before the WebP limit can.
const encodesWebp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')

describe.skipIf(!encodesWebp)('WebP export past the 16383px side limit', () => {
  test('toWebp() scales a tall capture down to an image that loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await snapdom(mount(80, 17300), { dpr: 1, burst: false })
    const img = await result.toWebp()
    expect(img.src.startsWith('data:image/webp')).toBe(true)
    // Aspect ratio is kept: 80 * 16383 / 17300 = 75.7.
    expect([img.naturalWidth, img.naturalHeight]).toEqual([75, WEBP_MAX_SIDE])
    expect(warn.mock.calls.some(([msg]) => /WebP/.test(String(msg)))).toBe(true)
  }, 60_000)

  test('download({ format: "webp" }) writes a non-empty file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let href = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { href = this.href })
    const result = await snapdom(mount(80, 17300), { dpr: 1, burst: false })
    await result.download({ format: 'webp' })
    expect(href.startsWith('data:image/webp;base64,')).toBe(true)
  }, 60_000)

  test('toBlob({ format: "webp" }) keeps the whole capture instead of cutting it off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await snapdom(mount(17300, 80), { dpr: 1, burst: false })
    const blob = await result.toBlob({ format: 'webp' })
    expect(blob.type).toBe('image/webp')
    expect(await size(blob)).toEqual([WEBP_MAX_SIDE, 75])
  }, 60_000)

  test('the limit is counted in device pixels, so dpr 2 can cross it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await snapdom(mount(80, 9000), { dpr: 1, burst: false })
    // 9000 CSS px at dpr 2 is 18000 device px: 160 * 16383 / 18000 = 145.6.
    expect(await size(await result.toBlob({ format: 'webp', dpr: 2 }))).toEqual([145, WEBP_MAX_SIDE])
  }, 60_000)

  test('the deprecated type alias is clamped too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await snapdom(mount(17300, 80), { dpr: 1, burst: false })
    const blob = await result.toBlob({ type: 'webp' })
    expect(blob.type).toBe('image/webp')
    expect(await size(blob)).toEqual([WEBP_MAX_SIDE, 75])
  }, 60_000)

  test('a WebP within the limit, other formats and toCanvas() are not resized', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await snapdom(mount(80, 17300), { dpr: 1, burst: false })
    expect(await size(await result.toBlob({ format: 'jpeg' }))).toEqual([80, 17300])
    const canvas = await result.toCanvas()
    expect([canvas.width, canvas.height]).toEqual([80, 17300])
    const fits = await snapdom(mount(80, WEBP_MAX_SIDE), { dpr: 1, burst: false })
    expect(await size(await fits.toBlob({ format: 'webp' }))).toEqual([80, WEBP_MAX_SIDE])
    expect(warn).not.toHaveBeenCalled()
  }, 60_000)
})
