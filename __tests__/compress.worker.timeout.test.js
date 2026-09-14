// A worker job that never posts back used to hang the capture forever: only `onerror` drained
// `_pending`, and a silently wedged worker never fires it. These tests pin the per-job timeout
// and, on the other side, that a prompt answer leaves no timer behind.
//
// Deliberately its own file with NO top-level import of compress.js: its `_worker` latch
// initialises against the real Worker before the stub lands, and the tests then silently
// exercise the real worker path (verified).
import { describe, it, expect, afterEach, vi } from 'vitest'

function bigPhoto(w, h, seed = 1) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`)
  g.addColorStop(1, `hsl(${(seed * 47 + 120) % 360} 80% 35%)`)
  x.fillStyle = g; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 200; i++) {
    x.beginPath(); x.arc((i * 97 + seed * 13) % w, (i * 53) % h, ((i * 11) % 60) + 5, 0, Math.PI * 2)
    x.fillStyle = `hsla(${(i * 17) % 360} 90% 70% / .35)`; x.fill()
  }
  return c.toDataURL('image/png')
}

/** Decoded size + the centre pixel of a data URL, so assertions are about pixels that exist
 *  and not about the payload string. */
async function inspect(dataURL) {
  const img = new Image()
  img.src = dataURL
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  c.getContext('2d').drawImage(img, 0, 0)
  const p = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data
  return { w: img.naturalWidth, h: img.naturalHeight, px: [p[0], p[1], p[2], p[3]] }
}

// `vi.resetModules()` does not re-evaluate here (verified: the second test inherited the first
// test's latched `_worker` and took its Worker stub), so each case imports compress.js under a
// unique URL to get a genuinely fresh `_worker` latch.
let instance = 0
const freshCompress = () => import(/* @vite-ignore */ `../src/modules/compress.js?case=${++instance}`)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compress worker job lifecycle', () => {
  it('a worker that never answers times out into the sync path', async () => {
    const src = bigPhoto(1200, 900, 11)
    const before = await inspect(src)

    // Accepts the job and goes silent: no message, no error. The old code waited forever.
    class SilentWorker {
      postMessage() { }
      terminate() { }
    }
    vi.stubGlobal('Worker', SilentWorker)
    vi.stubGlobal('OffscreenCanvas', function () { }) // only `typeof` is checked, keeps the path deterministic

    // Import BEFORE faking timers (the browser module loader needs real ones) but after the
    // stub, since compress latches its worker on first use, not on import.
    const { downsampleDataURL } = await freshCompress()
    vi.useFakeTimers()
    const pending = downsampleDataURL(src, 200, 150)
    await vi.advanceTimersByTimeAsync(6000)
    const out = await pending

    expect(typeof out).toBe('string')
    expect(out.length).toBeLessThan(src.length)

    // The fallback must produce a real downsampled image, not a blank or a stub.
    const after = await inspect(out)
    expect(after.w).toBeLessThan(before.w)
    expect(after.w).toBe(200) // 1200 × (200/1200) × RES_FACTOR(1) = the visible width
    expect(after.px[3]).toBe(255)
    for (let i = 0; i < 3; i++) expect(Math.abs(after.px[i] - before.px[i])).toBeLessThan(24)
  })

  it('a prompt answer leaves no timer pending', async () => {
    const src = bigPhoto(1200, 900, 12)
    const answer = 'data:image/png;base64,iVBORw0KGgo='

    class FastWorker {
      postMessage(msg) { Promise.resolve().then(() => this.onmessage({ data: { id: msg.id, url: answer } })) }
      terminate() { }
    }
    vi.stubGlobal('Worker', FastWorker)
    vi.stubGlobal('OffscreenCanvas', function () { })

    const { downsampleDataURL } = await freshCompress()

    // Every timer armed during the call, minus every one cleared: a prompt answer must leave
    // this empty, otherwise each compressed image arms a 5s timer that nothing cancels.
    const live = new Set()
    const realSet = globalThis.setTimeout.bind(globalThis)
    const realClear = globalThis.clearTimeout.bind(globalThis)
    vi.stubGlobal('setTimeout', (fn, ms) => { const t = realSet(fn, ms); live.add(t); return t })
    vi.stubGlobal('clearTimeout', (t) => { live.delete(t); return realClear(t) })
    const out = await downsampleDataURL(src, 200, 150)

    expect(out).toBe(answer) // worker answer used as-is, no fallback ran
    expect([...live]).toEqual([])
  })

  it('revokes the worker blob URL, including when construction is blocked', async () => {
    const src = bigPhoto(1200, 900, 13)
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    // CSP-blocked blob workers throw right here, which is exactly when the URL would leak.
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked by CSP') } })
    vi.stubGlobal('OffscreenCanvas', function () { })

    const { downsampleDataURL } = await freshCompress()
    const out = await downsampleDataURL(src, 200, 150)

    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(create.mock.results[0].value)
    expect(typeof out).toBe('string') // and the sync path still delivered
  })
})
