// src/api/snapdom.js
import { captureDOM } from '../core/capture.js'
import { extendIconFonts } from '../modules/iconFonts.js'
import { createContext } from '../core/context.js'
import { isSafari } from '../utils/browser.js'
import { debugWarn } from '../utils/debug.js'
import { registerPlugins, runHook, runAll, attachSessionPlugins } from '../core/plugins.js'
import { collectUsedFontVariants, ensureFontsReady } from '../modules/fonts.js'
import { captureWithBurst } from '../core/burst.js'
export { preCache } from './preCache.js'

// API pública (registro global de plugins)
export function plugins(...defs) { registerPlugins(...defs); return snapdom }
export const snapdom = Object.assign(main, { plugins })

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal')
// Token interno para llamadas de export "silenciosas" desde plugins (no hooks)
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

  // Attach per-capture plugins (local-first) without removing globals
  attachSessionPlugins(context, userOptions && userOptions.plugins)

  // Safari pre-step (replaces the old 3x pre-capture warmup — WebKit #219770's blank
  // first draw is now handled at draw time by toCanvas's verified-draw ladder):
  // wait for the fonts the element actually uses, and poke GPU-backed <canvas>
  // stores so cloneCanvas's toDataURL isn't blank. Both are cheap per capture.
  if (isSafari()) {
    if (context.embedFonts === true) {
      try {
        const required = collectUsedFontVariants(element)
        const families = new Set([...required].map(k => String(k).split('__')[0]).filter(Boolean))
        await ensureFontsReady(families, 1)
      } catch { /* non-blocking */ }
    }
    // querySelectorAll never matches element itself — a capture root that IS the <canvas>
    // (e.g. snapdom(canvasEl) for a single chart) must be poked too.
    const canvases = Array.from(element.querySelectorAll('canvas'))
    if (element.tagName === 'CANVAS') canvases.unshift(element)
    for (const c of canvases) {
      try {
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) ctx.getImageData(0, 0, 1, 1)
      } catch (e) {
        debugWarn(userOptions, 'safari canvas poke failed', e)
      }
    }
  }

  if (context.iconFonts && context.iconFonts.length > 0) extendIconFonts(context.iconFonts)

  if (!context.snap) {
    // Mantener compat: atajos disponibles en context.snap
    context.snap = {
      toPng: (el, opts) => snapdom.toPng(el, opts),
      toSvg: (el, opts) => snapdom.toSvg(el, opts),
    }
  }

  if (context.burst) {
    return captureWithBurst(element, userOptions, context, () => snapdom.capture(element, context, INTERNAL_TOKEN))
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

  // Export/defineExports contexts are the same capture context promised to every
  // other hook. Keep the source element available there too (not only in
  // captureDOM's transient state wrapper), which is required for ownerDocument
  // URL/language semantics in document exporters.
  context.element = el

  const url = await captureDOM(el, context)

  // ——— 1) Core exports por defecto (carga lazy en cada tipo) ———
  // NOTA: no importamos estáticamente los exportadores aquí.
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
      return toBlob(url, { ...ctx, ...(opts || {}) })
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

  // ——— 2) Exports declarados por plugins ———
  // Fachada reutilizable “silenciosa” (sin hooks) para uso en defineExports()
  const _pluginExports = {}
  for (const k of ['img', 'svg', 'canvas', 'blob', 'png', 'jpeg', 'webp']) {
    _pluginExports[k] = async (opts) =>
      coreExports[k](context, { ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
  }
  _pluginExports.jpg = _pluginExports.jpeg

  // Contexto extendido para defineExports (incluye URL y la fachada para reuso)
  const _defineCtx = { ...context, export: { url }, exports: _pluginExports }

  const providedMaps = await runAll('defineExports', _defineCtx)
  // Local-first: earlier plugins in the list (locals) win over later (globals).
  // Object.assign applies last-wins, so reverse before merging.
  const provided = Object.assign({}, ...providedMaps.filter(x => x && typeof x === 'object').reverse())

  // Plugin exports override core (plugin > core by name).
  const exportsMap = { ...coreExports, ...provided }

  // —— Alias: jpg → jpeg (para toJpg y to('jpg')) ——
  if (exportsMap.jpeg && !exportsMap.jpg) {
    exportsMap.jpg = (ctx, opts) => exportsMap.jpeg(ctx, opts)
  }

  // —— Normalizador para opciones por tipo (p.ej. JPEG/WebP: fondo blanco) ——
  function normalizeExportOptions(type, opts) {
    const next = { ...context, ...(opts || {}) }
    // `type` aquí es el NOMBRE del export ('blob'/'canvas'/'download'/'jpeg'/…), no el formato
    // de imagen: en toBlob/toCanvas/download el formato viaja en opts.format/opts.type. Resolver
    // el formato real (jpg→jpeg) para aplanar el fondo igual que createContext (context.js:84),
    // o JPEG codificaría las zonas transparentes en negro.
    const lossy = (s) => s === 'jpeg' || s === 'jpg' || s === 'webp'
    const fmt = [type, next.format, next.type]
      .map(v => (typeof v === 'string' ? v.toLowerCase() : ''))
      .find(lossy)
    if (fmt) {
      const noBg = next.backgroundColor == null || next.backgroundColor === 'transparent'
      if (noBg) next.backgroundColor = '#ffffff'
    }
    return next
  }

  // —— Runner unificado con beforeExport/afterExport y cola por sesión ——
  let afterSnapFired = false
  let _exportQueue = Promise.resolve()
  async function runExport(type, opts) {
    // Snapshot at CALL time, not when this export eventually reaches the session
    // queue. Callers commonly reuse an options object; a slow earlier export must
    // not let later mutation rewrite the meaning of an already-requested export.
    const requestedOptions = Object.freeze(
      opts && typeof opts === 'object' ? { ...opts } : {}
    )
    const job = async () => {
      const work = exportsMap[type]
      if (!work) throw new Error(`[snapdom] Unknown export type: ${type}`)
      // Preserve key presence as well as values. A plugin default and a normalized
      // capture default may legitimately have the same value; comparing merged
      // values cannot tell whether the caller explicitly overrode the plugin.
      const nextOpts = normalizeExportOptions(type, requestedOptions)
      const ctx = { ...context, export: { type, options: nextOpts, requestedOptions, url } }
      // Payload shape per the plugin spec: beforeExport(ctx, {format, options}),
      // afterExport(ctx, {format, options, result}). `type` is the export name (png/blob/…).
      await runHook('beforeExport', ctx, { format: type, options: nextOpts })
      const result2 = await work(ctx, nextOpts)
      await runHook('afterExport', ctx, { format: type, options: nextOpts, result: result2 })
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

  // —— Helpers esperados por los tests + API azúcar ——
  const result = {
    url,
    toRaw: () => url,
    to: (type, opts) => runExport(type, opts),

    // Métodos “clásicos” que los tests esperan:
    toImg: (opts) => runExport('img', opts),
    toSvg: (opts) => runExport('svg', opts),
    toCanvas: (opts) => runExport('canvas', opts),
    toBlob: (opts) => runExport('blob', opts),
    toPng: (opts) => runExport('png', opts),
    toJpg: (opts) => runExport('jpg', opts),     // alias requerido por tests
    toWebp: (opts) => runExport('webp', opts),
    download: (opts) => runExport('download', opts)
  }
  // Read-only render geometry for document exporters and diagnostics. Pin both
  // the frozen value and the result property so URL/meta cannot diverge later.
  Object.defineProperty(result, 'meta', {
    value: context.meta, enumerable: true, writable: false, configurable: false,
  })

  // Azúcar dinámico por cada export registrado (plugins incluidos)
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
