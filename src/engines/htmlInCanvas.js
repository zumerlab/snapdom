/**
 * Second render engine: WICG html-in-canvas (`ctx.drawElementImage`), opt-in through
 * `engine: 'html-in-canvas'`. Paints with the browser's OWN painter, so scrollbars and native
 * controls come out as the page draws them and none of the svg-as-image quirks apply. It paints
 * the clone, so a control the clone already draws differently looks as it does in the svg
 * engine: `<audio controls>` is a drawn player (#444), and a bare `<progress>` or `<meter>`
 * loses Chromium's native look (Chrome 157, 2026-10-28, docs/labs/into-the-dock/).
 *
 * IT IS A PEER OF engines/svg.js. Both take the SAME input, the finished clone, and differ
 * only in how they turn it into pixels. That is the whole reason this belongs to snapdom
 * rather than to the caller: an engine that re-copied the LIVE element would be doing what
 * any page can already do with drawElement, and would throw away the work the clone
 * represents. It used to do exactly that, which is why it had to bail on plugins, clip,
 * exclude and reconcile: it skipped the passes that implement them. Now it mounts the clone
 * core hands it, with the CSS core assembled, so those features come for free.
 *
 * CONTRACT WITH CORE: everything lives in src/engines/; core's only knowledge is the
 * lazy-import seam in captureDOM behind the opt-in option. On ANY doubt (API missing,
 * unsupported options, tainted or blank paint) it returns null and the caller runs the SVG
 * engine on the same clone. Correctness never depends on this module. It is opt-in, not the
 * default, on the speed goal: the native paint waits for a rendering update, about 35 ms on
 * a card where the svg engine takes 3 (BENCHMARKS.md, "SVG vs html-in-canvas"); it is the
 * fidelity engine for scrollbars and native parts, not the fast one.
 *
 * PLATFORM STATUS. Chrome 157 ships the API without a flag (developer.chrome.com/blog/
 * html-in-canvas; MDN BCD marks `drawElementImage`, `content="drawable"`, `drawable` and
 * `requestPaint` stable in 157). Firefox and WebKit have no implementation, so there every
 * capture lands in the svg engine through `detectDrawApi`. Before 157 it was an origin
 * trial (M148 to M160) and chrome://flags/#canvas-draw-element: first verified in real
 * Chrome 148 (2026-09-03); on 2026-10-26, in Chrome 155, live parity (scripts/live-parity.mjs
 * against the page's own screenshot) put every demo this engine accepts at or below the svg
 * engine's mismatch. The spec model is "read-back-allowed rendering": sensitive content
 * (cross-origin iframes/images/url() refs, :visited, system colors, IME, subpixel AA) is
 * left out of the paint instead of tainting the canvas. That is why this engine draws the
 * FINISHED CLONE and not the live element: the pipeline has already inlined cross-origin
 * images and fonts into it, so nothing in it is withheld. The taint probe below stays as
 * the safety net for anything the spec still withholds.
 *
 * Contract this module follows: `drawable` on the drawn element, and on the canvas both
 * `content="drawable"` (the shipped name) and `layoutsubtree` (what the trial builds
 * through Chrome 155, and Chromium forks still on them, check). Snapshots are recorded on
 * every rendering update, so one update after the mount is the sync point.
 * `canvas.requestPaint()` is never called: in Chrome 155 a removed canvas that had
 * requested a paint crashed the renderer at the next iframe created in the page, and the
 * svg engine's `toCanvas` creates one for every decode (2026-10-26).
 *
 * NOT OPTIMIZED. The mount/draw path is deliberately the simplest thing that consumes the
 * clone: no bbox/bleed math, document-root expansion or scroll anchoring. Those bails are
 * listed in `tryCanvasEngine`.
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
 * No ancestor shells and no live-DOM copying. The clone already carries every computed
 * style it needs as generated classes, so the page's cascade is irrelevant here — which is
 * also why `all:initial` on the wrapper is safe and wanted: it isolates the mount from the
 * host page exactly the way the foreignObject container does in the SVG engine.
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
  // In-flow and painted (hidden/offscreen skips the paint pass → "no paint record"),
  // but behind everything.
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-2147483647;pointer-events:none'

  const wrapper = document.createElement('div')
  // `drawable` is required by the OT contract for the element handed to drawElementImage
  // (it implies isolation:isolate — already wanted here) and is inert on legacy builds.
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
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export async function tryCanvasEngine(state, context) {
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
    // getBoundingClientRect includes transforms/zoom from every rendered ancestor, but the
    // mounted clone no longer has those ancestors. Let SVG's local-box math handle these
    // cases instead of shrinking the native wrapper and clipping the untransformed clone.
    // Follow the composed parent chain so a transformed shadow wrapper around a slot is
    // covered too. Root filters can paint outside the box and also require SVG's bleed math.
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
  // Root and ancestor transforms/zoom already bail above, so this is the local border box.
  // Prefer it over offsetWidth/offsetHeight, which round fractional CSS pixels to integers.
  const width = Math.max(1, rect.width || element.offsetWidth || 1)
  const height = Math.max(1, rect.height || element.offsetHeight || 1)
  // The bitmap box is the svg engine's: offsetWidth/offsetHeight, whole pixels. Published
  // fractional, toCanvas (which sizes from meta.vbW/vbH; a canvas truncates) cut a 195.5px
  // root to 195 rows where the svg engine gave 196 (d42, d549 in live parity, 2026-10-26).
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
    // One rendering update after the mount records the drawable snapshot (no requestPaint,
    // see the header): the rAF callback runs at its start and a task queued from it runs
    // once it has painted. That is half the double rAF it replaced, 16 against 33 ms in
    // Chrome 155, with every probe drawn from a fresh snapshot, data-URL images included
    // (2026-10-26). Drawing before any snapshot throws, which lands in the SVG fallback
    // below. The wait is bounded (same pattern as toCanvas's frame()): browsers throttle or
    // suspend rAF in hidden/occluded windows, and an unguarded double rAF measured a flat
    // ~2s per capture in a hidden Chromium 152 window (Electron probe, 2026-09-03).
    await new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 50) })
    const ctx2d = canvas.getContext('2d')
    const fn = ctx2d && ctx2d[drawApi]
    if (typeof fn !== 'function') return null
    ctx2d.save()
    ctx2d.scale(dpr * scale, dpr * scale)
    fn.call(ctx2d, wrapper, 0, 0, width, height)
    ctx2d.restore()

    // Taint probe: under the shipped model a same-origin clone reads back cleanly, but the
    // dev-trial builds tainted unconditionally and spec churn could reintroduce cases. Any
    // taint would break every toDataURL/toBlob downstream, so fall back to the SVG engine,
    // which has already fetched and inlined those resources into this very clone.
    let probe
    try {
      probe = ctx2d.getImageData(0, 0, Math.min(64, outW), Math.min(64, outH)).data
    } catch {
      debugWarn(context, `html-in-canvas: ${drawApi} tainted the canvas; used the SVG engine.`)
      return null
    }
    // Blank probe: a mount that skipped the paint pass draws nothing — don't hand the
    // caller an empty capture when the element visibly has content.
    let ink = false
    for (let i = 3; i < probe.length; i += 4) { if (probe[i] > 0) { ink = true; break } }
    if (!ink) {
      const full = ctx2d.getImageData(0, 0, outW, outH).data
      let any = false
      for (let i = 3; i < full.length; i += 4) { if (full[i] > 0) { any = true; break } }
      if (!any) return null
    }

    // Detach the bitmap from the mounted DOM: copy to a clean canvas so removing the mount
    // doesn't matter and the returned canvas has no children/attributes.
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
    // Removing the mount takes the clone with it. That is fine on the success path, and on
    // a bail the caller still holds `state.clone` and the SVG engine re-parents it.
    try { canvas.remove() } catch { /* ok */ }
  }
  // Publish the same post-render contract as the SVG engine, then release capture-only
  // state. The bitmap keeps its own pixels; retaining the detached clone/maps doubles memory.
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
  context.__artifacts = {
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
