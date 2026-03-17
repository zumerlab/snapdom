// __tests__/utils.browser.more.test.js – browser.js extra coverage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isIOS, isSafari } from '../src/utils/browser.js'

let origUserAgent
let origUserAgentData

beforeEach(() => {
  vi.restoreAllMocks()
  origUserAgent = navigator.userAgent
  origUserAgentData = navigator.userAgentData
})

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { value: origUserAgent, configurable: true })
  if (origUserAgentData !== undefined) {
    Object.defineProperty(navigator, 'userAgentData', { value: origUserAgentData, configurable: true })
  } else {
    try { delete navigator.userAgentData } catch { /* some envs */ }
  }
})

describe('isIOS', () => {
  it('returns true when userAgentData.platform is iOS', () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'iOS', getHighEntropyValues: () => Promise.resolve({}) },
      configurable: true
    })
    expect(isIOS()).toBe(true)
  })

  it('returns false when userAgentData.platform is not iOS', () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'macOS', getHighEntropyValues: () => Promise.resolve({}) },
      configurable: true
    })
    expect(isIOS()).toBe(false)
  })

})

describe('isSafari', () => {
  it('returns false when UA contains android', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0 Safari/537.36',
      configurable: true
    })
    expect(isSafari()).toBe(false)
  })
})
