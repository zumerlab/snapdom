/**
 * Engine detection by user agent, plus the one frame wait the canvas readback needs.
 *
 * Every caller keys a workaround on the rendering ENGINE, not the browser brand: svg-as-image
 * paint timing, native form controls, the download path. So `isSafari` answers true for any
 * WebKit shell on iOS, in-app webviews included, and not only for Safari itself.
 * @module browser
 */

/**
 * Awaits the next animation frame, but never blocks the capture forever.
 *
 * Canvas readback rides on rAF: a WebGL/WebGPU canvas with `preserveDrawingBuffer: false` clears
 * its drawing buffer as soon as the frame composites, so `toDataURL` must run inside the frame,
 * right after the app's own render callback (#480). The catch is that rAF only fires while the
 * document is being rendered: in a background tab, a minimized window or an occluded view the
 * callback never arrives and the capture promise hangs for good (#486). Nothing composites in
 * that state either, so skipping the wait costs nothing — and the timeout backstop covers the
 * engines/states that keep the document "visible" while starving rAF anyway.
 *
 * @param {number} [timeout=1000] ms after which the wait resolves on its own
 * @returns {Promise<void>}
 */
export function nextFrame(timeout = 1000) {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    try { requestAnimationFrame(done) } catch { done(); return }
    setTimeout(done, timeout)
  })
}

/**
 * True on iPhone, iPad and iPod. iPadOS 13+ reports itself as Macintosh and is told apart by
 * its touch points.
 * @returns {boolean}
 */
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  if (navigator.userAgentData) {
    return navigator.userAgentData.platform === 'iOS'
  }

  // Usually iOS comes up with iPad/iPod/iPhone as USA
  const ua = navigator.userAgent || ''
  const isAppleMobile = /iPhone|iPad|iPod/.test(ua)
  // Check if touch is enabled
  const isIPadOS = navigator.maxTouchPoints > 2 && /Macintosh/.test(ua)
  return isAppleMobile || isIPadOS
}

/**
 * True for Safari and for every other WebKit shell on iOS: UIWebView and WKWebView inside
 * apps, WeChat and WeCom, the Baidu apps (#295). Chrome and Firefox on iOS are excluded by the
 * first check and included again by the last one, on purpose: they render with WebKit too.
 * @returns {boolean}
 */
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

/**
 * True for Firefox on desktop and Android, the Gecko engine. Firefox on iOS (fxios) renders
 * with WebKit, so it answers false here and true to `isSafari`, and the Gecko-only
 * workarounds gated on this (background-clip:text, checkbox rendering) never run on it.
 * @returns {boolean}
 */
export function isFirefox() {
  if (typeof navigator === 'undefined') return false
  return (navigator.userAgent || '').toLowerCase().includes('firefox')
}
