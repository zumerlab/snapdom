/**
 * Public entry: `snapdom(el, options)` and its `to*` shortcuts.
 *
 * Owns what happens around a capture (core/capture.js does the capture): option
 * normalization, per-capture plugins, the Safari pre-step, the burst decision, and
 * `buildResult`, the result object with its export queue and hooks. Burst's differential path
 * calls buildResult without captureDOM, so nothing a result needs may live only there.
 * @module api/snapdom
 */
import { captureDOM } from '../core/capture.js'
import { createCaptureSession } from '../core/session.js'
import { isBlankCanvas } from '../core/clone.js'
import { createContext } from '../core/context.js'
import { isSafari, nextFrame, yieldWhenTaskSpent } from '../utils/browser.js'
import { debugWarn } from '../utils/debug.js'
import { registerPlugins, runHook, runAll, attachSessionPlugins, hasImpureRenderPlugins } from '../core/plugins.js'
import { resolveStage, stageReaches, absentArtifactError, DEFAULT_STAGE } from '../core/stages.js'
import { collectFontUsage, ensureFontsReady, fontKeyFamily, documentFontFamilies } from '../modules/fonts.js'
import { invalidateStyleCaches } from '../core/changes.js'
import { captureWithBurst, isAutoBurstSafe, refreshUnwatchedControls } from '../core/burst.js'
import { bindCapture, noteCapture, preCapture } from './preCapture.js'
import { markInternalNode } from '../utils/ownership.js'
import { fileSvgText } from '../utils/helpers.js'
import { restoreCompressedAssets } from '../modules/compress.js'

/**
 * Register global plugins. Returns snapdom, so `snapdom.plugins(p)(el)` reads as one call.
 * @param {...any} defs
 * @returns {typeof snapdom}
 */
export function plugins(...defs) { registerPlugins(...defs); return snapdom }

/**
 * Capture an HTML string: it mounts offscreen in the live document (page CSS and fonts
 * apply), is captured and removed. A single root element is the target, else the wrapper.
 *
 * TRUSTED HTML ONLY. `innerHTML` into the REAL document runs event-handler attributes in
 * this origin. Not a bug to fix: a capture needs real layout. Sanitizing is the caller's job.
 * @param {string} html
 * @param {object} [options] - Same options as snapdom()
 * @returns {Promise<object>} The capture result
 */
async function fromString(html, options) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('[SnapDOM] fromString() needs an HTML string.')
  const mount = document.createElement('div')
  // data-snapdom-internal: mounting/removing must not bump the style epoch.
  markInternalNode(mount)
  mount.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;'
  mount.innerHTML = html
  document.body.appendChild(mount)
  try {
    // One frame so layout (and any already-loaded fonts) settle before measuring. nextFrame,
    // not a bare requestAnimationFrame: an occluded document never fires one and the capture
    // hung here (#486). Pinned by `__tests__/api.fromString.test.js`.
    await nextFrame()
    // Element count alone misses a mixed fragment such as `Hello <strong>world</strong>`.
    // Keep surrounding text; indentation and comments around a sole root still unwrap.
    const hasText = Array.from(mount.childNodes).some(node => node.nodeType === 3 && node.textContent.trim())
    const target = mount.children.length === 1 && !hasText ? mount.firstElementChild : mount
    // The mount dies below; a burst state would only keep it alive in the LRU.
    return await main(target, { ...(options || {}), burst: false })
  } finally {
    mount.remove()
  }
}

// Stamped by the build ('src' from source) so a benchmark page can say which build it
// measured: the live lab loads the published package unless served by `npm run site`.
const version = typeof __SNAPDOM_VERSION__ === 'string' ? __SNAPDOM_VERSION__ : 'src'
export const snapdom = Object.assign(main, { plugins, fromString, version, preCapture })
// preCapture's prefetch is a real capture through the public entry. Bound here, not
// imported there: the import cycle would leave a dead binding.
bindCapture(main)

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal')
// Internal token for "silent" export calls made from plugins (no hooks)
const INTERNAL_EXPORT_TOKEN = Symbol('snapdom.internal.silent')
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'svg'])

/**
 * Capture an element and return the result object with its exporters.
 * Local-first plugins: `options.plugins` override globals for this capture.
 * @param {HTMLElement} element - The DOM element to capture.
 * @param {object} [userOptions] - Options for rendering/exporting.
 * @returns {Promise<object>} `url`, `toRaw`, `toImg`, `toSvg`, `toCanvas`, `toBlob`, `toPng`,
 *   `toJpg`, `toWebp`, `download`, plus plugin exports
 */
async function main(element, userOptions) {
  if (!element) throw new Error('[SnapDOM] The element cannot be null or undefined.')

  // Normalize options into a capture context
  const context = createContext(userOptions)
  // Set here: burst's differential recapture builds its result without captureDOM.
  context.element = element

  // Here, not in burst: the style memos sit BELOW burst, and `{ burst: false, invalidate:
  // true }` after a CSSOM edit rendered the old CSS.
  if (context.invalidate) invalidateStyleCaches()

  // Attach per-capture plugins (local-first) without removing globals
  attachSessionPlugins(context, userOptions && userOptions.plugins)

  // How deep this capture runs, the maximum `needs` of its plugins (stages.js). Both fast
  // paths below need a render artifact.
  const { stage, loweredBy } = resolveStage(context)
  context.needs = stage
  context.__needsLoweredBy = loweredBy
  const rendersPixels = stageReaches(stage, 'render')

  // Render plugins suspend auto burst (a memo serve skips their hooks) unless burst:true or
  // `pure: true`. Capture callbacks may read outside state, so they always rerun. Decide before
  // Safari's awaited pre-step: a capture begun in a press handler belongs to that event task.
  const pluginAllowsMemo = context.burst === true || !hasImpureRenderPlugins(context)
  const hasCaptureCallbacks = typeof context.filter === 'function' || !!context.excludePredicates ||
    typeof context.excludeStyleProps === 'function' || typeof context.fallbackURL === 'function'
  const memoEligible = rendersPixels && !context.captureSelection &&
    context.burst !== false && pluginAllowsMemo && !hasCaptureCallbacks
  const burst = memoEligible && isAutoBurstSafe(element)
  if (burst) noteCapture(element, userOptions)

  if (!context.snap) {
    // NOT a compat shim: injected so clone.helpers can capture nested iframes without an
    // import cycle or window.snapdom. Direct captureDOM/deepClone callers pass their own;
    // clone.helpers throws by name without it.
    context.snap = {
      toPng: (el, opts) => snapdom.toPng(el, opts),
      toSvg: (el, opts) => snapdom.toSvg(el, opts),
    }
  }

  if (burst) {
    return captureWithBurst(
      element, userOptions, context,
      (session) => snapdom.capture(element, context, INTERNAL_TOKEN, session),
      (url, session) => buildResult(url, context, session)
    )
  }
  // The burst queue asks the same before each capture it runs.
  await yieldWhenTaskSpent()
  // Burst compares form-control state before it serves; without it, here.
  refreshUnwatchedControls(element)
  return snapdom.capture(element, context, INTERNAL_TOKEN)
}

/**
 * Internal capture: the Safari pre-step, captureDOM, then buildResult.
 * @private
 * @param {HTMLElement} el - The DOM element to capture.
 * @param {object} context - Normalized context options.
 * @param {symbol} _token - Internal security token.
 * @param {import('../core/session.js').CaptureSession} [session] - this run's session
 * @returns {Promise<object>} Exporter functions.
 */
snapdom.capture = async (el, context, _token, session = createCaptureSession(context)) => {
  if (_token !== INTERNAL_TOKEN) throw new Error('[SnapDOM] snapdom.capture() is internal; use snapdom(el).')

  // Safari pre-step: wait for used fonts and poke GPU-backed <canvas> stores so cloneCanvas's
  // toDataURL is not blank (WebKit #219770's blank first draw is toCanvas's job). Not on a memo
  // hit. Pinned by __tests__/api.safari.memoPreparation.test.js.
  if (stageReaches(context.needs || DEFAULT_STAGE, 'render') && isSafari()) {
    if (context.embedFonts) {
      try {
        // 'auto': wait only on webfont families the document drew with. System families
        // cost ~30ms per capture on WebKit for nothing. Explicit true always waits.
        const doc = el.ownerDocument || document
        let drawn = null
        if (context.embedFonts === 'auto') {
          // Layout first: it requests the faces fresh text needs (moved here, not added).
          el.getBoundingClientRect()
          drawn = documentFontFamilies(doc).drawn
          if (drawn.size === 0) throw null // nothing to wait for
        }
        // fontsPhase reuses this walk (a few frames stale, accepted). Not for clip captures:
        // their walk is clip-scoped, and full usage would undo the clip font subset.
        const usage = collectFontUsage(el)
        if (!context.clip) session.fontUsage = usage
        let required = usage.required
        if (drawn) {
          required = new Set([...required].filter((k) => drawn.has(fontKeyFamily(k).toLowerCase())))
          if (required.size === 0) throw null
        }
        await ensureFontsReady(required, usage.usedCodepoints, doc)
      } catch { /* non-blocking */ }
    }
    // querySelectorAll skips the root itself, which may be the <canvas>.
    const canvases = Array.from(el.querySelectorAll('canvas'))
    if (el.tagName === 'CANVAS') canvases.unshift(el)
    for (const c of canvases) {
      try {
        // Only poke a canvas that already HAS a context: getContext('2d') on a fresh one fixes
        // its mode and the app's later getContext('webgl') returns null. isBlankCanvas binds
        // nothing (it reads through a scratch canvas).
        if (isBlankCanvas(c)) continue
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) ctx.getImageData(0, 0, 1, 1)
      } catch (e) {
        debugWarn(context, 'Couldn\'t prepare canvases for Safari.', e)
      }
    }
  }

  const url = await captureDOM(el, context, session)
  return buildResult(url, context, session)
}

/**
 * Build the result object for a capture URL. Burst's differential recapture calls it too.
 * @private
 * @param {string|HTMLCanvasElement|null} url - svg data URL, engine bitmap, or null before render
 * @param {object} context - normalized capture context
 * @param {import('../core/session.js').CaptureSession} session - the run that made `url`
 * @returns {Promise<object>}
 */
async function buildResult(url, context, session) {
  // A capture that stopped at 'clone' has no render artifact: every door to one throws the
  // SAME error naming the plugins that lowered the stage, never a silent recapture of
  // another instant (stages.js). Read from the stage, not `url`, so it blames no one wrongly.
  const stage = context.needs || DEFAULT_STAGE
  const rendered = stageReaches(stage, 'render')
  const absent = (what) => absentArtifactError(stage, context.__needsLoweredBy || [], what)

  // An html-in-canvas bitmap: pixel exports draw it directly (an eager PNG cost 62 vs 4 ms on a
  // card, 2026-09-03), and url/toRaw mint the PNG once, on first read.
  const engineCanvas = (typeof HTMLCanvasElement !== 'undefined' && url instanceof HTMLCanvasElement) ? url : null
  let mintedUrl = engineCanvas ? null : url
  const urlOf = () => (mintedUrl ??= engineCanvas.toDataURL())
  const pixelSource = engineCanvas || url
  if (engineCanvas) url = ''

  // Keep the captured originals, not live DOM, for exports whose resolution grows later.
  // Clone registries stay with burst; a result only owns its frozen string records.
  const originals = session.compressedSnapshot
  const density = session.compressionDensity
  session.compressedAssets = null
  let originalUrl
  const meta = context.meta || {}
  const hasCaptureSize = Number.isFinite(context.width) || Number.isFinite(context.height)
  const sizedSVG = hasCaptureSize && !isSafari()
  const intrinsicX = sizedSVG
    ? (Number.isFinite(context.width) ? meta.targetW / meta.vbW : meta.targetH / meta.vbH) : 1
  const intrinsicY = sizedSVG
    ? (Number.isFinite(context.height) ? meta.targetH / meta.vbH : meta.targetW / meta.vbW) : 1
  // Async: an original can still be on its way (drawDecodedImages, compress.js).
  const exportSource = async (options) => {
    if (engineCanvas || !originals?.size) return pixelSource
    let w = meta.vbW, h = meta.vbH
    const crop = options.crop
    if (crop) {
      w = Math.max(1, Math.min(w, crop.x + crop.width) - Math.max(0, crop.x))
      h = Math.max(1, Math.min(h, crop.y + crop.height) - Math.max(0, crop.y))
    }
    const hasW = Number.isFinite(options.width), hasH = Number.isFinite(options.height)
    // Cropping preserves the SVG header's density and uses its decoded aspect ratio;
    // width-only/height-only exports can therefore magnify the other axis as well.
    const requested = (hasW && hasH ? Math.max(options.width / w, options.height / h)
      : hasW ? options.width / w * (crop ? Math.max(1, intrinsicY / intrinsicX) : 1)
        : hasH ? options.height / h * (crop ? Math.max(1, intrinsicX / intrinsicY) : 1)
          : (options.scale || 1) * Math.max(intrinsicX, intrinsicY)) * (options.dpr || 1)
    if (requested <= density) return pixelSource
    return originalUrl ??= restoreCompressedAssets(urlOf(), originals)
  }

  // What every export of this result takes besides its options (ExportEnv, toCanvas.js).
  const env = {
    warnings: session.warnings,
    layoutZoom: session.layoutZoom,
    fileSvg: session.fileSvg,
  }
  // The CSS strings export plugins read, written by whichever engine rendered.
  const artifacts = session.artifacts

  const rasterEngineImage = async (ctx, opts) => {
    const { rasterize } = await import('../modules/rasterize.js')
    return rasterize(pixelSource, { ...ctx, ...(opts || {}), format: 'png' }, env)
  }

  // Lazy: an eager SVG string doubles what a live result retains; toHtml decodes on demand.
  const lazySvgString = () => {
    if (!rendered) throw absent('svgString')
    // An engine capture is raster: decoding its PNG as svg would return base64 garbage.
    if (engineCanvas) throw new Error('[SnapDOM] html-in-canvas makes a raster capture; there is no SVG string.')
    const i = url.indexOf(',')
    // The svg as text leaves the browser's raster path, so it drops the layout zoom (#552).
    return i >= 0 ? fileSvgText(decodeURIComponent(url.slice(i + 1)), env.fileSvg) : ''
  }

  /**
   * What plugins see as `ctx.export`. `url` is a getter so a capture with no render
   * artifact fails at the read, with the reason, instead of handing over undefined.
   */
  const exportFacade = (extra) => Object.defineProperty(
    { ...(extra || {}), svgString: lazySvgString },
    'url',
    // Same reason as result.url below: the throwing form stays non-enumerable so copying
    // the facade doesn't detonate.
    rendered ? { get: urlOf, enumerable: true } : { get() { throw absent('export.url') }, enumerable: false, configurable: true }
  )

  // 1) Core exports, each exporter imported lazily on purpose
  const coreExports = {
    img: async (ctx, opts) => {
      if (engineCanvas) return rasterEngineImage(ctx, opts)
      const { toImg } = await import('../exporters/toImg.js')
      const options = { ...ctx, ...(opts || {}) }
      return toImg(await exportSource(options), options, env)
    },
    svg: async (ctx, opts) => {
      if (engineCanvas) return rasterEngineImage(ctx, opts)
      const { toSvg } = await import('../exporters/toImg.js')
      const options = { ...ctx, ...(opts || {}) }
      return toSvg(await exportSource(options), options, env)
    },
    canvas: async (ctx, opts) => {
      const { toCanvas } = await import('../exporters/toCanvas.js')
      const options = { ...ctx, ...(opts || {}) }
      return toCanvas(await exportSource(options), options, env)
    },
    blob: async (ctx, opts) => {
      const { toBlob } = await import('../exporters/toBlob.js')
      const options = { ...ctx, ...(opts || {}) }
      return toBlob(await exportSource(options), options, env)
    },
    png: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      const options = { ...ctx, ...(opts || {}), format: 'png' }
      return rasterize(await exportSource(options), options, env)
    },
    jpeg: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      const options = { ...ctx, ...(opts || {}), format: 'jpeg' }
      return rasterize(await exportSource(options), options, env)
    },
    webp: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      const options = { ...ctx, ...(opts || {}), format: 'webp' }
      return rasterize(await exportSource(options), options, env)
    },
    download: async (ctx, opts) => {
      const { download } = await import('../exporters/download.js')
      const options = { ...ctx, ...(opts || {}) }
      return download(await exportSource(options), options, env)
    },
  }

  // Every core export reads the render artifact, so they all fail the same way when there
  // is none. Plugin exports that override a core key replace this guard with their own.
  if (!rendered) {
    for (const k of Object.keys(coreExports)) {
      const label = k === 'download' ? 'download()' : `to${k.charAt(0).toUpperCase()}${k.slice(1)}()`
      coreExports[k] = async () => { throw absent(label) }
    }
  }

  // 2) Exports declared by plugins
  // Reusable "silent" facade (no hooks) for use from defineExports()
  const _pluginExports = {}
  for (const k of ['img', 'svg', 'canvas', 'blob', 'png', 'jpeg', 'webp']) {
    // Normalized like the public path, or `ctx.exports.blob({ format: 'png' })` came back an
    // SVG blob and `ctx.exports.jpeg()` encoded transparency black.
    _pluginExports[k] = async (opts) =>
      coreExports[k](context, { ...normalizeExportOptions(k, opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
  }
  _pluginExports.jpg = _pluginExports.jpeg

  // A spread drops the non-enumerable `options` self-reference the types declare required, so
  // re-pin it on each export-stage view.
  const viewOf = (extra) =>
    Object.defineProperty({ ...context, ...extra }, 'options', { value: context, configurable: true })

  const _defineCtx = viewOf({ artifacts, export: exportFacade(), exports: _pluginExports })

  const providedMaps = await runAll('defineExports', _defineCtx)
  // Local-first: earlier plugins in the list (locals) win over later (globals).
  // Object.assign applies last-wins, so reverse before merging.
  const provided = Object.assign({}, ...providedMaps.filter(x => x && typeof x === 'object').reverse())

  // Plugin exports override core (plugin > core by name).
  const exportsMap = { ...coreExports, ...provided }

  // Alias jpg to jpeg (for toJpg and to('jpg'))
  if (exportsMap.jpeg && !exportsMap.jpg) {
    exportsMap.jpg = (ctx, opts) => exportsMap.jpeg(ctx, opts)
  }

  // Per-type option normalizer (JPEG/WebP get a white background)
  function normalizeExportOptions(type, opts) {
    const raw = opts || {}
    const next = { ...context, ...raw }
    // v3: `format` is canonical. Deprecated `type` counts only when the RAW call carries an
    // image format: the context keeps a legacy `type` default that is not a request.
    const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
    const explicit = typeof raw.format === 'string' ? raw.format.toLowerCase()
      : (IMAGE_FORMATS.has(rawType) ? rawType : '')
    if (explicit) next.format = explicit === 'jpg' ? 'jpeg' : explicit
    // What the CALLER asked for (null = nothing): blob defaults to svg, download to png.
    next.__explicitFormat = explicit ? next.format : (context.__explicitFormat ?? null)
    // Hooks see the format the exporter will use: blob is svg unless asked, png for a
    // native canvas capture, which has no SVG.
    if (type === 'blob' && !next.__explicitFormat) next.format = engineCanvas ? 'png' : 'svg'
    next.type = next.format
    // `type` is the export NAME, not the format. Find a lossy format and flatten the
    // background as createContext does, or JPEG encodes transparency black.
    const lossy = (s) => s === 'jpeg' || s === 'jpg' || s === 'webp'
    const fmt = [type, next.format, rawType]
      .map(v => (typeof v === 'string' ? v.toLowerCase() : ''))
      .find(lossy)
    if (fmt) {
      const noBg = next.backgroundColor == null || next.backgroundColor === 'transparent'
      if (noBg) next.backgroundColor = '#ffffff'
    }
    // v3 sizing rule: width/height are the absolute output size and win; scale applies
    // only when neither is set; dpr multiplies device pixels.
    if (next.scale !== 1 && (Number.isFinite(next.width) || Number.isFinite(next.height))) {
      debugWarn(next, 'scale ignored: width/height already set the size.')
    }
    return next
  }

  // One runner: beforeExport/afterExport hooks and a per-result queue
  let afterSnapFired = false
  let _exportQueue = Promise.resolve()
  async function runExport(type, opts) {
    // Snapshot at CALL time: callers reuse options objects while earlier exports queue. Key
    // PRESENCE is kept too, since merged values cannot tell an override from an omitted key.
    const requestedOptions = Object.freeze(opts && typeof opts === 'object' ? { ...opts } : {})
    const job = async () => {
      const work = exportsMap[type]
      if (!work) throw new Error(`[SnapDOM] Unknown export type: ${type}`)
      const nextOpts = normalizeExportOptions(type, requestedOptions)
      const ctx = viewOf({ artifacts, export: exportFacade({ type, options: nextOpts, requestedOptions }) })
      // Both hooks OBSERVE: no return value is read. A plugin steers by mutating payload.options
      // (what work() receives). runAll, not runHook, which would chain returns into the payload.
      const formatBeforeHook = nextOpts.format
      const typeBeforeHook = nextOpts.type
      await runAll('beforeExport', ctx, { format: type, options: nextOpts })
      // payload.options is the exporter's actual bag. Reconcile a plugin's format/type
      // mutation after the hook so toBlob/download do not keep the pre-hook explicit codec.
      const rawFormat = nextOpts.format !== formatBeforeHook ? nextOpts.format
        : (nextOpts.type !== typeBeforeHook ? nextOpts.type : '')
      const requestedFormat = typeof rawFormat === 'string' ? rawFormat.toLowerCase() : ''
      if (IMAGE_FORMATS.has(requestedFormat)) {
        nextOpts.format = requestedFormat === 'jpg' ? 'jpeg' : requestedFormat
        nextOpts.type = nextOpts.format
        nextOpts.__explicitFormat = nextOpts.format
        if (/^(?:jpeg|webp)$/.test(nextOpts.format) &&
            (nextOpts.backgroundColor == null || nextOpts.backgroundColor === 'transparent')) nextOpts.backgroundColor = '#ffffff'
      }
      const result2 = await work(ctx, nextOpts)
      await runAll('afterExport', ctx, { format: type, options: nextOpts, result: result2 })
      if (!afterSnapFired) {
        afterSnapFired = true
        await runHook('afterSnap', context)
      }
      return result2
    }
    // A rejected job rejects for its own caller only: a rejected queue would skip every later
    // `job`.
    const run = _exportQueue.then(job)
    _exportQueue = run.catch(() => {})
    return run
  }

  // The result object
  const result = {
    // Present as a plain string on the normal path; a throwing getter (installed below)
    // when this capture stopped before the render stage.
    url,
    /** How far this capture ran: 'clone' | 'render'. Same word plugins declare. */
    needs: stage,
    // Degradation log, {code, message, detail?}. Export entries append when the export
    // resolves; a burst memo serve keeps the originating capture's log.
    warnings: env.warnings || [],
    toRaw: () => { if (!rendered) throw absent('toRaw()'); return urlOf() },
    to: (type, opts) => runExport(type, opts),

    // "Classic" methods the tests expect:
    toImg: (opts) => runExport('img', opts),
    toSvg: (opts) => runExport('svg', opts),
    toCanvas: (opts) => runExport('canvas', opts),
    toBlob: (opts) => runExport('blob', opts),
    toPng: (opts) => runExport('png', opts),
    toJpg: (opts) => runExport('jpg', opts),     // alias the tests require
    toWebp: (opts) => runExport('webp', opts),
    download: (opts) => runExport('download', opts)
  }

  // NOT enumerable, so a spread, JSON.stringify or logger does not crash on it; reading
  // result.url still throws, with the reason.
  if (!rendered) {
    Object.defineProperty(result, 'url', { get() { throw absent('url') }, enumerable: false, configurable: true })
  } else if (engineCanvas) {
    // Minted once, lazily: pixel-only use never pays the PNG encode.
    Object.defineProperty(result, 'url', { get: urlOf, enumerable: true, configurable: true })
  }

  // THE SAME frozen record every exporter reads, so url and meta never diverge. Before the
  // render stage there is no viewBox: a throwing getter like `url`.
  Object.defineProperty(result, 'meta', rendered
    ? { value: context.meta, enumerable: true }
    : { get() { throw absent('meta') }, enumerable: false, configurable: true })

  // Dynamic sugar for every registered export (plugins included)
  for (const key of Object.keys(exportsMap)) {
    const helper = 'to' + key.charAt(0).toUpperCase() + key.slice(1)
    if (!result[helper]) {
      result[helper] = (opts) => runExport(key, opts)
    }
  }

  return result
}

/**
 * Returns the raw data URL from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<string>} Raw data URL.
 */
snapdom.toRaw = (el, options) => snapdom(el, options).then(result => result.toRaw())

/**
 * Returns an HTMLImageElement from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} Loaded image element.
 */
snapdom.toImg = (el, options) => snapdom(el, options).then(result => result.toImg())
/** Same function as toImg: exporters/toImg.js exports it under both names. */
snapdom.toSvg = (el, options) => snapdom(el, options).then(result => result.toSvg())

/**
 * Returns a Canvas element from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLCanvasElement>} Rendered canvas element.
 */
snapdom.toCanvas = (el, options) => snapdom(el, options).then(result => result.toCanvas())

/**
 * Returns a Blob from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<Blob>} Image blob.
 */
snapdom.toBlob = (el, options) => snapdom(el, options).then(result => result.toBlob())

/**
 * Returns a PNG image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} PNG image element.
 */
snapdom.toPng = (el, options) => snapdom(el, { ...options, format: 'png' }).then(result => result.toPng())

/**
 * Returns a JPEG image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} JPEG image element.
 */
snapdom.toJpg = (el, options) => snapdom(el, { ...options, format: 'jpeg' }).then(result => result.toJpg())

/**
 * Returns a WebP image from a captured element.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} [options] - Rendering options.
 * @returns {Promise<HTMLImageElement>} WebP image element.
 */
snapdom.toWebp = (el, options) => snapdom(el, { ...options, format: 'webp' }).then(result => result.toWebp())

/**
 * Downloads the captured image in the specified format.
 * @param {HTMLElement} el - DOM element to capture.
 * @param {object} options - Download options including filename.
 * @param {string} options.filename - Name for the downloaded file.
 * @param {string} [options.format='png'] - Image format ('png', 'jpeg', 'webp', 'svg').
 * @returns {Promise<void>}
 */
snapdom.download = (el, options) => snapdom(el, options).then(result => result.download())

export default snapdom
