// __tests__/utils.browser.more.test.js – browser.js extra coverage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isIOS, isSafari, isFirefox } from '../src/utils/browser.js'

function setUA(value) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
}

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

  it('falls back to UA sniffing (iPhone) when userAgentData is absent', () => {
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true })
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')
    expect(isIOS()).toBe(true)
  })

  it('detects iPadOS masquerading as Macintosh via maxTouchPoints', () => {
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true })
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15')
    const origTouch = navigator.maxTouchPoints
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    expect(isIOS()).toBe(true)
    Object.defineProperty(navigator, 'maxTouchPoints', { value: origTouch, configurable: true })
  })
})

describe('isSafari', () => {
  it('returns false when UA contains android', () => {
    setUA('Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0 Safari/537.36')
    expect(isSafari()).toBe(false)
  })

  it('returns true for genuine desktop Safari', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')
    expect(isSafari()).toBe(true)
  })

  it('returns false for desktop Chrome', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')
    expect(isSafari()).toBe(false)
  })

  it('treats an iOS in-app UIWebView (no Safari token) as Safari', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')
    expect(isSafari()).toBe(true)
  })

  it('treats WeChat embedded browser as Safari', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0')
    expect(isSafari()).toBe(true)
  })

  it('treats Baidu app browser as Safari', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 baiduboxapp/13.0')
    expect(isSafari()).toBe(true)
  })
})

describe('isFirefox', () => {
  it('returns true for desktop Firefox', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0')
    expect(isFirefox()).toBe(true)
  })
  it('returns true for Firefox on iOS (fxios)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/120.0 Mobile/15E148 Safari/605.1.15')
    expect(isFirefox()).toBe(true)
  })
  it('returns false for Chrome', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')
    expect(isFirefox()).toBe(false)
  })
})
