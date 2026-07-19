// __tests__/api.snapdom.more.test.js – snapdom.js extra coverage
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.mocked(browser.isSafari).mockReturnValue(false)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('snapdom – error handling', () => {
  it('throws when element is null', async () => {
    await expect(snapdom(null)).rejects.toThrow(/cannot be null/)
  })
  it('throws when element is undefined', async () => {
    await expect(snapdom(undefined)).rejects.toThrow(/cannot be null/)
  })
})

describe('snapdom – result.to()', () => {
  it('throws for unknown export type', async () => {
    const el = document.createElement('div')
    el.textContent = 'x'
    document.body.appendChild(el)
    const result = await snapdom(el)
    await expect(result.to('unknownType')).rejects.toThrow(/Unknown export type/)
  })
})

describe('snapdom – result helpers', () => {
  it('result has all expected export methods', async () => {
    const el = document.createElement('div')
    el.style.width = '50px'
    el.style.height = '50px'
    el.textContent = 'x'
    document.body.appendChild(el)
    const result = await snapdom(el)
    expect(typeof result.toPng).toBe('function')
    expect(typeof result.toSvg).toBe('function')
    expect(typeof result.toCanvas).toBe('function')
    expect(typeof result.download).toBe('function')
  })
})

describe('snapdom – Safari warmup path', () => {
  it('runs the warmup once when isSafari and the element has background/canvas', async () => {
    vi.mocked(browser.isSafari).mockReturnValue(true)

    const el = document.createElement('div')
    el.style.width = '40px'
    el.style.height = '40px'
    el.style.backgroundImage =
      'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")'
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    el.appendChild(canvas)
    document.body.appendChild(el)

    // safariWarmupAttempts: 1 keeps the (real) warmup capture to a single pass.
    const result = await snapdom(el, { safariWarmupAttempts: 1 })
    expect(typeof result.url).toBe('string')
    expect(result.url.startsWith('data:image/svg+xml')).toBe(true)
  })
})
