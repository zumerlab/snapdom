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
