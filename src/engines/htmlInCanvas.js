/**
 * EXPERIMENTAL render engine: WICG canvas-place-element (`ctx.drawElement`, Chrome ~130+
 * behind chrome://flags/#canvas-draw-element; older flagged builds shipped
 * `drawElementImage`). Renders a live-DOM copy straight into a canvas with the engine's
 * OWN painter — native form controls, correct fonts, no svg-as-image quirks — skipping
 * the style-snapshot/inline/serialize/decode pipeline entirely for raster exports.
 *
 * QUARANTINE CONTRACT (this feature is green): everything lives in src/engines/ — core's
 * only knowledge is a 3-line lazy-import seam in snapdom.js behind the opt-in
 * `engine: 'canvas'` option. On ANY doubt (API missing, unsupported options, tainted or
 * blank paint) `tryEngineResult` returns null and the caller runs the normal pipeline —
 * correctness never depends on this module. Vector-facing APIs on the engine result
 * (toRaw/toSvg/toImg) lazily run the normal pipeline; `.url` is not synchronously
 * available and warns once.
 *
 * PLATFORM STATUS (verified 2026-07-25, flagged Chromium via --enable-blink-features=
 * CanvasDrawElement): drawElement PAINTS pixel-perfectly — including native form controls
 * the svg pipeline cannot reproduce — but currently TAINTS the canvas unconditionally,
 * even for fully local content. No readback (getImageData/toBlob/toDataURL) means no
 * encodable exports yet, so the taint probe below sends every capture to the pipeline
 * today. The module is intentionally future-ready: the day Chromium ships same-origin
 * readback, engine:'canvas' lights up with no code changes.
 *
 * Fidelity model: the copy is mounted INSIDE the canvas (same document), so page
 * stylesheets apply naturally — no snapshotting. Ancestor context is preserved by
 * mounting the element's ancestor CHAIN as `display:contents` shells (selector matching
 * like `.sidebar .card` and inheritance survive; no boxes added). Known v1 gaps, by
 * design: sibling-dependent selectors on ancestors (:nth-child on the chain) and
 * anything the live painter ties to the original viewport position.
 * @module engines/htmlInCanvas
 */

import { debugWarn } from '../utils/debug.js'

/** @returns {'drawElement'|'drawElementImage'|null} */
export function detectDrawApi() {
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return null
    if (typeof ctx.drawElement === 'function') return 'drawElement'
    if (typeof ctx.drawElementImage === 'function') return 'drawElementImage'
  } catch { /* detection is best-effort */ }
  return null
}

let _warnedNoUrl = false

/**
 * Builds the mounted copy: canvas > (layoutsubtree) ancestor shells > deep clone.
 * Shells are display:contents — they contribute selector context and inheritance
 * but no boxes, so the copy lays out exactly like a root-level element.
 */
function mountCopy(element, width, height) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('layoutsubtree', '')
  canvas.setAttribute('data-snapdom-internal', '')
  // In-flow and painted (hidden/offscreen skips the paint pass → "no paint record"),
  // but behind everything.
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-2147483647;pointer-events:none'

  const wrapper = document.createElement('div')
  wrapper.style.cssText = `width:${width}px;height:${height}px;overflow:visible;box-sizing:border-box`

  // Ancestor chain as display:contents shells, outermost first.
  const shells = []
  for (let a = element.parentElement; a && a.tagName !== 'BODY' && a.tagName !== 'HTML'; a = a.parentElement) {
    const shell = a.cloneNode(false)
    shell.style.display = 'contents'
    shells.unshift(shell)
  }
  let mountPoint = wrapper
  for (const shell of shells) {
    mountPoint.appendChild(shell)
    mountPoint = shell
  }
  const copy = element.cloneNode(true)
  mountPoint.appendChild(copy)
  canvas.appendChild(wrapper)
  return { canvas, wrapper, copy }
}

/** Sync live form-control state into the copy (cloneNode drops it). */
function syncFormState(element, copy) {
  const srcs = [element, ...(element.querySelectorAll?.('input,textarea,select') || [])]
  const dsts = [copy, ...(copy.querySelectorAll?.('input,textarea,select') || [])]
  for (let i = 0; i < Math.min(srcs.length, dsts.length); i++) {
    const s = srcs[i], d = dsts[i]
    const tag = s.tagName
    if (tag === 'INPUT') {
      d.setAttribute('value', s.value)
      if (s.checked) d.setAttribute('checked', '')
    } else if (tag === 'TEXTAREA') {
      d.textContent = s.value
    } else if (tag === 'SELECT' && s.selectedIndex >= 0) {
      const opts = d.querySelectorAll('option')
      if (opts[s.selectedIndex]) opts[s.selectedIndex].setAttribute('selected', '')
    }
  }
}

/**
 * Attempts an engine capture. Returns a result object mirroring the normal capture
 * surface, or null when the engine can't honor this capture (caller falls back).
 * @param {Element} element
 * @param {object} context - normalized capture context
 * @param {() => Promise<object>} runFallback - runs the normal pipeline capture
 * @returns {Promise<object|null>}
 */
export async function tryEngineResult(element, context, runFallback) {
  const drawApi = detectDrawApi()
  if (!drawApi) return null

  // Narrow v1: anything the draw-the-live-copy model doesn't obviously honor → pipeline.
  const hasPlugins = Array.isArray(context.plugins) && context.plugins.length > 0
  if (hasPlugins) return null
  if (context.clip || (Array.isArray(context.exclude) ? context.exclude.length > 0 : !!context.exclude) || context.filter || context.reconcile) return null
  if (context.outerShadows) return null // canvas is sized to the element box; bleed needs pipeline math
  if (Number.isFinite(context.width) || Number.isFinite(context.height)) return null

  const rect = element.getBoundingClientRect()
  const width = Math.max(1, element.offsetWidth || rect.width || 1)
  const height = Math.max(1, element.offsetHeight || rect.height || 1)
  const scale = Number.isFinite(context.scale) && context.scale > 0 ? context.scale : 1
  const dpr = Number.isFinite(context.dpr) && context.dpr > 0 ? context.dpr : (window.devicePixelRatio || 1)
  const outW = Math.max(1, Math.round(width * scale * dpr))
  const outH = Math.max(1, Math.round(height * scale * dpr))

  const { canvas, wrapper, copy } = mountCopy(element, width, height)
  syncFormState(element, copy)
  canvas.width = outW
  canvas.height = outH
  document.body.appendChild(canvas)

  let out
  try {
    canvas.getBoundingClientRect() // force layout of the subtree
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const ctx2d = canvas.getContext('2d')
    const fn = ctx2d && ctx2d[drawApi]
    if (typeof fn !== 'function') return null
    ctx2d.save()
    ctx2d.scale(dpr * scale, dpr * scale)
    fn.call(ctx2d, wrapper, 0, 0, width, height)
    ctx2d.restore()

    // Taint probe: cross-origin content painted by drawElement taints the canvas and
    // would break every toDataURL/toBlob downstream — fall back to the pipeline, which
    // fetches + inlines those resources instead.
    let probe
    try {
      probe = ctx2d.getImageData(0, 0, Math.min(64, outW), Math.min(64, outH)).data
    } catch {
      debugWarn(context, "engine:'canvas': drawElement painted but the canvas is tainted (current Chromium taints unconditionally) — falling back to the svg pipeline")
      return null
    }
    // Blank probe: a copy that skipped the paint pass draws nothing — don't hand the
    // caller an empty capture when the element visibly has content.
    let ink = false
    for (let i = 3; i < probe.length; i += 4) { if (probe[i] > 0) { ink = true; break } }
    if (!ink && (element.textContent?.trim() || element.querySelector?.('img,svg,canvas,video'))) {
      const full = ctx2d.getImageData(0, 0, outW, outH).data
      let any = false
      for (let i = 3; i < full.length; i += 4) { if (full[i] > 0) { any = true; break } }
      if (!any) return null
    }

    // Detach the bitmap from the mounted DOM: copy to a clean canvas so removing the
    // mount doesn't matter and the returned canvas has no children/attributes.
    out = document.createElement('canvas')
    out.width = outW
    out.height = outH
    out.getContext('2d').drawImage(canvas, 0, 0)
    out.style.width = `${Math.round(width * scale)}px`
    out.style.height = `${Math.round(height * scale)}px`
  } finally {
    try { canvas.remove() } catch { /* ok */ }
  }

  // ——— result surface ———
  let fallbackResult = null
  const fallback = () => (fallbackResult ||= runFallback())

  const toDataURL = (format, quality) => new Promise((resolve) => {
    const done = (u) => resolve(String(u || ''))
    try {
      out.toBlob((blob) => {
        if (!blob) return done(out.toDataURL(`image/${format}`, quality))
        const fr = new FileReader()
        fr.onload = () => done(fr.result)
        fr.onerror = () => done(out.toDataURL(`image/${format}`, quality))
        fr.readAsDataURL(blob)
      }, `image/${format}`, quality)
    } catch {
      done(out.toDataURL(`image/${format}`, quality))
    }
  })

  const rasterImg = async (format, opts = {}) => {
    const dataURL = await toDataURL(format, opts.quality ?? context.quality)
    const img = new Image()
    img.src = dataURL
    await img.decode()
    img.style.width = out.style.width
    img.style.height = out.style.height
    return img
  }

  const result = {
    engine: 'canvas',
    get url() {
      if (!_warnedNoUrl) {
        _warnedNoUrl = true
        debugWarn(context, "engine:'canvas' results have no synchronous svg url — use toRaw()/toSvg(), which run the standard pipeline lazily")
      }
      return ''
    },
    toCanvas: async () => {
      const c = document.createElement('canvas')
      c.width = out.width
      c.height = out.height
      c.getContext('2d').drawImage(out, 0, 0)
      c.style.width = out.style.width
      c.style.height = out.style.height
      return c
    },
    toPng: (opts) => rasterImg('png', opts),
    toJpg: (opts) => rasterImg('jpeg', { quality: 0.92, ...opts }),
    toJpeg: (opts) => rasterImg('jpeg', { quality: 0.92, ...opts }),
    toWebp: (opts) => rasterImg('webp', opts),
    toBlob: (opts = {}) => new Promise((resolve, reject) => {
      const type = opts.type === 'jpg' ? 'jpeg' : (opts.type || 'png')
      try {
        out.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), `image/${type}`, opts.quality)
      } catch (e) { reject(e) }
    }),
    download: async (opts = {}) => {
      const { download } = await import('../exporters/download.js')
      const dataURL = await toDataURL(opts.format === 'jpg' ? 'jpeg' : (opts.format || 'png'), opts.quality)
      return download(dataURL, { ...context, ...opts })
    },
    // Vector-facing APIs: the engine has no svg — run the standard pipeline lazily.
    toRaw: async () => (await fallback()).toRaw(),
    toSvg: async (opts) => (await fallback()).toSvg(opts),
    toImg: async (opts) => (await fallback()).toImg(opts),
  }
  return result
}
