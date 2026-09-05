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
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('export queue deadlock')), 1500))
  const blobs = await Promise.race([Promise.all([result.toGif({ frames: 2, fps: 100 }), result.toGif({ frames: 1 })]), timeout])
  expect(blobs.every(blob => blob instanceof Blob && blob.type === 'image/gif')).toBe(true)
  expect(recapture).toHaveBeenCalledTimes(3)
  expect(events).toEqual(['before:gif', 'after:gif', 'done', 'before:gif', 'after:gif'])
})
