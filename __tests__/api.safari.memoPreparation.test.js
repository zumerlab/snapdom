import { it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { isSafari } from '../src/utils/browser.js'

const nodes = []
afterEach(() => { vi.restoreAllMocks(); for (const node of nodes.splice(0)) node.remove() })

it.skipIf(!isSafari())('waits for fonts on new captures but not on a valid memo hit', async () => {
  const sheet = document.createElement('style')
  sheet.textContent = '@font-face{font-family:SnapdomMemoInter;src:url("/__tests__/fixtures/fonts/inter-400.woff2")}'
  document.head.append(sheet)
  const root = document.createElement('div')
  root.style.cssText = 'width:200px;height:40px;font:20px SnapdomMemoInter;background:white;color:black'
  root.textContent = 'First frame'
  document.body.append(root)
  nodes.push(sheet, root)
  await document.fonts.load('20px SnapdomMemoInter', root.textContent)
  await document.fonts.ready
  const options = { embedFonts: 'auto', dpr: 1 }
  const frames = vi.spyOn(window, 'requestAnimationFrame')
  const first = await snapdom(root, options)
  expect(frames.mock.calls.length).toBeGreaterThanOrEqual(2)
  frames.mockClear()
  expect(await snapdom(root, options)).toBe(first)
  expect(frames).not.toHaveBeenCalled()

  root.textContent = 'Changed frame'
  const changed = await snapdom(root, options)
  expect(changed).not.toBe(first)
  expect(frames.mock.calls.length).toBeGreaterThanOrEqual(2)
  // Font loading and CSSOM invalidation still force the real capture path.
  frames.mockClear()
  expect(await snapdom(root, { ...options, invalidate: true })).not.toBe(changed)
  expect(frames.mock.calls.length).toBeGreaterThanOrEqual(2)
})
