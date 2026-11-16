/**
 * Engine detection, the canvas readback's frame wait, the shared font-set wait, the time
 * slicing behind `fast: false | 'auto'`, and the task turn between chained captures.
 * Workarounds key on the rendering ENGINE, not the brand, so `isSafari` is true for every
 * WebKit shell on iOS, in-app webviews included.
 * @module browser
 */

/**
 * Awaits the next animation frame, but never blocks the capture forever.
 *
 * A WebGL canvas with `preserveDrawingBuffer: false` must be read inside the frame (#480), but
 * rAF never fires in a background tab and the capture hung (#486). A hidden document skips the
 * wait (nothing composites either); the timeout covers "visible" states that starve rAF.
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
 * Wait until `doc.fonts.ready` settles or no face in the set is loading, whichever is first.
 *
 * WebKit can leave the set "loading" with no face loading, and `ready` never settles: in
 * Safari 27.0.1 the jant#174 scene hung every capture past 20 s, and takes 129 to 154 ms with
 * this. Not a timer race on `ready`: a capture reads it more than once, about 2 s on an iPhone.
 * Pinned by __tests__/utils.fontsSettled.test.js.
 * @param {Document} [doc=document]
 * @returns {Promise<void>}
 */
export async function fontsSettled(doc = document) {
  const fonts = doc.fonts
  let settled = false
  const ready = fonts.ready.then(() => { settled = true }, () => { settled = true })
  while (!settled && fonts.status === 'loading') {
    const loading = [...fonts].filter((f) => f.status === 'loading')
    if (!loading.length) return
    await Promise.race([ready, Promise.allSettled(loading.map((f) => f.loaded))])
  }
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
 * On the #503 ArcGIS table the style walk was one 480 ms task; sliced, the first capture takes
 * 455-469 ms against 476 with no task over 50 ms. Pause only once a slice is spent, not
 * requestIdleCallback per node as v2 did: that cost the table 45% cold and 4x warm.
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
    pause: () => wait || (wait = nextTask().then(() => {
      wait = null
      slicer.yielded = true
      until = performance.now() + SLICE_MS
    })),
  }
  return slicer
}

/** Resolve in a new task. A message is a plain task, so rendering takes its turn in between.
 *  scheduler.yield() resumes AHEAD of rendering, and on the #503 table the page went 83-117 ms
 *  between frames with it against 17-33 ms with a message. A nested setTimeout clamps to 4 ms. */
function nextTask() {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(0)
  })
}

/** When the running task first asked yieldWhenTaskSpent, or -1 once a task boundary passed.
 *  Module scope on purpose: the task belongs to the page, and every capture shares it. */
let taskStart = -1

/**
 * Hand the event loop one task when the running task has already spent a slice on captures.
 *
 * Chained captures (burst.js's queue, an awaited loop) ran as one task: sixteen Zumly clip
 * windows were one 90 ms task, now 20 to 26 ms at most. Not a task before EVERY capture: in
 * Playwright's WebKit 200 memo hits went from 6 to 170-308 ms.
 * Pinned by __tests__/core.burst.taskTurn.test.js.
 * @returns {Promise<void>}
 */
export async function yieldWhenTaskSpent() {
  if (taskStart >= 0 && performance.now() - taskStart > SLICE_MS) await nextTask()
  if (taskStart < 0) {
    taskStart = performance.now()
    nextTask().then(() => { taskStart = -1 })
  }
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

/** The last user agent `isSafari` and `isFirefox` answered for, and their answers. */
let safariUA, safari, firefoxUA, firefox

/**
 * True for Safari and every WebKit shell on iOS (in-app webviews, WeChat, Baidu, #295),
 * Chrome and Firefox on iOS included on purpose. Kept per UA string, not latched (tests swap
 * it): asked per node, it cost the 1,506-node table 0.67 ms of a 43 ms capture.
 * Pinned by __tests__/utils.browser.more.test.js.
 * @returns {boolean}
 */
export function isSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (ua === safariUA) return safari
  safariUA = ua
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

  return (safari = isSafariUA || isUIWebView || isWeChatUA || isBaiduUA || isIOSWebKit)
}

/**
 * True for Firefox on desktop and Android, the Gecko engine. Firefox on iOS (fxios) renders
 * with WebKit, so it answers false here and true to `isSafari`, and the Gecko-only
 * workarounds gated on this (background-clip:text, checkbox rendering) never run on it.
 * Kept per user agent string like `isSafari`: the snapshot and background passes ask per node.
 * @returns {boolean}
 */
export function isFirefox() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (ua === firefoxUA) return firefox
  firefoxUA = ua
  return (firefox = ua.toLowerCase().includes('firefox'))
}
