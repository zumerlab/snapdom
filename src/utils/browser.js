/**
 * Creates a promise that resolves after the specified delay
 * @param {number} [ms=0] - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */

export function idle(fn, { fast = false } = {}) {
  if (fast) return fn()
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 50 })
  } else {
    setTimeout(fn, 1)
  }
}

export function isSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const uaLower = ua.toLowerCase()

  // Safari desktop/mobile UA, excluding Chrome iOS, Firefox iOS and Android browsers
  const isSafariUA =
    uaLower.includes('safari') &&
    !uaLower.includes('chrome') &&
    !uaLower.includes('crios') &&   // Chrome on iOS
    !uaLower.includes('fxios') &&   // Firefox on iOS
    !uaLower.includes('android')

  // Generic WebKit-based engines (UIWebView / WKWebView)
  const isWebKit = /applewebkit/i.test(ua)
  const isMobile = /mobile/i.test(ua)
  const missingSafariToken = !/safari/i.test(ua)

  // iOS UIWebView or WKWebView inside apps (in-app browsers)
  const isUIWebView = isWebKit && isMobile && missingSafariToken

  // WeChat / WeCom embedded browsers on iOS
  const isWeChatUA =
    /(micromessenger|wxwork|wecom|windowswechat|macwechat)/i.test(ua)

  // Baidu app browsers on iOS (BaiduBoxApp, BaiduBrowser, etc.)
  const isBaiduUA =
    /(baiduboxapp|baidubrowser|baidusearch|baiduboxlite)/i.test(uaLower)

  // On iOS, all browsers use WebKit as the rendering engine (WKWebView)
  // If the device is iOS and uses WebKit, treat it as Safari-equivalent
  const isIOSWebKit =
    /ipad|iphone|ipod/.test(uaLower) && isWebKit

  return isSafariUA || isUIWebView || isWeChatUA || isBaiduUA || isIOSWebKit
}
