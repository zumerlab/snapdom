/**
 * SVG render engine: the default way a finished clone becomes pixels.
 *
 * The capture pipeline splits at the clone. `captureDOM` (src/core/capture.js) owns
 * `element -> clone`: it freezes the subtree, snapshots styles, inlines images and fonts, and
 * hands over a self-contained clone plus the CSS that styles it. Everything in this file
 * owns `clone -> render`: base reset, bbox and bleed math, foreignObject assembly and SVG
 * data-URL encoding. Those are the same two halves `stages.js` already names.
 *
 * This is an ENGINE, not core: it is what core does by default, not what core is. The
 * experimental canvas engine (htmlInCanvas.js) is meant to be its peer, consuming the same
 * finished clone rather than reaching back to the live page.
 *
 * Also re-entered by burst's differential recapture, which rebuilds only dirty subtrees and
 * composes again from retained state.
 *
 * @module engines/svg
 */

import { isSafari, getStyle } from '../utils/index.js'
import { cache } from '../core/cache.js'
import { runHook } from '../core/plugins.js'
import {
  assembleCaptureCSS,
  estimateKeptHeight,
  limitDecimals,
  reconcileCloneLayout,
  composeResidual2D
} from '../utils/capture.helpers.js'
import {
  parseBoxShadow,
  parseTextShadow,
  parseFilterBlur,
  parseOutline,
  parseFilterDropShadows,
  bboxWithOriginFull,
  parseTransformOriginPx,
  readIndividualTransforms,
  readTotalTransformMatrix,
  hasBBoxAffectingTransform,
  measureSubtreeBleed
} from '../utils/transforms.helpers.js'

/**
 * Intern repeated inline style attributes as attribute-selector rules in the serialized
 * markup. Author inline styles are copied verbatim onto every clone node, so a repetitive
 * tree (tables, lists, grids) serializes the same declaration block thousands of times:
 * measured on a 500-row table, 3005 style attributes with 12 distinct values — 1.6MB of
 * SVG that the raster stage then has to parse, cascade and lay out (52.6ms -> 37.4ms
 * fresh-decode draw after interning, byte-identical pixels; the encodeURIComponent and
 * serialize stages shrink with it).
 *
 * String-level on purpose: the retained clone is never touched, so burst keeps its
 * artifacts and a differential recapture — which re-serializes through this same path —
 * re-interns consistently. A rule carries the exact declaration text the attribute had,
 * so importance is preserved ([data-sdi] at 0,1,0 beats the class CSS by order, matching
 * what the inline attribute did by level). Safari is excluded: fixSafariShadows rewrites
 * shadow values in style attributes and has not been taught to look inside the sheet.
 * Pinned by __tests__/engine.svg.intern.test.js.
 * @param {string} foString serialized <foreignObject> markup (first <style> holds the CSS)
 * @returns {string}
 */
function internInlineStyles(foString) {
  if (isSafari()) return foString
  const styleClose = foString.indexOf('</style>')
  if (styleClose === -1) return foString
  // Author <style> elements survive into the clone and their CSS text may contain the
  // literal sequence the attribute regex matches (attribute selectors, content strings).
  // Split the markup into style-element spans and everything else, and transform only the
  // latter. Span 0 ends inside the engine's own style tag, where the rules are injected.
  const STYLE_SPAN = /<style\b[^>]*>[\s\S]*?<\/style>/g
  const segments = []
  let cursor = styleClose
  let sm
  STYLE_SPAN.lastIndex = styleClose
  while ((sm = STYLE_SPAN.exec(foString))) {
    segments.push({ text: foString.slice(cursor, sm.index), intern: true })
    segments.push({ text: sm[0], intern: false })
    cursor = STYLE_SPAN.lastIndex
  }
  segments.push({ text: foString.slice(cursor), intern: true })
  const counts = new Map()
  const ATTR = / style="([^"]*)"/g
  let m
  for (const seg of segments) {
    if (!seg.intern) continue
    ATTR.lastIndex = 0
    while ((m = ATTR.exec(seg.text))) counts.set(m[1], (counts.get(m[1]) || 0) + 1)
  }
  // Worth it only when real bytes repeat: singletons stay inline (a rule per unique node
  // would add cascade work for nothing), and a page with little repetition skips the pass.
  let saved = 0
  for (const [css, n] of counts) { if (n > 1) saved += (n - 1) * css.length }
  if (saved < 2048) return foString
  const tokens = new Map()
  let nextToken = 0
  const rules = []
  const swap = (full, css) => {
    if ((counts.get(css) || 0) < 2) return full
    let t = tokens.get(css)
    if (t === undefined) {
      t = 'i' + (nextToken++).toString(36)
      tokens.set(css, t)
      rules.push(`[data-sdi="${t}"]{${css}}`)
    }
    return ` data-sdi="${t}"`
  }
  let out = ''
  for (const seg of segments) out += seg.intern ? seg.text.replace(ATTR, swap) : seg.text
  return foString.slice(0, styleClose) + rules.join('') + out
}

/**
 * Turn the finished clone into an SVG data URL.
 *
 * The compose and serialize tail of the pipeline: base reset, bbox and bleed math,
 * foreignObject assembly and encoding. Shared by captureDOM and burst's differential
 * recapture, which rebuilds only dirty subtrees and re-enters here with retained state.
 * `state` is the capture context itself or, from diff, a wrapper carrying element/options/
 * plugins/clone/classCSS/styleCache/nodeMap that is folded back onto that context. On the
 * way out it writes `options.meta` (the public geometry) and `options.__artifacts` (the CSS
 * strings export plugins read), then drops the clone and maps from the context.
 * @param {object} state - capture context, or diff's wrapper around one
 * @param {{clipWindow: object|null, outerTransforms: boolean, outerShadows: boolean|'subtree', rootTransform2D: object|null, fontsCSS: string}} ex
 * @returns {Promise<string>} SVG data URL
 */
export async function composeAndSerialize(state, ex) {
  const { clipWindow, outerTransforms, outerShadows, rootTransform2D, fontsCSS } = ex
  const options = state.options
  // ONE context: burst's differential recapture hands a wrapper carrying the rebuilt clone,
  // so fold it onto the capture context and keep every hook below on that single object.
  // That context is a FRESH one (its call never entered captureDOM), so the self-reference
  // has to be (re)established here — everything below reads `state.options`. The wrapper's
  // own `options` is excluded from the fold: it IS the target, so copying it back would
  // either overwrite the pinned self-reference with an enumerable cycle or, on a context
  // that already carries it, throw in strict mode.
  if (state !== options) {
    const { options: _self, ...stageFields } = state
    state = Object.assign(options, stageFields)
    Object.defineProperty(state, 'options', { value: state, configurable: true })
  }
  let dataURL
  let svgString
  // Stamps baseCSS / scrollbarCSS / fontsCSS onto state; everything below reads them there.
  assembleCaptureCSS(state, fontsCSS)
  await runHook('beforeRender', state)

  const csEl = getStyle(state.element)

  const rect = state.element.getBoundingClientRect()
  let w0 = Math.max(1, limitDecimals(state.element.offsetWidth || parseFloat(csEl.width) || rect.width || 1))
  let h0 = Math.max(1, limitDecimals(state.element.offsetHeight || parseFloat(csEl.height) || rect.height || 1))
  // body/documentElement: measure clone in-document to get true content height (Chrome clamps offset/scroll)
  // Use element's ownerDocument for iframe support (#371)
  const elDoc = state.element.ownerDocument || document
  // #449: an iframe doc pinned by rasterizeIframe must be captured at its viewport size.
  // Expanding to scrollHeight there yields a full-page bitmap that gets squashed into the
  // iframe box (overflow:hidden still reports the full scrollable extent).
  // Clip mode: the viewBox is windowed to the clip rect, so the exact full content
  // height is irrelevant — skip the scrollHeight expansion AND the expensive
  // clone-in-document measurement round-trip entirely.
  const isRoot = !clipWindow && (state.element === elDoc.body || state.element === elDoc.documentElement) &&
    !elDoc.documentElement.hasAttribute('data-sd-pinned')
  if (isRoot) {
    const docH = Math.max(
      state.element.scrollHeight || 0,
      elDoc.documentElement?.scrollHeight || 0,
      elDoc.body?.scrollHeight || 0
    )
    const docW = Math.max(
      state.element.scrollWidth || 0,
      elDoc.documentElement?.scrollWidth || 0,
      elDoc.body?.scrollWidth || 0
    )
    if (docH > 0) h0 = Math.max(h0, limitDecimals(docH))
    if (docW > 0) w0 = Math.max(w0, limitDecimals(docW))
    // Also measure clone in a temp container with injected styles (clone may layout differently).
    // PERF-3: cache result per element — this cloneNode(true) + layout round-trip is expensive
    // for large DOMs; reuse when the same element is captured with the same total CSS length.
    //
    // The hint is combined with Math.max, so a STALE one can only ever make the raster too
    // big — and it did: the validity test was (css length, w0), neither of which moves when a
    // list collapses or a route unmounts half the page. The document got shorter, the memo
    // kept the taller measurement, and the capture came back with a band of empty pixels at
    // the bottom that no later capture could shrink. docH/docW are already read above and
    // track exactly that, so they belong in the key.
    try {
      const cssLen = (state.scrollbarCSS || '').length + (state.baseCSS || '').length +
                     (state.fontsCSS || '').length + (state.classCSS || '').length
      const hint = cache.measureHints.get(state.element)
      if (hint && hint.cssLen === cssLen && hint.w0 === w0 && hint.docH === docH && hint.docW === docW) {
        if (hint.csh > 0) h0 = Math.max(h0, limitDecimals(hint.csh))
        if (hint.csw > 0) w0 = Math.max(w0, limitDecimals(hint.csw))
      } else {
        const wrap = elDoc.createElement('div')
        wrap.setAttribute('data-snapdom-internal', '')
        wrap.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;width:' + w0 + 'px!important;overflow:visible!important;visibility:hidden!important;'
        // Shadow DOM: keeps baseCSS's global tag rules from restyling the live page
        // while this mount is attached (#474) — same isolation as reconcileCloneLayout.
        const mShadow = wrap.attachShadow({ mode: 'open' })
        const styleNode = elDoc.createElement('style')
        styleNode.textContent = (state.scrollbarCSS || '') + state.baseCSS + 'svg{overflow:visible;} foreignObject{overflow:visible;}' + state.classCSS
        mShadow.appendChild(styleNode)
        mShadow.appendChild(state.clone.cloneNode(true))
        elDoc.body.appendChild(wrap)
        const csh = wrap.scrollHeight
        const csw = wrap.scrollWidth
        elDoc.body.removeChild(wrap)
        cache.measureHints.set(state.element, { cssLen, w0, docH, docW, csh, csw })
        if (csh > 0) h0 = Math.max(h0, limitDecimals(csh))
        if (csw > 0) w0 = Math.max(w0, limitDecimals(csw))
      }
    } catch { /* fallback: use doc dimensions above */ }
  }
  // === recompute height using the kept-children span (no offscreen) ===
  if (state.options?.excludeMode === 'remove') {
    const hEst = estimateKeptHeight(state.element, state.options) // border+padding+contentSpan
    // Safety: never larger than the original, with an epsilon so rounding cannot clip
    const EPS = 1 // px
    // …and only shrink a box whose height COMES FROM its content. An author-set height (or
    // min-height, or a stretched flex/grid item) does not shrink in the live DOM when a
    // child is removed, so clamping to the kept span produced a sliver: a 400px card with
    // one excluded button captured 19px tall, losing 381px of visible background. The test
    // is a measurement, not a parse of the specified value — computed `height` reports the
    // used px either way — because a content-sized box's own height already equals
    // border + padding + the span of its children. Boxes whose height comes from
    // absolutely-positioned children fail it too, which is right: contributesToParentHeight
    // deliberately ignores those, so their span is not the height to shrink to.
    const hAll = estimateKeptHeight(state.element, {})
    // Tolerance is proportional, not absolute: a content-sized box is usually a few px
    // TALLER than its children's box span (inline line-box leading, margins the span does
    // not model), and on Firefox a 40px auto card measures a 36px span — an absolute
    // epsilon rejected it and the clamp stopped working there. An imposed height is not a
    // few px off, it is multiples: the 400px card measures the same 36px. The residual is a
    // height set within ~15% of the content height, which mis-shrinks by a few px instead of
    // by the hundreds this replaces.
    const slack = Math.max(2, h0 * 0.15)
    const contentSized = Number.isFinite(hAll) && hAll >= h0 - slack
    if (contentSized && Number.isFinite(hEst) && hEst > 0) {
      h0 = Math.max(1, Math.min(h0, limitDecimals(hEst + EPS)))
    }
    // Width almost never needs the same adjustment; the analogous helper would be estimateKeptWidth(...)
  }
  // Opt-in layout reconciliation: measure the styled clone in-document and pin only the
  // boxes whose size diverges from the live tree (measurement over heuristics).
  if (state.options?.reconcile) {
    try {
      // No fontsCSS here (#474): every embedded face came from this document, so family
      // names already resolve to loaded faces. Re-declaring them as data: URLs makes the
      // fresh (still-loading) faces shadow the loaded ones and both the live tree and the
      // measured clone briefly re-layout with fallback metrics — poisoning every rect.
      const cssAll = (state.scrollbarCSS || '') + state.baseCSS +
        'svg{overflow:visible;} foreignObject{overflow:visible;}' + state.classCSS
      reconcileCloneLayout(state.element, state.clone, cssAll, state.nodeMap, w0, h0)
    } catch (e) {
      console.warn('[snapdom] reconcile pass failed:', e)
    }
  }

  const coerceNum = (v, def = NaN) => {
    const n = typeof v === 'string' ? parseFloat(v) : v
    return Number.isFinite(n) ? n : def
  }

  const optW = coerceNum(state.options.width)
  const optH = coerceNum(state.options.height)
  // Output basis: the element box, or the clip window in clip mode (width/height
  // options and the default output size scale against what will be shown).
  const baseW = clipWindow ? limitDecimals(clipWindow.width) : w0
  const baseH = clipWindow ? limitDecimals(clipWindow.height) : h0
  let w = baseW, h = baseH

  const hasW = Number.isFinite(optW)
  const hasH = Number.isFinite(optH)
  const aspect0 = baseH > 0 ? baseW / baseH : 1

  if (hasW && hasH) {
    w = Math.max(1, limitDecimals(optW))
    h = Math.max(1, limitDecimals(optH))
  } else if (hasW) {
    w = Math.max(1, limitDecimals(optW))
    h = Math.max(1, limitDecimals(w / (aspect0 || 1)))
  } else if (hasH) {
    h = Math.max(1, limitDecimals(optH))
    w = Math.max(1, limitDecimals(h * (aspect0 || 1)))
  }

  // ——— BBOX ———
  let minX = 0, minY = 0, maxX = w0, maxY = h0

  if (clipWindow) {
    // clipWindow is already element-local (frozen at cull time). When the root carries
    // a bbox-affecting transform, its gBCR (used to derive the window) includes the
    // transform's bbox offset while the clone re-applies the residual linear part —
    // shift the window origin by that residual bbox so it isn't applied twice.
    let offX = 0, offY = 0
    if (hasTFBBox(state.element)) {
      let M0 = null
      if (!outerTransforms && rootTransform2D && Number.isFinite(rootTransform2D.a)) {
        M0 = { a: rootTransform2D.a, b: rootTransform2D.b || 0, c: rootTransform2D.c || 0, d: rootTransform2D.d || 1, e: 0, f: 0 }
      } else {
        const indR = readIndividualTransforms(state.element)
        const MR = composeResidual2D(csEl.transform && csEl.transform !== 'none' ? csEl.transform : '', indR)
        if (MR && MR.is2D) M0 = { a: MR.a, b: MR.b, c: MR.c, d: MR.d, e: 0, f: 0 }
      }
      if (M0 && !(M0.a === 1 && M0.b === 0 && M0.c === 0 && M0.d === 1)) {
        const { ox: cox, oy: coy } = parseTransformOriginPx(csEl, w0, h0)
        const bbR = bboxWithOriginFull(w0, h0, M0, cox, coy)
        offX = bbR.minX
        offY = bbR.minY
      }
    }
    minX = limitDecimals(clipWindow.x + offX)
    minY = limitDecimals(clipWindow.y + offY)
    maxX = limitDecimals(minX + clipWindow.width)
    maxY = limitDecimals(minY + clipWindow.height)
  } else if (!outerTransforms && rootTransform2D && Number.isFinite(rootTransform2D.a)) {
    const M2 = {
      a: rootTransform2D.a,
      b: rootTransform2D.b || 0,
      c: rootTransform2D.c || 0,
      d: rootTransform2D.d || 1,
      e: 0,
      f: 0
    }
    const bb2 = bboxWithOriginFull(w0, h0, M2, 0, 0)
    minX = limitDecimals(bb2.minX)
    minY = limitDecimals(bb2.minY)
    maxX = limitDecimals(bb2.maxX)
    maxY = limitDecimals(bb2.maxY)
  } else {
    const useTFBBox = outerTransforms && hasTFBBox(state.element)
    if (useTFBBox) {
      const baseTransform2 = csEl.transform && csEl.transform !== 'none' ? csEl.transform : ''
      const ind2 = readIndividualTransforms(state.element)
      const TOTAL = readTotalTransformMatrix({
        baseTransform: baseTransform2,
        rotate: ind2.rotate || '0deg',
        scale: ind2.scale,
        translate: ind2.translate
      })
      const { ox: ox2, oy: oy2 } = parseTransformOriginPx(csEl, w0, h0)
      const M = TOTAL.is2D ? TOTAL : new DOMMatrix(TOTAL.toString())
      // prepareClone always strips the root's translation (stripTranslate), so the bbox
      // must be computed WITHOUT it — otherwise the foreignObject compensates a shift the
      // clone no longer has and the content renders offset/cut (e.g. the fixed-centering
      // left:50% + translateX(-50%) pattern captured on its own).
      const M0 = { a: M.a, b: M.b, c: M.c, d: M.d, e: 0, f: 0 }
      const bb = bboxWithOriginFull(w0, h0, M0, ox2, oy2)
      minX = limitDecimals(bb.minX)
      minY = limitDecimals(bb.minY)
      maxX = limitDecimals(bb.maxX)
      maxY = limitDecimals(bb.maxY)
    }
  }

  // ——— BLEED ———
  const bleedShadow = parseBoxShadow(csEl)
  const bleedText = parseTextShadow(csEl)
  const bleedBlur = parseFilterBlur(csEl)
  const bleedOutline = parseOutline(csEl)
  const drop = parseFilterDropShadows(csEl)

  // What a child paints past the root's box (outerShadows: 'subtree'). Measured on the page,
  // so the ratio between the bbox and the box it was drawn as says how many root pixels a page
  // pixel is worth: the bbox already carries the root's own transform, so what is left in the
  // ratio is what an ancestor did, and a rotation stretches both boxes alike and correctly
  // comes out as one. Imported from @frostin/snapdom (element-mirror).
  const perX = rect.width > 0 ? (maxX - minX) / rect.width : 1
  const perY = rect.height > 0 ? (maxY - minY) / rect.height : 1
  const subtree = outerShadows === 'subtree' && !clipWindow
    ? measureSubtreeBleed(state.element, state.nodeMap, state.styleCache, perX, perY)
    : { top: 0, right: 0, bottom: 0, left: 0 }

  // A region capture defines its own exact edges — never expand it for root bleed.
  // blur() is not an outer-shadow effect: the root keeps it, so its bleed is
  // always included; shadows/outline/drop-shadow only under outerShadows.
  const bleed = clipWindow
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : outerShadows
      ? {
        top: limitDecimals(Math.max(bleedShadow.top, bleedText.top, subtree.top) + bleedBlur.top + bleedOutline.top + drop.bleed.top),
        right: limitDecimals(Math.max(bleedShadow.right, bleedText.right, subtree.right) + bleedBlur.right + bleedOutline.right + drop.bleed.right),
        bottom: limitDecimals(Math.max(bleedShadow.bottom, bleedText.bottom, subtree.bottom) + bleedBlur.bottom + bleedOutline.bottom + drop.bleed.bottom),
        left: limitDecimals(Math.max(bleedShadow.left, bleedText.left, subtree.left) + bleedBlur.left + bleedOutline.left + drop.bleed.left)
      }
      : { top: bleedBlur.top, right: bleedBlur.right, bottom: bleedBlur.bottom, left: bleedBlur.left }

  minX = limitDecimals(minX - bleed.left)
  minY = limitDecimals(minY - bleed.top)
  maxX = limitDecimals(maxX + bleed.right)
  maxY = limitDecimals(maxY + bleed.bottom)

  const vbW0 = Math.max(1, limitDecimals(maxX - minX))
  const vbH0 = Math.max(1, limitDecimals(maxY - minY))

  const svgNS = 'http://www.w3.org/2000/svg'
  // A transformed root's bbox is fractional, so its far edges land flush against the
  // raster boundary and browsers shave the last 1-2px at some zoom/display scales
  // (Safari always did; Chrome at zoom ≠ 100%). Pad the viewBox so rotated corners
  // never touch the edge. Was Safari-only; the shaving is not.
  const basePad = hasTFBBox(state.element) ? 2 : 0
  const extraPad = !outerTransforms ? 1 : 0
  const pad = limitDecimals(basePad + extraPad)

  // Ceil so a fractional content extent (rotated bbox, fractional bleed) is never
  // truncated when the svg size is rasterized to whole pixels (bottom/right edge loss).
  const vbW = Math.ceil(vbW0 + pad * 2)
  const vbH = Math.ceil(vbH0 + pad * 2)

  // Stable Chrome doesn't paint foreignObject overflow when rasterizing svg-as-image
  // (headless chromium does — don't trust it): the fo must cover the whole viewBox and
  // the bbox offset must move the CONTENT. The offset can't be fo x/y (leaves the
  // top/left band as unpainted overflow) nor position/margin/transform on the fo's
  // root element (Chrome double-paints those at browser zoom ≠ 100%) — padding on the
  // container is the one mechanism that survives both.
  // Negative offsets (clip window right/below the element origin) can't be padding —
  // there fo x/y is safe: the band it leaves unpainted is exactly the culled region.
  const offX = limitDecimals(-(limitDecimals(minX) - pad))
  const offY = limitDecimals(-(limitDecimals(minY) - pad))
  const padL = Math.max(0, offX)
  const padT = Math.max(0, offY)
  const foW = limitDecimals(vbW - Math.min(0, offX))
  const foH = limitDecimals(vbH - Math.min(0, offY))
  const fo = document.createElementNS(svgNS, 'foreignObject')
  fo.setAttribute('x', String(Math.min(0, offX)))
  fo.setAttribute('y', String(Math.min(0, offY)))
  fo.setAttribute('width', String(foW))
  fo.setAttribute('height', String(foH))
  fo.style.overflow = 'visible'

  const styleTag = document.createElement('style')
  // #349/#351: handled per-element in inlineAllStyles (#406) instead of blanket foreignObject rules
  // #327: disable WebKit text autosizer inside the foreignObject. iOS WebKit re-applies
  // text-size-adjust during drawImage, inflating font-size while inlined container heights
  // stay fixed → text crowding. Rule form (not inline) because WebKit expands `all:initial`
  // on the container last and clobbers inline overrides. 100% (not `none`) preserves zoom.
  const foNormalize =
    'svg{overflow:visible;} foreignObject{overflow:visible;} ' +
    'foreignObject>div{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important;}'
  styleTag.textContent =
    (state.scrollbarCSS || '') + state.baseCSS + state.fontsCSS + foNormalize + state.classCSS
  fo.appendChild(styleTag)

  const container = document.createElement('div')
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  // #372: isolate wrapper from iframe CSS cascade (e.g. div { border: 10px solid red })
  // The container spans the whole fo, so the (rotated/bled) content never overflows
  // its border-box — standalone-SVG Chromium clips fo content at the container box.
  container.style.cssText =
    'all:initial;box-sizing:border-box;display:block;overflow:visible;' +
    `width:${foW}px;height:${foH}px` +
    // !important: Chromium 140 serializes the `all:initial` expansion with
    // `padding-inline: initial` AFTER this shorthand, so on data-URL re-parse it
    // would reset the left/right padding (rotated-root offset) unless it loses
    // the cascade to importance.
    ((padL !== 0 || padT !== 0) ? `;padding:${padT}px 0 0 ${padL}px !important` : '')

  //state.clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  container.appendChild(state.clone)
  fo.appendChild(container)

  const serializer = new XMLSerializer()
  const foString = serializer.serializeToString(fo)
  const wantsSize = hasW || hasH

  // Public export geometry. `contentX/contentY` are the exact viewBox-space origin of
  // the logical capture box; unlike `(vbW - w0) / 2`, they stay correct for asymmetric
  // shadow bleed, transformed roots and clip windows.
  const captureMeta = Object.freeze({
    w0: baseW, h0: baseH, vbW, vbH, targetW: w, targetH: h,
    contentX: limitDecimals(offX + (clipWindow ? minX : 0)),
    contentY: limitDecimals(offY + (clipWindow ? minY : 0)),
    clip: clipWindow
      ? Object.freeze({
        x: limitDecimals(minX), y: limitDecimals(minY),
        width: baseW, height: baseH,
      })
      : null,
  })
  // The context continues through afterRender and every later export. Pin the binding as
  // well as freezing the value so a hook cannot desynchronise the canonical SVG from the
  // geometry consumers read. Stays CONFIGURABLE: `options` is caller-owned here (a direct
  // captureDOM call reuses its bag), so a second capture must be able to redefine it
  // instead of throwing "Cannot redefine property". Strict mode still rejects plain
  // assignment, which is the write this guards against.
  Object.defineProperty(options, 'meta', {
    value: captureMeta, enumerable: true, writable: false, configurable: true,
  })

  // `width`/`height` are the ABSOLUTE OUTPUT SIZE — "one rule across all exporters"
  // (types/snapdom.d.ts, README) — and every exporter applies exactly that, mapping the whole
  // viewBox onto the requested box. The header used to encode a different rule: it sized the
  // svg so the ELEMENT came out `w` wide, which makes the total larger by the bleed. The same
  // capture therefore rendered its element at 400px through toRaw()/toBlob({format:'svg'})
  // and at 308px through toPng()/toCanvas(), for a 200px box with a 30px shadow. The header
  // follows the documented rule now; the Safari branch is untouched, since toImg patches
  // these attributes itself to keep that path vector.
  const svgOutW = (!wantsSize || isSafari())
    ? vbW
    : (hasW ? w : limitDecimals(vbW * (h / vbH)))
  const svgOutH = (!wantsSize || isSafari())
    ? vbH
    : (hasH ? h : limitDecimals(vbH * (w / vbW)))

  const rootFontSize = parseFloat(getStyle(elDoc.documentElement)?.fontSize) || 16
  const svgHeader = `<svg xmlns="${svgNS}" width="${svgOutW}" height="${svgOutH}" viewBox="0 0 ${vbW} ${vbH}" font-size="${rootFontSize}px">`
  const svgFooter = '</svg>'
  svgString = svgHeader + internInlineStyles(foString) + svgFooter
  dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
  state.svgString = svgString
  state.dataURL = dataURL
  // Render artifacts for export plugins (toHtml et al) — the CSS strings the pipeline
  // already holds, so export code never reverse-parses its own data URL. svgString stays
  // OUT (it doubles retained memory): exporters decode it lazily from the url.
  options.__artifacts = {
    classCSS: state.classCSS || '',
    fontsCSS: state.fontsCSS || '',
    baseCSS: state.baseCSS || '',
    scrollbarCSS: state.scrollbarCSS || '',
  }
  // afterRender(context)
  await runHook('afterRender', state)
  // Release the heavy stage fields once the last render hook has seen them: the result closes
  // over this context, so retaining the clone tree plus a second copy of the SVG source would
  // double what a live result holds. Export hooks never reached them anyway (the context did
  // not carry them before), and they read `url` / `__artifacts` instead.
  state.clone = state.nodeMap = state.styleCache = state.svgString = null

  const sandbox = document.getElementById('snapdom-sandbox')
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove()
  return state.dataURL
}

/** Whether the root carries a transform that moves its bbox. A local name for
 *  hasBBoxAffectingTransform, nothing more. */
function hasTFBBox(el) {
  return hasBBoxAffectingTransform(el)
}
