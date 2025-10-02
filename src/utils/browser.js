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

/**
 * Detecta Safari real + Safari en iOS WebView (UIWebView/WKWebView) + variantes WeChat.
 */
export function isSafari() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''

  // Safari "clásico" (descarta Chrome y Android)
  const isSafariUA = /^((?!chrome|android).)*safari/i.test(ua)

  // UIWebView/WKWebView en iOS: AppleWebKit + Mobile pero sin "Safari"
  const isUIWebView = /AppleWebKit/i.test(ua) && /Mobile/i.test(ua) && !/Safari/i.test(ua)

  // Apps tipo WeChat que embeben WebKit
  const isWeChatUA = /(MicroMessenger|wxwork|WeCom|WindowsWechat|MacWechat)/i.test(ua)

  return isSafariUA || isUIWebView || isWeChatUA
}
