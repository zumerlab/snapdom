/**
 * EXPERIMENTAL render engine: WICG canvas-place-element (`ctx.drawElement`, Chrome ~130+
 * behind chrome://flags/#canvas-draw-element; older flagged builds shipped
 * `drawElementImage`). Paints with the browser's OWN painter, so native form controls come
 * out right and none of the svg-as-image quirks apply.
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
 * only knowledge is a lazy-import seam in captureDOM behind the opt-in `engine: 'canvas'`
 * option. On ANY doubt (API missing, unsupported options, tainted or blank paint) it
 * returns null and the caller runs the SVG engine. Correctness never depends on this module.
 *
 * PLATFORM STATUS (verified 2026-07-25, flagged Chromium via --enable-blink-features=
 * CanvasDrawElement): drawElement PAINTS pixel-perfectly, including native form controls the
 * svg pipeline cannot reproduce, but currently TAINTS the canvas unconditionally, even for
 * fully local content. No readback (getImageData/toBlob/toDataURL) means no encodable
 * exports, so the taint probe below sends every capture to the SVG engine today. The day
 * Chromium ships same-origin readback this lights up with no code changes.
 *
 * NOT OPTIMIZED. The mount/draw path is deliberately the simplest thing that consumes the
 * clone: no bbox/bleed math, no size overrides. Those bails are listed in `tryCanvasEngine`.
 * @module engines/htmlInCanvas
 */

import { debugWarn } from '../utils/debug.js'

/**
 * Which canvas-place-element method this browser exposes, or null. Null sends every capture
 * to the svg engine, which is where every shipping browser lands today.
 * @returns {'drawElement'|'drawElementImage'|null}
 */
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
  canvas.setAttribute('data-snapdom-internal', '')
  // In-flow and painted (hidden/offscreen skips the paint pass → "no paint record"),
  // but behind everything.
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-2147483647;pointer-events:none'

  const wrapper = document.createElement('div')
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

  // Remaining bails, and they are about GEOMETRY only now, not about pipeline features:
  // the canvas is sized to the element box, so anything that changes the output box needs
  // the bbox/bleed math that lives in the SVG engine.
  if (context.outerShadows) return null
  if (Number.isFinite(context.width) || Number.isFinite(context.height)) return null
  if (context.clip) return null

  /* c8 ignore start -- everything below needs a browser that actually exposes
     ctx.drawElement. It ships behind chrome://flags/#canvas-draw-element only, so
     `detectDrawApi()` returns null in every CI browser and this code is unreachable by
     construction — not untested. The reachable half (detection + every bail above, the
     part that guarantees the SVG engine still runs) IS covered by engines.htmlInCanvas.test.js.
     Re-measure when Chromium ships same-origin readback and the engine can be enabled. */
  const rect = element.getBoundingClientRect()
  const width = Math.max(1, element.offsetWidth || rect.width || 1)
  const height = Math.max(1, element.offsetHeight || rect.height || 1)
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
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const ctx2d = canvas.getContext('2d')
    const fn = ctx2d && ctx2d[drawApi]
    if (typeof fn !== 'function') return null
    ctx2d.save()
    ctx2d.scale(dpr * scale, dpr * scale)
    fn.call(ctx2d, wrapper, 0, 0, width, height)
    ctx2d.restore()

    // Taint probe: cross-origin content painted by drawElement taints the canvas and would
    // break every toDataURL/toBlob downstream — fall back to the SVG engine, which has
    // already fetched and inlined those resources into this very clone.
    let probe
    try {
      probe = ctx2d.getImageData(0, 0, Math.min(64, outW), Math.min(64, outH)).data
    } catch {
      debugWarn(context, "engine:'canvas': drawElement painted but the canvas is tainted (current Chromium taints unconditionally) — falling back to the svg engine")
      return null
    }
    // Blank probe: a mount that skipped the paint pass draws nothing — don't hand the
    // caller an empty capture when the element visibly has content.
    let ink = false
    for (let i = 3; i < probe.length; i += 4) { if (probe[i] > 0) { ink = true; break } }
    if (!ink && (element.textContent?.trim() || element.querySelector?.('img,svg,canvas,video'))) {
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
  } finally {
    // Removing the mount takes the clone with it. That is fine on the success path, and on
    // a bail the caller still holds `state.clone` and the SVG engine re-parents it.
    try { canvas.remove() } catch { /* ok */ }
  }
  return out
  /* c8 ignore stop */
}
