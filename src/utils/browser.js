/**
 * Engine detection by user agent, the one frame wait the canvas readback needs, and the time
 * slicing behind `fast: false | 'auto'`.
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

/** One slice of a yielding capture: about a frame, so input and paint get a turn per frame. */
const SLICE_MS = 16
/** How long the experimental `fast: 'auto'` runs before its first pause: an ordinary capture
 *  ends inside it. Not the default because a capture burst does not watch cannot be redone
 *  when the page changes during a pause. */
const AUTO_GRACE_MS = 40

/**
 * Create the time slicer for `fast: false` and `fast: 'auto'` (#503).
 *
 * The clone reads every node's computed style in one walk. On the #503 ArcGIS table that walk
 * was a single 480 ms task, so the page could neither paint nor take input until it ended. The
 * walks ask `due()` at node boundaries and `await pause()` once a slice is spent, which hands
 * the event loop one task. `false` slices from the start; `'auto'` first runs AUTO_GRACE_MS.
 * v2's `fast: false` sent every node through requestIdleCallback and cost that table 45% cold
 * and 4x warm. Pausing only when a slice is spent (the clone and pseudo walks plus the phase
 * boundaries) kept the first capture at 455-469 ms against 476, with no task over 50 ms and
 * the page painting every 17-33 ms, raster identical.
 * Pinned by __tests__/core.capture.fast.test.js.
 * @param {boolean|'auto'} fast
 * @returns {{due: () => boolean, pause: () => Promise<void>, yielded: boolean}|null} null for `fast: true`
 */
export function createSlicer(fast) {
  if (fast !== false && fast !== 'auto') return null
  let until = performance.now() + (fast === 'auto' ? AUTO_GRACE_MS : SLICE_MS)
  let wait = null
  const slicer = {
    yielded: false,
    due: () => performance.now() >= until,
    // One shared wait: every walk that finds the slice spent resumes in the order it paused.
    pause: () => wait || (wait = new Promise((resolve) => {
      const resume = () => {
        wait = null
        slicer.yielded = true
        until = performance.now() + SLICE_MS
        resolve()
      }
      // A message is a plain task: rendering takes its turn in between. scheduler.yield()
      // resumes AHEAD of rendering, and on the #503 table the page went 83-117 ms between
      // frames with it against 17-33 ms with a message. A nested setTimeout clamps to 4 ms.
      const channel = new MessageChannel()
      channel.port1.onmessage = resume
      channel.port2.postMessage(0)
    })),
  }
  return slicer
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
