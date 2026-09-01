// src/api/snapdom.js
import { captureDOM } from '../core/capture.js'
import { isBlankCanvas } from '../core/clone.js'
import { createContext } from '../core/context.js'
import { isSafari } from '../utils/browser.js'
import { debugWarn } from '../utils/debug.js'
import { registerPlugins, runHook, runAll, attachSessionPlugins, hasImpureRenderPlugins } from '../core/plugins.js'
import { resolveStage, stageReaches, absentArtifactError, DEFAULT_STAGE } from '../core/stages.js'
import { collectFontUsage, ensureFontsReady } from '../modules/fonts.js'
import { invalidateStyleCaches } from '../modules/styles.js'
import { captureWithBurst, shouldAutoBurst } from '../core/burst.js'
export { preCache } from './preCache.js'

// Public API (global plugin registry)
export function plugins(...defs) { registerPlugins(...defs); return snapdom }

/**
 * Captures an HTML string (SSR markup, templates, sanitized user content) without the
 * caller wiring a mount: the markup mounts offscreen in the live document (so page CSS
 * and fonts apply), captures, and cleans up. When the string has a single root element
 * that element is the capture target; otherwise the wrapper is.
 *
 * TRUSTED HTML ONLY. The string goes through `innerHTML` into the REAL document, so it is
 * parsed and activated like any markup on the page: event-handler attributes run, in this
 * origin. That is not a bug to fix — a capture needs real layout, and real layout means a
 * live document — but it IS a boundary, and it belongs to the caller. Sanitize anything
 * user-supplied before it gets here.
 * @param {string} html
 * @param {object} [options] - Same options as snapdom()
 * @returns {Promise<object>} The capture result
 */
async function fromString(html, options) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('[snapdom.fromString] html string required')
  const mount = document.createElement('div')
  // data-snapdom-internal: mounting/removing must not bump the style epoch.
  mount.setAttribute('data-snapdom-internal', '')
  mount.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;'
  mount.innerHTML = html
  document.body.appendChild(mount)
  try {
    // One frame so layout (and any already-loaded fonts) settle before measuring.
    await new Promise((r) => requestAnimationFrame(r))
    const target = mount.children.length === 1 ? mount.firstElementChild : mount
    return await main(target, options)
  } finally {
    mount.remove()
  }
}

export const snapdom = Object.assign(main, { plugins, fromString })

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal')
// Internal token for "silent" export calls made from plugins (no hooks)
const INTERNAL_EXPORT_TOKEN = Symbol('snapdom.internal.silent')

/**
 * Main function that captures a DOM element and returns export utilities.
 * Local-first plugins: `options.plugins` override globals for this capture.
 *
 * @param {HTMLElement} element - The DOM element to capture.
 * @param {object} userOptions - Options for rendering/exporting.
 * @returns {Promise<object>} Object with exporter methods:
 *   - url: The raw data URL
 *   - toRaw(): Gets raw data URL
 *   - toImg(): Converts to Image element
 *   - toSvg(): Converts to SVG Image element
 *   - toCanvas(): Converts to HTMLCanvasElement
 *   - toBlob(): Converts to Blob
 *   - toPng(): Converts to PNG format
 *   - toJpg(): Converts to JPEG format
 *   - toWebp(): Converts to WebP format
 *   - download(): Triggers file download
 */
async function main(element, userOptions) {
  if (!element) throw new Error('Element cannot be null or undefined')

  // Normalize options into a capture context
  const context = createContext(userOptions)
  // The capture root, on every path: burst's differential recapture builds its result from
  // this context WITHOUT running captureDOM, so hooks are not a reliable place to stash it.
  context.element = element

  // `invalidate` has to land here, not inside burst: the style memos (property universe,
  // snapshots, CSSVar) are epoch-scoped and sit BELOW burst, so `{ burst: false,
  // invalidate: true }` after a CSSOM edit still rendered the pre-edit CSS world.
  if (context.invalidate) invalidateStyleCaches()

  // Attach per-capture plugins (local-first) without removing globals
  attachSessionPlugins(context, userOptions && userOptions.plugins)

  // How deep this capture runs: the maximum `needs` of those plugins (stages.js).
  // Resolved here, once, because both fast paths below only make sense for a capture
  // that ends in a render artifact.
  const { stage, loweredBy } = resolveStage(context)
  context.needs = stage
  context.__needsLoweredBy = loweredBy
  const rendersPixels = stageReaches(stage, 'render')

  // Safari pre-step (replaces the old 3x pre-capture warmup — WebKit #219770's blank
  // first draw is now handled at draw time by toCanvas's verified-draw ladder):
  // wait for the fonts the element actually uses, and poke GPU-backed <canvas>
  // stores so cloneCanvas's toDataURL isn't blank. Both are cheap per capture.
  // Both exist for the RENDER: a capture that stops earlier embeds no font and clones no
  // canvas, so this whole block would be pure cost on the path that exists to skip cost.
  if (rendersPixels && isSafari()) {
    if (context.embedFonts) {
      try {
        // 'auto': wait only on families the document actually declares as webfonts —
        // waiting on system families costs real time per capture (measured ~30ms on
        // WebKit) and buys nothing. Explicit true keeps the unconditional wait.
        const doc = element.ownerDocument || document
        const docFamilies = new Set()
        if (context.embedFonts === 'auto') {
          try { for (const f of doc.fonts) docFamilies.add(String(f.family).replace(/["']/g, '').toLowerCase()) } catch { /* no Font Loading API */ }
          if (docFamilies.size === 0) throw null // nothing to wait for
        }
        // One walk serves both consumers: fontsPhase reuses this usage instead of
        // re-walking the subtree (a few frames staler after ensureFontsReady's wait —
        // narrow missing-glyph exposure, accepted). Clip captures don't thread it:
        // their fontsPhase walk is clip-scoped, and full-subtree usage would regress
        // the clip font-subset optimization.
        const usage = collectFontUsage(element)
        if (!context.clip) context.__fontUsage = usage
        const required = usage.required
        let families = new Set([...required].map(k => String(k).split('__')[0]).filter(Boolean))
        if (context.embedFonts === 'auto') {
          families = new Set([...families].filter((f) => docFamilies.has(f.toLowerCase())))
          if (families.size === 0) throw null
        }
        await ensureFontsReady(families, 1)
      } catch { /* non-blocking */ }
    }
    // querySelectorAll never matches element itself — a capture root that IS the <canvas>
    // (e.g. snapdom(canvasEl) for a single chart) must be poked too.
    const canvases = Array.from(element.querySelectorAll('canvas'))
    if (element.tagName === 'CANVAS') canvases.unshift(element)
    for (const c of canvases) {
      try {
        // Only poke a canvas that already HAS a context. getContext('2d') on one the page has
        // not initialized yet creates it and fixes the element's mode for good, so the app's
        // own later getContext('webgl') returns null — snapdom must not be able to break the
        // page it is photographing. A canvas with content necessarily has a context (nothing
        // can be drawn without one), and isBlankCanvas reads it through a scratch canvas,
        // which binds nothing. A blank one has nothing for the poke to materialize anyway,
        // and cloneCanvas still runs its own rAF + retry ladder for the GPU-backed case.
        if (isBlankCanvas(c)) continue
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) ctx.getImageData(0, 0, 1, 1)
      } catch (e) {
        debugWarn(userOptions, 'safari canvas poke failed', e)
      }
    }
  }

  if (!context.snap) {
    // NOT a compat shim: this is the dependency injection that lets clone.helpers capture
    // nested iframes (rasterizeIframe) without importing snapdom back and creating a cycle,
    // and without reaching for a global window.snapdom. Direct captureDOM/deepClone callers
    // must pass it themselves — clone.helpers throws by name when it is missing.
    context.snap = {
      toPng: (el, opts) => snapdom.toPng(el, opts),
      toSvg: (el, opts) => snapdom.toSvg(el, opts),
    }
  }

  // Explicit burst wins; unset auto-enables on repeated captures of the same element.
  // Render-affecting plugins suspend auto mode (a memo serve would skip their hooks) —
  // explicit burst:true keeps memoizing (the caller opted in), and `pure: true` plugins
  // re-enable auto.
  // A capture that produces no render artifact has nothing to memoize, and its plugins
  // read the LIVE tree on every call — a memo serve would be exactly the stale read.
  const burst = !rendersPixels
    ? false
    : context.burst === undefined
      ? (!hasImpureRenderPlugins(context) && shouldAutoBurst(element))
      : context.burst
  if (burst) {
    return captureWithBurst(
      element, userOptions, context,
      () => snapdom.capture(element, context, INTERNAL_TOKEN),
      (url) => buildResult(url, context)
    )
  }
  return snapdom.capture(element, context, INTERNAL_TOKEN)
}

/**
 * Internal capture method that returns helper methods for transformation/export.
 * Integrates export hooks: beforeExport → work() → afterExport → afterSnap(once per URL)
 * @private
 * @param {HTMLElement} el - The DOM element to capture.
 * @param {object} context - Normalized context options.
 * @param {symbol} _token - Internal security token.
 * @returns {Promise<object>} Exporter functions.
 */
snapdom.capture = async (el, context, _token) => {
  if (_token !== INTERNAL_TOKEN) throw new Error('[snapdom.capture] is internal. Use snapdom(...) instead.')

  const url = await captureDOM(el, context)
  return buildResult(url, context)
}

/**
 * Builds the exporter-result object for a capture URL (core exports, plugin exports,
 * to<Format> helpers, hooks). Shared by snapdom.capture and burst's differential
 * recapture, which produces a fresh URL without re-running captureDOM.
 * @private
 */
async function buildResult(url, context) {
  // A capture that stopped at 'dom' or 'clone' has no render artifact. Every door to one
  // throws the SAME error, naming the plugins that lowered the stage: silently
  // re-capturing would hand back pixels of a different instant (stages.js).
  // Read from the STAGE, not from `url`: if some other path ever hands back a non-string,
  // the error must not blame plugins that did nothing.
  const stage = context.needs || DEFAULT_STAGE
  const rendered = stageReaches(stage, 'render')
  const absent = (what) => absentArtifactError(stage, context.__needsLoweredBy || [], what)

  // Lazy decode: exposing the serialized SVG eagerly would double retained string size
  // per live result — exporters that need it (toHtml) pay the decode on demand.
  const lazySvgString = () => {
    if (!rendered) throw absent('svgString')
    const i = url.indexOf(',')
    return i >= 0 ? decodeURIComponent(url.slice(i + 1)) : ''
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
    rendered ? { value: url, enumerable: true } : { get() { throw absent('export.url') }, enumerable: false, configurable: true }
  )

  // ——— 1) Default core exports (each type is imported lazily) ———
  // NOTE: the exporters are deliberately not imported statically here.
  const coreExports = {
    img: async (ctx, opts) => {
      const { toImg } = await import('../exporters/toImg.js')
      return toImg(url, { ...ctx, ...(opts || {}) })
    },
    svg: async (ctx, opts) => {
      const { toSvg } = await import('../exporters/toImg.js')
      return toSvg(url, { ...ctx, ...(opts || {}) })
    },
    canvas: async (ctx, opts) => {
      const { toCanvas } = await import('../exporters/toCanvas.js')
      return toCanvas(url, { ...ctx, ...(opts || {}) })
    },
    blob: async (ctx, opts) => {
      const { toBlob } = await import('../exporters/toBlob.js')
      // Blob keeps its historic svg default (the raw vector output) unless the caller
      // explicitly asked for an image format.
      return toBlob(url, { ...ctx, ...(opts || {}), format: (opts && opts.__explicitFormat) || 'svg' })
    },
    png: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...ctx, ...(opts || {}), format: 'png' })
    },
    jpeg: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...ctx, ...(opts || {}), format: 'jpeg' })
    },
    webp: async (ctx, opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...ctx, ...(opts || {}), format: 'webp' })
    },
    download: async (ctx, opts) => {
      const { download } = await import('../exporters/download.js')
      return download(url, { ...ctx, ...(opts || {}) })
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

  // ——— 2) Exports declarados por plugins ———
  // Reusable "silent" facade (no hooks) for use from defineExports()
  const _pluginExports = {}
  for (const k of ['img', 'svg', 'canvas', 'blob', 'png', 'jpeg', 'webp']) {
    // Same normalization the public path applies. Skipping it meant the facade took raw
    // options: `ctx.exports.blob({ format: 'png' })` handed `work` an un-normalized bag and
    // came back an SVG blob, and `ctx.exports.jpeg()` never picked up the opaque-background
    // default that keeps transparency from encoding black.
    _pluginExports[k] = async (opts) =>
      coreExports[k](context, { ...normalizeExportOptions(k, opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
  }
  _pluginExports.jpg = _pluginExports.jpeg

  // Extended context for defineExports (carries the URL and the facade for reuse)
  // `options` is a NON-enumerable self-reference on the capture context, so a `{...context}`
  // spread drops it — and every export-stage context is a spread. Plugins written against
  // the published types (which declare `options` required on CaptureContext) therefore threw
  // on `ctx.options.…` inside defineExports/beforeExport/afterExport while the identical line
  // worked in afterClone. Re-pin it on each view.
  const viewOf = (extra) =>
    Object.defineProperty({ ...context, ...extra }, 'options', { value: context, configurable: true })

  const _defineCtx = viewOf({ artifacts: context.__artifacts || null, export: exportFacade(), exports: _pluginExports })

  const providedMaps = await runAll('defineExports', _defineCtx)
  // Local-first: earlier plugins in the list (locals) win over later (globals).
  // Object.assign applies last-wins, so reverse before merging.
  const provided = Object.assign({}, ...providedMaps.filter(x => x && typeof x === 'object').reverse())

  // Plugin exports override core (plugin > core by name).
  const exportsMap = { ...coreExports, ...provided }

  // —— Alias: jpg -> jpeg (for toJpg and to('jpg')) ——
  if (exportsMap.jpeg && !exportsMap.jpg) {
    exportsMap.jpg = (ctx, opts) => exportsMap.jpeg(ctx, opts)
  }

  // —— Per-type option normalizer (e.g. JPEG/WebP: white background) ——
  function normalizeExportOptions(type, opts) {
    const raw = opts || {}
    const next = { ...context, ...raw }
    // v3: `format` is the one documented name for the output format. `type` survives as a
    // silent runtime alias ONLY when the caller passed an image-format string in it —
    // context.type is the result TYPE (svg/img/canvas/blob), never a format, and
    // context.format is always set, so the alias must read the RAW caller opts.
    const IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'svg'])
    const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
    const explicit = typeof raw.format === 'string' ? raw.format.toLowerCase()
      : (IMAGE_FORMATS.has(rawType) ? rawType : '')
    if (explicit) next.format = explicit === 'jpg' ? 'jpeg' : explicit
    // What the CALLER actually asked for (null = nothing): per-export defaults differ
    // (blob defaults to svg, download to png), so they need the explicit value, not the
    // context default.
    next.__explicitFormat = explicit ? next.format : (context.__explicitFormat ?? null)
    // `type` here is the export NAME ('blob'/'canvas'/'download'/'jpeg'/…), not the image
    // format. Resolve the real format (jpg -> jpeg) so the background is flattened the same
    // way createContext does it, or JPEG would encode transparent areas as black.
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
      debugWarn(next, 'width/height define the output size — scale is ignored when either is set')
    }
    return next
  }

  // —— Unified runner with beforeExport/afterExport and a per-session queue ——
  let afterSnapFired = false
  let _exportQueue = Promise.resolve()
  async function runExport(type, opts) {
    // Snapshot at CALL time, not when this export reaches the queue below. Callers reuse an
    // options object, and a slow earlier export must not let later mutation rewrite the
    // meaning of an already-requested one. Key PRESENCE is preserved too: a plugin default
    // and a normalized capture default can hold the same value, so comparing merged values
    // cannot tell an explicit override from an omitted key.
    const requestedOptions = Object.freeze(opts && typeof opts === 'object' ? { ...opts } : {})
    const job = async () => {
      const work = exportsMap[type]
      if (!work) throw new Error(`[snapdom] Unknown export type: ${type}`)
      const nextOpts = normalizeExportOptions(type, requestedOptions)
      const ctx = viewOf({ artifacts: context.__artifacts || null, export: exportFacade({ type, options: nextOpts, requestedOptions }) })
      // Payload shape per the plugin spec: beforeExport(ctx, {format, options}),
      // afterExport(ctx, {format, options, result}). `type` is the export name (png/blob/…).
      // Both hooks OBSERVE: what an export returns is decided by `work`, and no hook return
      // value is read. A plugin steers an export by MUTATING payload.options (that same
      // object is what work() receives) and replaces one by declaring it in defineExports.
      // runAll, not runHook: runHook CHAINS returns, so one plugin returning anything would
      // hand the next plugin that value instead of the documented payload.
      await runAll('beforeExport', ctx, { format: type, options: nextOpts })
      const result2 = await work(ctx, nextOpts)
      await runAll('afterExport', ctx, { format: type, options: nextOpts, result: result2 })
      if (!afterSnapFired) {
        afterSnapFired = true
        await runHook('afterSnap', context)
      }
      return result2
    }
    // A rejected job must reject only for ITS OWN caller, not poison every export
    // call made afterward: chaining `_exportQueue.then(job)` directly would leave
    // _exportQueue permanently rejected once any export throws, and `.then()`
    // with no rejection handler skips `job` entirely on every later call.
    const run = _exportQueue.then(job)
    _exportQueue = run.catch(() => {})
    return run
  }

  // —— Helpers the tests expect, plus API sugar ——
  const result = {
    // Present as a plain string on the normal path; a throwing getter (installed below)
    // when this capture stopped before the render stage.
    url,
    /** How far this capture ran: 'clone' | 'render'. Same word plugins declare. */
    needs: stage,
    // Degradation log for this capture (empty in the common case): {code, message,
    // detail?} entries — image→placeholder, raster/canvas clamps, Safari PNG fallback,
    // reconcile risk. Export-time entries append after the export resolves; burst memo
    // serves retain the originating capture's log.
    warnings: (context.__session && context.__session.warnings) || [],
    toRaw: () => { if (!rendered) throw absent('toRaw()'); return url },
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

  // NOT enumerable: a throwing getter that spread/JSON.stringify/a logger would trip over
  // turns "there is no image" into a crash in the code trying to report it. Reading
  // result.url still throws, with the reason.
  if (!rendered) {
    Object.defineProperty(result, 'url', { get() { throw absent('url') }, enumerable: false, configurable: true })
  }

  // Read-only render geometry for document exporters and diagnostics: THE SAME frozen
  // record the context and every exporter read, so url and meta can never diverge. Pinned
  // non-writable/non-configurable (this result object is ours, unlike the context bag).
  // A capture that stopped before the render stage has no viewBox at all, so meta gets the
  // same non-enumerable throwing getter as `url` rather than a fabricated shape.
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
