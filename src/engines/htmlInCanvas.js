/**
 * EXPERIMENTAL render engine: WICG html-in-canvas (`ctx.drawElementImage`, Chrome 148+
 * origin trial / chrome://flags/#canvas-draw-element; the M138-era dev trial shipped the
 * same thing as `drawElement`). Paints with the browser's OWN painter, so native form
 * controls come out right and none of the svg-as-image quirks apply.
 *
 * IT IS A PEER OF engines/svg.js. Both take the SAME input, the finished clone, and differ
 * only in how they turn it into pixels. That is the whole reason this belongs to snapdom
 * rather than to the caller: an engine that re-copied the LIVE element would be doing what
 * any page can already do with drawElement, and would throw away the work the clone
 * represents. It used to do exactly that, which is why it had to bail on plugins, clip,
 * exclude and reconcile: it skipped the passes that implement them. Now it mounts the clone
 * core hands it, with the CSS core assembled, so those features come for free.
 *
 * QUARANTINE CONTRACT (this feature is green): everything lives in src/engines/ — core's
 * only knowledge is a lazy-import seam in captureDOM behind the opt-in `engine: 'html-in-canvas'`
 * option. On ANY doubt (API missing, unsupported options, tainted or blank paint) it
 * returns null and the caller runs the SVG engine. Correctness never depends on this module.
 *
 * PLATFORM STATUS — VERIFIED ACTIVE in real Chrome (2026-09-03, M148+ with
 * chrome://flags/#canvas-draw-element): detectDrawApi() found drawElementImage, the mounted
 * clone painted, the taint probe passed and the capture came back as a PNG data URL —
 * the first happy-path run on real hardware. Spec context (same date): the old
 * unconditional taint is GONE as a model — the spec is "read-back-allowed rendering":
 * sensitive content (cross-origin iframes/images/url() refs, :visited, system colors, IME,
 * subpixel AA) is EXCLUDED FROM PAINTING instead of tainting, so readback works on Chrome
 * 148+ (origin trial through M154). That exclusion is exactly why this engine draws the
 * FINISHED CLONE and not the live element: the pipeline has already fetched and inlined
 * cross-origin images/fonts into it, making the clone same-origin by construction — native
 * paint fidelity AND full content AND readback. The taint probe below stays as the safety
 * net for pre-OT builds and anything the spec still withholds.
 *
 * OT contract this module follows: `layoutsubtree` on the canvas, `drawable` on the drawn
 * element, snapshots recorded on every rendering update with the `paint` event (after
 * `canvas.requestPaint()`) as the sync point. On builds without `requestPaint` (the M138
 * dev trial) the double-rAF wait alone is the rendering update.
 *
 * NOT OPTIMIZED. The mount/draw path is deliberately the simplest thing that consumes the
 * clone: no bbox/bleed math, document-root expansion or scroll anchoring. Those bails are
 * listed in `tryCanvasEngine`.
 * @module engines/htmlInCanvas
 */

import { debugWarn } from '../utils/debug.js'
import { isInternalNode, markInternalNode } from '../utils/ownership.js'

/**
 * Which canvas-place-element method this browser exposes, or null. The origin-trial name
 * (`drawElementImage`) is checked before the M138 dev-trial one. Null sends every capture to
 * the svg engine, which is where every unflagged browser lands today.
 * @returns {'drawElementImage'|'drawElement'|null}
 */
export function detectDrawApi() {
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return null
    if (typeof ctx.drawElementImage === 'function') return 'drawElementImage'
    if (typeof ctx.drawElement === 'function') return 'drawElement'
  } catch { /* detection is best-effort */ }
  return null
}

/**
 * Mount the FINISHED CLONE for painting: canvas[layoutsubtree] > wrapper > (style + clone).
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

  const styleNode = document.createElement('style')
  styleNode.textContent = css
  wrapper.appendChild(styleNode)
  wrapper.appendChild(clone)
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

  /* c8 ignore start -- the real API still needs a flag/origin trial. CI exercises this
     contract through a CanvasRenderingContext2D stub that performs real 2D paints/probes;
     re-measure the native implementation on a flagged Chrome before enabling by default. */
  const rect = element.getBoundingClientRect()
  // Root and ancestor transforms/zoom already bail above, so this is the local border box.
  // Prefer it over offsetWidth/offsetHeight, which round fractional CSS pixels to integers.
  const width = Math.max(1, rect.width || element.offsetWidth || 1)
  const height = Math.max(1, rect.height || element.offsetHeight || 1)
  const scale = Number.isFinite(context.scale) && context.scale > 0 ? context.scale : 1
  const dpr = Number.isFinite(context.dpr) && context.dpr > 0 ? context.dpr : (window.devicePixelRatio || 1)
  const outW = Math.max(1, Math.round(width * scale * dpr))
  const outH = Math.max(1, Math.round(height * scale * dpr))

  const css = (state.scrollbarCSS || '') + (state.baseCSS || '') + (state.fontsCSS || '') + (state.classCSS || '')
  const { canvas, wrapper } = mountClone(clone, css, width, height)
  canvas.width = outW
  canvas.height = outH
  document.body.appendChild(canvas)

  let out
  try {
    canvas.getBoundingClientRect() // force layout of the subtree
    // A rendering update records the drawable snapshot; on OT builds the `paint` event
    // (armed by requestPaint) is the sync point that guarantees it is current. Bounded:
    // a missed event just draws after the rAF wait and the blank probe below catches it.
    // The rAF itself is bounded too (same pattern as toCanvas's frame()): browsers
    // throttle or suspend rAF in hidden/occluded windows, and an unguarded double-rAF
    // measured as a flat ~2s per capture in a hidden Chromium 152 window (Electron probe,
    // 2026-09-03) — the engine must not stall where the svg path would not.
    const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50) })
    await frame()
    await frame()
    if (typeof canvas.requestPaint === 'function') {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 200)
        canvas.addEventListener('paint', () => { clearTimeout(t); resolve() }, { once: true })
        canvas.requestPaint()
      })
    }
    const ctx2d = canvas.getContext('2d')
    const fn = ctx2d && ctx2d[drawApi]
    if (typeof fn !== 'function') return null
    ctx2d.save()
    ctx2d.scale(dpr * scale, dpr * scale)
    fn.call(ctx2d, wrapper, 0, 0, width, height)
    ctx2d.restore()

    // Taint probe: under the OT model a same-origin clone reads back cleanly, but pre-OT
    // builds tainted unconditionally and future spec churn could reintroduce cases — any
    // taint would break every toDataURL/toBlob downstream, so fall back to the SVG engine,
    // which has already fetched and inlined those resources into this very clone.
    let probe
    try {
      probe = ctx2d.getImageData(0, 0, Math.min(64, outW), Math.min(64, outH)).data
    } catch {
      debugWarn(context, `engine:'html-in-canvas': ${drawApi} painted but the canvas is tainted (pre-origin-trial build?) — falling back to the svg engine`)
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
    out.style.width = `${Math.round(width * scale)}px`
    out.style.height = `${Math.round(height * scale)}px`
  } catch (error) {
    debugWarn(context, "engine:'html-in-canvas': native paint failed — falling back to the svg engine", error)
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
    vbW: width,
    vbH: height,
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
