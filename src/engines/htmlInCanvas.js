/**
 * Second render engine: WICG html-in-canvas (`ctx.drawElementImage`), opt-in through
 * `engine: 'html-in-canvas'`. The browser's OWN painter draws scrollbars and native controls
 * as the page does, with no svg-as-image quirks. It paints the clone, so a control the clone
 * already redraws looks as in the svg engine: `<audio controls>` is a drawn player (#444), and
 * a bare `<progress>` or `<meter>` loses Chromium's native look (Chrome 157, 2026-10-28,
 * docs/labs/into-the-dock/).
 *
 * A PEER OF engines/svg.js: same input, the finished clone. Re-copying the LIVE element is
 * what any page can do with drawElement, and it skipped the passes behind plugins, clip,
 * exclude and reconcile. Mounting the clone with core's CSS gets them all.
 *
 * CONTRACT WITH CORE: core knows only the lazy-import seam in captureDOM. On ANY doubt (API
 * missing, unsupported options, tainted or blank paint) return null and the caller runs the
 * SVG engine on the same clone. Opt-in on the speed goal: the native paint waits for a
 * rendering update, about 35 ms on a card against 3 for svg (BENCHMARKS.md).
 *
 * PLATFORM. Chrome 157 ships it unflagged (MDN BCD: `drawElementImage`, `content="drawable"`,
 * `drawable`, `requestPaint`). Firefox and WebKit have none, so `detectDrawApi` sends them to
 * svg. Live parity in Chrome 155 (2026-10-26) put every demo it accepts at or below the svg
 * engine's mismatch. The spec leaves sensitive content (cross-origin resources, :visited,
 * system colors, IME, subpixel AA) out of the paint, which is why it draws the clone, whose
 * cross-origin images and fonts are already inlined. The taint probe is the safety net.
 *
 * Markup: `drawable` on the drawn element; on the canvas both `content="drawable"` (shipped)
 * and `layoutsubtree` (trial builds through Chrome 155 and forks on them). One rendering
 * update after the mount is the sync point. Never call `canvas.requestPaint()`: in Chrome 155
 * a removed canvas that had requested one crashed the renderer at the next iframe, and
 * toCanvas creates one per decode (2026-10-26).
 *
 * NOT OPTIMIZED: no bbox/bleed math, root expansion or scroll anchoring; `tryCanvasEngine`
 * lists those bails.
 * @module engines/htmlInCanvas
 */

import { debugWarn } from '../utils/debug.js'
import { isInternalNode, markInternalNode } from '../utils/ownership.js'
import { adoptShadowCSS } from '../utils/capture.helpers.js'

/**
 * Name the draw method this browser exposes, or null. Null sends every capture to the svg
 * engine, which is where Firefox, WebKit and Chrome before 157 land. The M138 dev-trial
 * name (`drawElement`) is no longer checked: no shipping build has it.
 * @returns {'drawElementImage'|null}
 */
export function detectDrawApi() {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx && typeof ctx.drawElementImage === 'function') return 'drawElementImage'
  } catch { /* detection is best-effort */ }
  return null
}

/**
 * Mount the FINISHED CLONE for painting: canvas[layoutsubtree] > wrapper > #shadow > clone.
 *
 * The clone carries its styles as generated classes, so `all:initial` on the wrapper isolates
 * it from the page, as the foreignObject container does in the SVG engine.
 *
 * @param {Element} clone - the finished clone (moved into the mount; the caller still holds
 *   the reference, so a bail can hand it straight to the SVG engine)
 * @param {string} css - baseCSS + scrollbarCSS + fontsCSS + classCSS
 * @param {number} width
 * @param {number} height
 */
function mountClone(clone, css, width, height) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('layoutsubtree', '')
  canvas.setAttribute('content', 'drawable')
  markInternalNode(canvas)
  // Painted but behind everything: hidden or offscreen skips the paint ("no paint record").
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-2147483647;pointer-events:none'

  const wrapper = document.createElement('div')
  // drawElementImage requires `drawable` (implies isolation:isolate); inert on older builds.
  wrapper.setAttribute('drawable', '')
  wrapper.style.cssText =
    `all:initial;box-sizing:border-box;display:block;overflow:visible;width:${width}px;height:${height}px`

  // Shadow root, as in the svg engine's measurement mounts: a page CSP of `style-src 'self'`
  // refuses an inline <style> (the clone painted transparent in real Chrome 155, 2026-10-23),
  // and in the light DOM page rules still reached the clone through its kept class names.
  const shadow = wrapper.attachShadow({ mode: 'open' })
  adoptShadowCSS(shadow, css)
  shadow.appendChild(clone)
  canvas.appendChild(wrapper)
  return { canvas, wrapper }
}

/**
 * Paint a finished clone into a canvas. Returns the canvas, or null when this engine cannot
 * honor the capture (the caller then runs the SVG engine on the same clone).
 *
 * @param {object} state - capture state: `clone`, `element`, and the assembled CSS strings
 * @param {object} context - normalized capture context
 * @param {import('../core/session.js').CaptureSession} session - receives `artifacts` on success
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export async function tryCanvasEngine(state, context, session) {
  const drawApi = detectDrawApi()
  if (!drawApi) return null

  const element = state.element
  const clone = state.clone
  if (!element || !clone) return null

  // The native engine paints one plain, untransformed element box. Root/document expansion,
  // bbox transforms, bleed and scroll anchoring still belong to the SVG engine.
  const doc = element.ownerDocument || document
  if (!element.isConnected || doc !== document) return null
  if (element === doc.body || element === doc.documentElement) return null
  if (element.scrollTop || element.scrollLeft) return null
  if (context.outerShadows || context.clip || context.excludeMode === 'remove' ||
      (typeof context.filter === 'function' && context.filterMode === 'remove')) return null
  if (context.width != null || context.height != null) return null
  try {
    // The mounted clone has none of the ancestors whose transforms/zoom getBoundingClientRect
    // includes, so those go to the svg engine, along the composed chain (slots, shadow hosts).
    // A root filter paints past the box and needs the svg bleed math too.
    for (let box = element; box; box = box.assignedSlot || box.parentElement || box.getRootNode?.().host) {
      const style = getComputedStyle(box)
      if (style.transform && style.transform !== 'none') return null
      if (style.rotate && style.rotate !== 'none') return null
      if (style.scale && style.scale !== 'none') return null
      if (style.translate && style.translate !== 'none') return null
      if (box === element && style.filter && style.filter !== 'none') return null
      const zoom = style.getPropertyValue('zoom')
      if (zoom && Number.isFinite(parseFloat(zoom)) && Math.abs(parseFloat(zoom) - 1) > 0.0001) return null
    }
  } catch {
    return null
  }

  /* c8 ignore start -- the pinned Playwright Chromium predates the API (Chrome 157). The
     suite exercises this contract through a CanvasRenderingContext2D stub that performs real
     2D paints/probes; the native paint is checked by hand with scripts/live-parity.mjs. */
  const rect = element.getBoundingClientRect()
  // With transforms bailed above this is the local border box, unrounded unlike offsetWidth.
  const width = Math.max(1, rect.width || element.offsetWidth || 1)
  const height = Math.max(1, rect.height || element.offsetHeight || 1)
  // The bitmap box is the svg engine's whole pixels: fractional, toCanvas cut a 195.5px root
  // to 195 rows where svg gave 196 (d42, d549 in live parity, 2026-10-26).
  const boxW = element.offsetWidth || Math.ceil(width)
  const boxH = element.offsetHeight || Math.ceil(height)
  const scale = Number.isFinite(context.scale) && context.scale > 0 ? context.scale : 1
  const dpr = Number.isFinite(context.dpr) && context.dpr > 0 ? context.dpr : (window.devicePixelRatio || 1)
  const outW = Math.max(1, Math.round(boxW * scale * dpr))
  const outH = Math.max(1, Math.round(boxH * scale * dpr))

  const css = (state.scrollbarCSS || '') + (state.baseCSS || '') + (state.fontsCSS || '') + (state.classCSS || '')
  const { canvas, wrapper } = mountClone(clone, css, width, height)
  canvas.width = outW
  canvas.height = outH
  document.body.appendChild(canvas)

  let out
  try {
    canvas.getBoundingClientRect() // force layout of the subtree
    // One rendering update records the drawable snapshot (no requestPaint, see the header): a
    // task queued from rAF runs once it has painted, 16 against 33 ms for a double rAF in
    // Chrome 155 (2026-10-26). Drawing before any snapshot throws into the SVG fallback.
    // Bounded like toCanvas's frame(): a hidden Chromium 152 window stalled rAF ~2s per
    // capture (Electron probe, 2026-09-03).
    await new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 50) })
    const ctx2d = canvas.getContext('2d')
    const fn = ctx2d && ctx2d[drawApi]
    if (typeof fn !== 'function') return null
    ctx2d.save()
    ctx2d.scale(dpr * scale, dpr * scale)
    fn.call(ctx2d, wrapper, 0, 0, width, height)
    ctx2d.restore()

    // Taint probe: dev-trial builds tainted unconditionally, and a taint breaks every
    // toDataURL/toBlob, so fall back to the SVG engine on the same clone.
    let probe
    try {
      probe = ctx2d.getImageData(0, 0, Math.min(64, outW), Math.min(64, outH)).data
    } catch {
      debugWarn(context, `html-in-canvas: ${drawApi} tainted the canvas; used the SVG engine.`)
      return null
    }
    // Blank probe: a mount that skipped the paint pass draws nothing; do not return that.
    let ink = false
    for (let i = 3; i < probe.length; i += 4) { if (probe[i] > 0) { ink = true; break } }
    if (!ink) {
      const full = ctx2d.getImageData(0, 0, outW, outH).data
      let any = false
      for (let i = 3; i < full.length; i += 4) { if (full[i] > 0) { any = true; break } }
      if (!any) return null
    }

    // Copy to a clean canvas with no children or attributes, free of the mount.
    out = document.createElement('canvas')
    out.width = outW
    out.height = outH
    out.getContext('2d').drawImage(canvas, 0, 0)
    out.style.width = `${boxW * scale}px`
    out.style.height = `${boxH * scale}px`
  } catch (error) {
    debugWarn(context, 'html-in-canvas: the browser couldn\'t paint it; used the SVG engine.', error)
    return null
  } finally {
    // The clone goes with the mount; on a bail the SVG engine re-parents `state.clone`.
    try { canvas.remove() } catch { /* ok */ }
  }
  // The SVG engine's post-render contract, then drop the clone and maps (they double memory).
  const meta = Object.freeze({
    w0: width,
    h0: height,
    vbW: boxW,
    vbH: boxH,
    targetW: width,
    targetH: height,
    contentX: 0,
    contentY: 0,
    clip: null,
  })
  Object.defineProperty(context, 'meta', {
    value: meta, enumerable: true, writable: false, configurable: true,
  })
  session.artifacts = {
    classCSS: state.classCSS || '',
    fontsCSS: state.fontsCSS || '',
    baseCSS: state.baseCSS || '',
    scrollbarCSS: state.scrollbarCSS || '',
  }
  state.clone = state.nodeMap = state.styleCache = state.svgString = null

  // getDefaultStyleForTag's short-lived measurement host belongs to this module instance;
  // never remove an author node that merely reused the public legacy id.
  const sandbox = [...document.querySelectorAll('#snapdom-sandbox')].find(isInternalNode)
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove()
  return out
  /* c8 ignore stop */
}
