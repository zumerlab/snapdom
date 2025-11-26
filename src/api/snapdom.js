// src/api/snapdom.js
import { captureDOM } from '../core/capture.js'
import { extendIconFonts } from '../modules/iconFonts.js'
import { createContext } from '../core/context.js'
import { isSafari } from '../utils/browser.js'
import { registerPlugins, runHook, runAll, attachSessionPlugins } from '../core/plugins.js'
export { preCache } from './preCache.js'

// API pública (registro global de plugins)
export function plugins(...defs) { registerPlugins(...defs); return snapdom }
export const snapdom = Object.assign(main, { plugins })

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

  // Safari warm-up: only when needed (fonts embedded OR backgrounds/masks present)
  if (isSafari() && (context.embedFonts === true || hasBackgroundOrMask(element))) {
    for (let i = 0; i < 3; i++) {
      try {
        await safariWarmup(element, userOptions)
        _safariWarmup = false
      } catch {
        // swallow error
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
  const _pluginExports = {
    svg:   async (opts) => {
      const { toSvg } = await import('../exporters/toImg.js')
      return toSvg(url, { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
    },
    canvas:async (opts) => {
      const { toCanvas } = await import('../exporters/toCanvas.js')
      return toCanvas(url, { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
    },
    png:   async (opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...context, ...(opts || {}), format: 'png', [INTERNAL_EXPORT_TOKEN]: true })
    },
    jpeg:  async (opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...context, ...(opts || {}), format: 'jpeg', [INTERNAL_EXPORT_TOKEN]: true })
    },
    jpg:   async (opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...context, ...(opts || {}), format: 'jpeg', [INTERNAL_EXPORT_TOKEN]: true })
    },
    webp:  async (opts) => {
      const { rasterize } = await import('../modules/rasterize.js')
      return rasterize(url, { ...context, ...(opts || {}), format: 'webp', [INTERNAL_EXPORT_TOKEN]: true })
    },
    blob:  async (opts) => {
      const { toBlob } = await import('../exporters/toBlob.js')
      return toBlob(url, { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
    },
    img:   async (opts) => {
      const { toImg } = await import('../exporters/toImg.js')
      return toImg(url, { ...context, ...(opts || {}), [INTERNAL_EXPORT_TOKEN]: true })
    },
  }

  // Contexto extendido para defineExports (incluye URL y la fachada para reuso)
  const _defineCtx = { ...context, export: { url }, exports: _pluginExports }

  const providedMaps = await runAll('defineExports', _defineCtx)
  const provided = Object.assign({}, ...providedMaps.filter(x => x && typeof x === 'object'))

  // Merge (plugins pueden overridear core)
  const exportsMap = { ...coreExports, ...provided }

  // —— Alias: jpg → jpeg (para toJpg y to('jpg')) ——
  if (exportsMap.jpeg && !exportsMap.jpg) {
    exportsMap.jpg = (ctx, opts) => exportsMap.jpeg(ctx, opts)
  }

  // —— Normalizador para opciones por tipo (p.ej. JPEG: fondo blanco) ——
  function normalizeExportOptions(type, opts) {
    const next = { ...context, ...(opts || {}) }
    if (type === 'jpeg' || type === 'jpg') {
      const noBg = next.backgroundColor == null || next.backgroundColor === 'transparent'
      if (noBg) next.backgroundColor = '#ffffff'
    }
    return next
  }

  // —— Runner unificado con beforeExport/afterExport y cola por sesión ——
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
  } catch {}

  // 1) estabiliza layout/paint en WebKit
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

  if (url) {
    await new Promise((resolve) => {
      const img = new Image()
      try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
      img.style.cssText =
        'position:fixed;left:0px;top:0px;width:10px;height:10px;opacity:0.01;pointer-events:none;'
      img.src = url
      document.body.appendChild(img)

      ;(async () => {
        try { if (typeof img.decode === 'function') await img.decode() } catch {}
        const start = performance.now()
        while (!(img.complete && img.naturalWidth > 0) && performance.now() - start < 900) {
          await new Promise(r => setTimeout(r, 200))
        }
        await new Promise(r => requestAnimationFrame(r))
        try { img.remove() } catch {}
        resolve()
      })()
    })
  }

  // 3) “poke” a los canvas del elemento (Chart.js, etc.)
  element.querySelectorAll('canvas').forEach(c => {
    try {
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) { ctx.getImageData(0, 0, 1, 1) }
    } catch {}
  })

  _safariWarmup = true
}

/**
 * Checks if the element (or its descendants) use background or mask images.
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

export default snapdom
