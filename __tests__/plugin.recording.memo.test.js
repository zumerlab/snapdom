import { afterEach, expect, it, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'
import { gifExport } from '../packages/plugins/gif-export.js'

// Pin the memo-return edge without depending on core's raw option-signature heuristics:
// only the plugin's recapture import is replaced. Result construction, queues, hooks,
// SVG rasterization and GIF encoding all run through the real current v3 implementation.
const { recapture } = vi.hoisted(() => ({ recapture: vi.fn() }))
vi.mock('@zumer/snapdom', () => ({ snapdom: recapture }))

afterEach(() => { clearPlugins(); vi.restoreAllMocks(); recapture.mockReset(); document.querySelectorAll('[data-recording-test]').forEach(el => el.remove()) })

it.each(['local', 'global'])('a %s plugin handles a memo returning the currently exporting result', async scope => {
  const el = document.createElement('div')
  el.dataset.recordingTest = ''
  el.style.cssText = 'width:32px;height:16px;background:red'
  document.body.appendChild(el)
  const events = []
  const observer = {
    name: 'recording-observer',
    beforeExport(_ctx, { format }) { events.push(`before:${format}`) },
    afterExport(_ctx, { format }) { events.push(`after:${format}`) },
    afterSnap() { events.push('done') }
  }
  const plugins = [gifExport(), observer]
  if (scope === 'global') snapdom.plugins(...plugins)
  const result = await snapdom(el, { dpr: 1, ...(scope === 'local' ? { plugins } : {}) })
  recapture.mockResolvedValue(result)
  // The public toCanvas is queued behind the toGif that is running, so a frame that reaches
  // it waits on itself forever. Fail at that call rather than racing a timer: a fixed 1500 ms
  // budget expired under machine load, and the frames of the timed-out case kept running into
  // the next case's recapture count (3 expected, 5 seen).
  result.toCanvas = () => { throw new Error('gif-export re-entered the occupied export queue') }
  const blobs = await Promise.all([result.toGif({ frames: 2, fps: 100 }), result.toGif({ frames: 1 })])
  expect(blobs.every(blob => blob instanceof Blob && blob.type === 'image/gif')).toBe(true)
  expect(recapture).toHaveBeenCalledTimes(3)
  expect(events).toEqual(['before:gif', 'after:gif', 'done', 'before:gif', 'after:gif'])
})
