// __tests__/exporter.download.test.js – download.js coverage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'
import { download } from '../src/exporters/download.js'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBCd4/7mEAAAAASUVORK5CYII='
const DATA_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(browser.isIOS).mockReturnValue(false)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('download', () => {
  it('triggers download for PNG format', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await download(DATA_PNG, { format: 'png', filename: 'test.png' })
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('normalizes jpg to jpeg for filename', async () => {
    const appended = []
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      appended.push(el)
      return el
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await download(DATA_PNG, { format: 'jpg', filename: 'out.jpg' })
    const a = appended.find(el => el.tagName === 'A')
    expect(a?.download).toMatch(/\.jpe?g$/i)
    appendSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('downloads SVG format', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await download(DATA_SVG, { format: 'svg', filename: 'out.svg' })
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('uses default filename when not provided', async () => {
    const appended = []
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      appended.push(el)
      return el
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await download(DATA_PNG, { format: 'png' })
    const a = appended.find(el => el.tagName === 'A')
    expect(a?.download).toMatch(/snapdom\.png/)
    appendSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('uses Web Share API on iOS when share is available', async () => {
    const shareFn = vi.fn().mockResolvedValue()
    const canShareFn = vi.fn(() => true)
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: canShareFn, configurable: true })
    vi.mocked(browser.isIOS).mockReturnValue(true)
    await download(DATA_SVG, { format: 'svg', filename: 'share.svg' })
    expect(shareFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'share.svg' }))
  })

  it('uses Web Share for raster on iOS', async () => {
    const shareFn = vi.fn().mockResolvedValue()
    const canShareFn = vi.fn(() => true)
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: canShareFn, configurable: true })
    vi.mocked(browser.isIOS).mockReturnValue(true)
    await download(DATA_PNG, { format: 'png', filename: 'share.png' })
    expect(shareFn).toHaveBeenCalled()
  })
})
