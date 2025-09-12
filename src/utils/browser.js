/**
 * Creates a promise that resolves after the specified delay
 * @param {number} [ms=0] - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */

export function idle(fn, { fast = false } = {}) {
  if (fast) return fn();
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 50 });
  } else {
    setTimeout(fn, 1);
  }
}

export function isSafari() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const isSafariUA = /^((?!chrome|android).)*safari/i.test(ua); // original
  const isWeChatUA = /(MicroMessenger|wxwork|WeCom|WindowsWechat|MacWechat)/i.test(ua); // agregado
  return isSafariUA || isWeChatUA;
}
