import { it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { isAutoBurstSafe } from '../src/core/burst.js'

const roots = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) root.remove() })

const svgURL = (color, extra = '') => 'data:image/svg+xml;base64,' + btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><desc>${'x'.repeat(160 * 1024)}</desc><rect width="32" height="32" fill="${color}"/>${extra}</svg>`
)

it('reuses inline-image classification without serializing payloads on memo hits', async () => {
  const root = document.createElement('div')
  roots.push(root)
  root.style.cssText = 'width:384px;height:32px;display:flex'
  const url = svgURL('red')
  for (let i = 0; i < 12; i++) {
    const img = new Image(32, 32)
    img.src = url
    root.append(img)
  }
  document.body.append(root)
  await Promise.all([...root.children].map(img => img.decode()))
  const options = { embedFonts: false, dpr: 1 }
  const first = await snapdom(root, options)
  const atobSpy = vi.spyOn(window, 'atob')
  const stringify = vi.spyOn(JSON, 'stringify')
  expect(await snapdom(root, options)).toBe(first)
  expect(atobSpy).not.toHaveBeenCalled()
  expect(stringify.mock.calls.some(([value]) => Array.isArray(value) && value.includes(url))).toBe(false)
  vi.restoreAllMocks()

  root.firstElementChild.src = svgURL('blue')
  await root.firstElementChild.decode()
  const changed = await snapdom(root, options)
  expect(changed).not.toBe(first)
  const canvas = await changed.toCanvas()
  expect([...canvas.getContext('2d').getImageData(16, 16, 1, 1).data]).toEqual([0, 0, 255, 255])
})

it('reclassifies a changed inline style before an animated source can reuse a memo', () => {
  const root = document.createElement('div')
  roots.push(root)
  // Keep the animation marker in the inspected head rather than behind the large desc.
  const staticURL = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const animatedURL = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></svg>')
  root.style.backgroundImage = `url("${staticURL}")`
  expect(isAutoBurstSafe(root)).toBe(true)
  root.style.backgroundImage = `url("${animatedURL}")`
  expect(isAutoBurstSafe(root)).toBe(false)
  root.style.backgroundImage = ''
  expect(isAutoBurstSafe(root)).toBe(true)
})
