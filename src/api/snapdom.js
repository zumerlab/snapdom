// src/api/snapdom.js
import { captureDOM } from '../core/capture'
import { extendIconFonts } from '../modules/iconFonts.js'
import { createContext } from '../core/context'
import { toImg, toSvg } from '../exporters/toImg.js'
import { toCanvas } from '../exporters/toCanvas.js'
import { toBlob } from '../exporters/toBlob.js'
import { rasterize } from '../modules/rasterize.js'
import { download } from '../exporters/download.js'
import { isSafari } from '../utils/browser.js'
import { registerPlugins, runHook, runAll, attachSessionPlugins } from '../core/plugins.js' // ← local-first support

// API pública (registro global de plugins)
snapdom.plugins = (...defs) => { registerPlugins(...defs); return snapdom }

// Token to prevent public use of snapdom.capture
const INTERNAL_TOKEN = Symbol('snapdom.internal')
// Token interno para llamadas de export "silenciosas" desde plugins (no hooks)
const INTERNAL_EXPORT_TOKEN = Symbol('snapdom.internal.silent')

let _safariWarmup = false

/**
 * Main function that captures a DOM element and returns export utilities.
 * Local-first plugins: `options.plugins` override globals for this capture.
 *
 * @param {HTMLElement} element - The DOM element to capture.
 * @param {object} userOptions - Options for rendering/exporting.
 * @returns {Promise<object>} Object with exporter methods:
 * @deprecated toImg()
 *   - url: The raw data URL
 *   - toRaw(): Gets raw data URL
 *   - toImg(): Converts to Svg format
 *   - toSvg(): Converts to Svg format
 *   - toCanvas(): Converts to HTMLCanvasElement
 *   - toBlob(): Converts to Blob
 *   - toPng(): Converts to PNG format
 *   - toJpg(): Converts to JPEG format
 *   - toWebp(): Converts to WebP format
 *   - download(): Triggers file download
 */
export async function snapdom(element, userOptions) {
  if (!element) throw new Error('Element cannot be null or undefined')

  // Normalize options into a capture context
  const context = createContext(userOptions)

  // Attach per-capture plugins (local-first) without removing globals
  attachSessionPlugins(context, userOptions && userOptions.plugins)

  // Safari warm-up: only when needed (fonts embedded OR backgrounds/masks present)
  if (isSafari() && (context.embedFonts === true || hasBackgroundOrMask(element))) {
    for (let i = 0; i < 3; i++) {
      try {
        await safariWarmup(element, userOptions)
        console.log('safariWarmup:', i)
        _safariWarmup = false
      } catch {
        // swallow error
      }
    }
  }

  /* c8 ignore next 1 */
  if (context.iconFonts && context.iconFonts.length > 0) extendIconFonts(context.iconFonts)

  if (!context.snap) {
    context.snap = {
      toPng: (el, opts) => snapdom.toPng(el, opts),
      toSvg: (el, opts) => snapdom.toSvg(el, opts),
    }
  }

  return snapdom.capture(element, context, INTERNAL_TOKEN)
}

/**
 * Global registration API (plugins).
 * Kept here for DX; identical to the top alias.
 * @param  {...any} defs
 * @returns {typeof snapdom}
 */
snapdom.plugins = (...defs) => { registerPlugins(...defs); return snapdom }

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

  // ——— 1) Core exports por defecto ———
  const coreExports = {
    img: async (ctx, opts) => toImg(url, { ...ctx, ...(opts || {}) }),
    svg: async (ctx, opts) => toSvg(url, { ...ctx, ...(opts || {}) }),
    canvas: async (ctx, opts) => toCanvas(url, { ...ctx, ...(opts || {}) }),
    blob: async (ctx, opts) => toBlob(url, { ...ctx, ...(opts || {}) }),
    png: async (ctx, opts) => rasterize(url, { ...ctx, ...(opts || {}), format: 'png' }),
    jpeg: async (ctx, opts) => rasterize(url, { ...ctx, ...(opts || {}), format: 'jpeg' }),
    webp: async (ctx, opts) => rasterize(url, { ...ctx, ...(opts || {}), format: 'webp' }),
    download: async (ctx, opts) => download(url, { ...ctx, ...(opts || {}) }),
  }

  // ——— 2) Exports declarados por plugins ———
  // Facade para plugins: insumos reutilizables "silenciosos" (sin hooks), nombres sin "to"
  const _pluginExports = {
    svg:   (opts) => toSvg(url,    { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true }),
    canvas:(opts) => toCanvas(url, { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true }),
    png:   (opts) => rasterize(url,{ ...context, ...(opts || {}), format: 'png',  [INTERNAL_EXPORT_TOKEN]: true }),
    jpeg:  (opts) => rasterize(url,{ ...context, ...(opts || {}), format: 'jpeg', [INTERNAL_EXPORT_TOKEN]: true }),
    jpg:   (opts) => rasterize(url,{ ...context, ...(opts || {}), format: 'jpeg', [INTERNAL_EXPORT_TOKEN]: true }),
    webp:  (opts) => rasterize(url,{ ...context, ...(opts || {}), format: 'webp', [INTERNAL_EXPORT_TOKEN]: true }),
    blob:  (opts) => toBlob(url,   { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true }),
    img:   (opts) => toImg(url,    { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
  }

  // Contexto extendido para defineExports (incluye URL y la fachada para reuso)
  const _defineCtx = { ...context, export: { url }, exports: _pluginExports }

  const providedMaps = await runAll('defineExports', _defineCtx)
  const provided = Object.assign({}, ...providedMaps.filter(x => x && typeof x === 'object'))

  // Merge (plugins pueden overridear core)
  const exportsMap = { ...coreExports, ...provided }

  // ——— Alias: jpg → jpeg (para toJpg y to('jpg')) ———
  if (exportsMap.jpeg && !exportsMap.jpg) {
    exportsMap.jpg = (ctx, opts) => exportsMap.jpeg(ctx, opts)
  }

  // ——— Normalizador para opciones por tipo (p.ej. JPEG: fondo blanco) ———
  function normalizeExportOptions(type, opts) {
    const next = { ...context, ...(opts || {}) }
    if (type === 'jpeg' || type === 'jpg') {
      const noBg = next.backgroundColor == null || next.backgroundColor === 'transparent'
      if (noBg) next.backgroundColor = '#ffffff'
    }
    return next
  }

  // ——— Runner unificado con beforeExport/afterExport y cola por sesión ———
  let afterSnapFired = false
  let _exportQueue = Promise.resolve()
  async function runExport(type, opts) {
    const job = async () => {
      const work = exportsMap[type]
      if (!work) throw new Error(`[snapdom] Unknown export type: ${type}`)
      const nextOpts = normalizeExportOptions(type, opts)
      const ctx = { ...context, export: { type, options: nextOpts, url } }
      await runHook('beforeExport', ctx)
      const result2 = await work(ctx, nextOpts)
      await runHook('afterExport', ctx, result2)
      if (!afterSnapFired) {
        afterSnapFired = true
        await runHook('afterSnap', context)
      }
      return result2
    }
    return _exportQueue = _exportQueue.then(job)
  }

  // ——— Helpers esperados por los tests + API azúcar ———
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
    toJpg: (opts) => runExport('jpg', opts),     // ← alias requerido por los tests
    toWebp: (opts) => runExport('webp', opts),
    download: (opts) => runExport('download', opts) // ← método directo (no toDownload)
  }

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

/**
 * Force Safari to decode fonts and images by doing an offscreen pre-capture.
 * - Creates a tiny offscreen <img> using the SVG data URL from captureDOM.
 * - Awaits decoding and paints to a 1×1 canvas to ensure full decode/composite.
 *
 * @param {HTMLElement} element
 * @param {object} baseOptions - user options
 * @returns {Promise<void>}
 */
async function safariWarmup(element, baseOptions) {
  if (_safariWarmup) return

  const preflight = {
    ...baseOptions,
    fast: true,
    embedFonts: true,
    scale: 0.2
  }

  let url
  try {
    url = await captureDOM(element, preflight)
  } catch {
    // no bloquea la captura real
  }

  // 1) estabiliza layout/paint en WebKit
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

  if (url) {
    await new Promise((resolve) => {
      const img = new Image()
      try { img.decoding = 'sync'; img.loading = 'eager' } catch { /* noop */ }
      img.style.cssText =
        'position:fixed;left:0px;top:0px;width:10px;height:10px;opacity:0.01;pointer-events:none;'
      img.src = url
      document.body.appendChild(img)

      ;(async () => {
        try { if (typeof img.decode === 'function') await img.decode() } catch { /* noop */ }
        const start = performance.now()
        while (!(img.complete && img.naturalWidth > 0) && performance.now() - start < 900) {
          // ~3–4 ticks worst-case
          await new Promise(r => setTimeout(r, 50))
        }
        await new Promise(r => requestAnimationFrame(r))
        try { img.remove() } catch { /* noop */ }
        resolve()
      })()
    })
  }

  // 3) “poke” a los canvas del elemento (Chart.js, etc.)
  element.querySelectorAll('canvas').forEach(c => {
    try {
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) { ctx.getImageData(0, 0, 1, 1) }
    } catch { /* noop */ }
  })

  _safariWarmup = true
}

/**
 * Checks if the element (or its descendants) use background or mask images.
 * @param {Element} el - The root element to inspect.
 * @returns {boolean} True if any background or mask image is found.
 */
function hasBackgroundOrMask(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const node = /** @type {Element} */ (walker.currentNode)
    const cs = getComputedStyle(node)

    const bg = cs.backgroundImage && cs.backgroundImage !== 'none'
    const mask = (cs.maskImage && cs.maskImage !== 'none') ||
      (cs.webkitMaskImage && cs.webkitMaskImage !== 'none')

    if (bg || mask) return true
    if (node.tagName === 'CANVAS') return true
  }
  return false
}
