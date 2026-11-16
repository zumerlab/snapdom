/**
 * SVG render engine: the default way a finished clone becomes pixels.
 *
 * The pipeline splits at the clone (the halves `stages.js` names). `captureDOM`
 * (src/core/capture.js) owns element to clone and hands over a self-contained clone plus its
 * CSS. This file owns clone to render: base reset, bbox and bleed math, foreignObject
 * assembly and data-URL encoding. It is an ENGINE, not core; htmlInCanvas.js is its peer and
 * consumes the same finished clone, never the live page. Burst's differential recapture
 * re-enters it with retained state.
 *
 * @module engines/svg
 */

import { isSafari, getStyle } from '../utils/index.js'
import { cache } from '../core/cache.js'
import { runHook } from '../core/plugins.js'
import { sessionWarn, debugWarn } from '../utils/debug.js'
import { isInternalNode, markInternalNode } from '../utils/ownership.js'
import {
  assembleCaptureCSS,
  estimateKeptHeight,
  limitDecimals,
  reconcileCloneLayout,
  inertMeasurementCopy,
  adoptShadowCSS,
  anchorPagePositioned,
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
 * Size a body capture along one axis from the body's border box. A scroll extent past
 * `boxEnd` is overflowing content and counts from the body's start; short of it, the
 * difference is margins and the body box is the size.
 * Pinned by __tests__/snapdom.bodyExtent.test.js.
 * @param {number} scroll
 * @param {number} boxEnd
 * @param {number} start - body start, relative to the container
 * @param {number} end - body end, relative to the container
 * @returns {number}
 */
function bodyExtent(scroll, boxEnd, start, end) {
  return scroll > boxEnd + 0.5 ? scroll - start : end - start
}

/**
 * The page's canvas colour (<html>'s background, else the body's) as a declaration for a
 * body capture's container, so the margins and overflow the capture keeps are not
 * transparent (the left spill of a right-to-left page). Colour only: a propagated image keeps
 * painting the body box. Pinned by __tests__/snapdom.rtl.test.js.
 * @param {Document} doc
 * @returns {string}
 */
function canvasBackground(doc) {
  const visible = (c) => c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c)
  const html = getStyle(doc.documentElement).backgroundColor
  const color = visible(html) ? html : getStyle(doc.body).backgroundColor
  return visible(color) ? `;background-color:${color} !important` : ''
}

/** A style signature (getStyleKey, utils/css.js) holding something that paints past the box. */
const OUTER_INK_SIGNATURE = /(?:^|;)(?:box-shadow|text-shadow|outline-style|filter|-webkit-filter):/

/**
 * Intern repeated inline style attributes as attribute-selector rules in the serialized
 * markup. A repetitive tree repeats the same block thousands of times: a 500-row table had
 * 3005 style attributes with 12 distinct values, and interning took its fresh-decode draw from
 * 52.6ms to 37.4ms with identical pixels.
 * String-level on purpose: the retained clone is untouched, so a differential recapture
 * re-interns the same way. A rule's 0,1,0 specificity beats generated classes by order but not
 * author rules with IDs, nor inline !important: those signatures stay inline, as do editable
 * assets. Not on Safari: fixSafariShadows rewrites shadows in style attributes, not in the
 * sheet. Pinned by __tests__/engine.svg.intern.test.js.
 * @param {string} foString serialized <foreignObject> markup (first <style> holds the CSS)
 * @param {Element} fo finished foreignObject, used only if styles compete or assets are editable
 * @returns {string}
 */
function internInlineStyles(foString, fo) {
  if (isSafari()) return foString
  const styleClose = foString.indexOf('</style>')
  if (styleClose === -1) return foString
  // Author <style> text can contain what the attribute regex matches, so only the spans
  // outside <style> elements are transformed. The rules go into the engine's own style tag.
  const segments = []
  let cursor = styleClose
  // The span regex can only match at a literal '<style', which indexOf finds without it.
  if (foString.indexOf('<style', styleClose) !== -1) {
    const STYLE_SPAN = /<style\b[^>]*>[\s\S]*?<\/style>/g
    let sm
    STYLE_SPAN.lastIndex = styleClose
    while ((sm = STYLE_SPAN.exec(foString))) {
      segments.push({ text: foString.slice(cursor, sm.index), intern: true })
      segments.push({ text: sm[0], intern: false })
      cursor = STYLE_SPAN.lastIndex
    }
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
  if (foString.includes(' data-sdi=')) return foString
  const protectedStyles = inlineStylesThatMustStay(fo, segments.some(s => !s.intern), foString.includes('data-snapdom-asset'))
  if (protectedStyles === null) return foString
  const tokens = new Map()
  let nextToken = 0
  const rules = []
  const swap = (full, css) => {
    if ((counts.get(css) || 0) < 2 || protectedStyles.has(css)) return full
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

/** Inline blocks that must keep inline precedence: every element an author selector matches
 *  in the finished tree, so unrelated rules leave interning on. Run only after the byte
 *  threshold. `null` when safety cannot be shown (nesting, namespaces, @import, selectors on
 *  style/data-sdi). No stylesheet is mounted: parsing must never restyle the live page. */
function inlineStylesThatMustStay(fo, hasAuthorStyles, hasEditableAssets) {
  const values = new Set()
  if (!hasAuthorStyles && !hasEditableAssets) return values
  if (!fo) return null
  // Public markers cannot prove our ownership, but avoiding a duplicate XML attribute is
  // necessary regardless of who placed it. Existing data-sdi makes this capture ineligible.
  if (fo.querySelector('[data-sdi]')) return null
  const protect = (node) => {
    const value = node.getAttribute('style')
    if (value) values.add(value)
  }
  if (hasEditableAssets) fo.querySelectorAll('[data-snapdom-asset][style]').forEach(protect)
  if (hasAuthorStyles) {
    try {
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.type === CSSRule.IMPORT_RULE || rule.type === CSSRule.NAMESPACE_RULE) throw new Error('External or namespaced CSS')
          if (rule.selectorText) {
            // Attribute-dependent matching can CHANGE after interning, including inside
            // :not()/:has(). Protecting only the elements that match today is insufficient.
            if (/\[\s*style\b|data-sdi|\[[^\]]*\\|&/i.test(rule.selectorText)) throw new Error('Attribute-dependent or nested CSS')
            fo.querySelectorAll(rule.selectorText).forEach(protect)
          }
          if (rule.cssRules) walk(rule.cssRules)
        }
      }
      for (const style of [...fo.querySelectorAll('style')].slice(1)) {
        const css = style.textContent || ''
        // Constructed stylesheets silently discard @import; don't let that look safe.
        if (/@import\b/i.test(css)) return null
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(css)
        walk(sheet.cssRules)
      }
    } catch { return null }
  }
  // counts holds XML-escaped text and getAttribute decoded text: escape through the
  // serializer itself, once per protected signature.
  const encoded = new Set()
  const probe = document.createElement('div')
  const serializer = new XMLSerializer()
  for (const value of values) {
    probe.setAttribute('style', value)
    const match = serializer.serializeToString(probe).match(/ style="([^"]*)"/)
    if (match) encoded.add(match[1])
  }
  return encoded
}

/**
 * Turn the finished clone into an SVG data URL.
 *
 * Shared by captureDOM and burst's differential recapture. `state` is the capture context or,
 * from diff, a wrapper (element/options/plugins/clone/classCSS/styleCache/nodeMap) folded
 * back onto it. Writes `options.meta` on the context and `layoutZoom`, `fileSvg` and
 * `artifacts` on `ex.session`, then drops the clone and maps. `ex.signatures` (clone to style
 * key) filters the body-room bleed and anchors page-positioned boxes; a differential frame
 * passes null, so it measures every node and does not re-anchor.
 * @param {object} state - capture context, or diff's wrapper around one
 * @param {{clipWindow: object|null, outerTransforms: boolean, outerShadows: boolean|'subtree', rootTransform2D: object|null, fontsCSS: string, universe: Set<string>|null, session: import('../core/session.js').CaptureSession, signatures: Map<Element, string>|null}} ex
 * @returns {Promise<string>} SVG data URL
 */
export async function composeAndSerialize(state, ex) {
  const { clipWindow, outerTransforms, outerShadows, rootTransform2D, fontsCSS, universe, session, signatures } = ex
  const options = state.options
  // ONE context: fold diff's wrapper onto the capture context so every hook sees one object.
  // That context never entered captureDOM, so pin its `options` self-reference here. The
  // wrapper's own `options` stays out of the fold: it IS the target, and copying it would
  // write an enumerable cycle or throw in strict mode.
  if (state !== options) {
    const { options: _self, ...stageFields } = state
    state = Object.assign(options, stageFields)
    Object.defineProperty(state, 'options', { value: state, configurable: true })
  }
  let dataURL
  let svgString
  // Stamps baseCSS / scrollbarCSS / fontsCSS onto state; everything below reads them there.
  assembleCaptureCSS(state, fontsCSS, universe)
  await runHook('beforeRender', state)

  const csEl = getStyle(state.element)

  const rect = state.element.getBoundingClientRect()
  // rootBox: what prepareClone measured before it restored content-visibility.
  const box = session?.rootBox
  let w0 = Math.max(1, limitDecimals(box?.[0] || state.element.offsetWidth || parseFloat(csEl.width) || rect.width || 1))
  let h0 = Math.max(1, limitDecimals(box?.[1] || state.element.offsetHeight || parseFloat(csEl.height) || rect.height || 1))
  // body/documentElement: measure clone in-document to get true content height (Chrome clamps offset/scroll)
  // Use element's ownerDocument for iframe support (#371)
  const elDoc = state.element.ownerDocument || document
  // #449: an iframe doc pinned by rasterizeIframe is captured at its viewport size, or the
  // full page gets squashed into the iframe box. The pin is an option of the nested capture,
  // not an attribute on the frame's <html>: the frame's invalidation observer saw that
  // attribute and killed the outer element's burst memo.
  // Clip mode windows the viewBox, so it skips the expansion and the in-document measurement.
  const isRoot = !clipWindow && (state.element === elDoc.body || state.element === elDoc.documentElement) &&
    !state.__pinned
  // The room between <html> and a captured body, and what the body's descendants paint
  // into it, per side. Null for every other capture.
  let bodyRoom = null
  let bodyInk = null
  // How far a right-to-left body's content overflows to the left of it.
  let rtlSpill = 0
  if (isRoot) {
    let docH = Math.max(
      state.element.scrollHeight || 0,
      elDoc.documentElement?.scrollHeight || 0,
      elDoc.body?.scrollHeight || 0
    )
    let docW = Math.max(
      state.element.scrollWidth || 0,
      elDoc.documentElement?.scrollWidth || 0,
      elDoc.body?.scrollWidth || 0
    )
    // The measurement mount lays the clone out at the document's width, whatever box the
    // capture ends up with.
    const layoutW = Math.max(w0, limitDecimals(docW))
    // The document extents also count the body's margins and child margins collapsing through
    // it, an empty band at the bottom (16px with the default body margin). bodyExtent keeps
    // the document extent only where content overflows the in-flow box.
    const isBody = state.element === elDoc.body
    // A right-to-left page overflows to the left: the extra width goes to rtlSpill, which the
    // bleed turns into room on the left. Grown on the right, the capture clipped the left
    // spill and left as much empty on the right.
    const rtl = isBody && getStyle(elDoc.documentElement).direction === 'rtl'
    const growW = (v) => {
      if (!(v > 0)) return
      if (rtl) rtlSpill = Math.max(rtlSpill, limitDecimals(v - rect.width))
      else w0 = Math.max(w0, limitDecimals(v))
    }
    if (isBody && elDoc.documentElement) {
      const hr = elDoc.documentElement.getBoundingClientRect()
      const room = {
        top: Math.max(0, rect.top - hr.top),
        right: Math.max(0, hr.right - rect.right),
        bottom: Math.max(0, hr.bottom - rect.bottom),
        left: Math.max(0, rect.left - hr.left)
      }
      bodyRoom = room
      if (outerShadows !== 'subtree' && (room.top || room.right || room.bottom || room.left)) {
        // Only a signature with an outer effect can ink the room, so filter by signature:
        // 600-card body (3001 nodes, Chromium, 2026-10-23): 1.9 ms to 0.5 ms. A node with no
        // signature is measured.
        const inked = new Map()
        const candidates = new Map()
        for (const [clone, source] of state.nodeMap) {
          const key = signatures?.get(clone)
          if (key) {
            let has = inked.get(key)
            if (has === undefined) inked.set(key, has = OUTER_INK_SIGNATURE.test(key))
            if (!has) continue
          }
          candidates.set(clone, source)
        }
        const ink = measureSubtreeBleed(state.element, candidates, state.styleCache,
          rect.width > 0 ? w0 / rect.width : 1, rect.height > 0 ? h0 / rect.height : 1)
        bodyInk = {
          top: Math.min(ink.top, room.top),
          right: Math.min(ink.right, room.right),
          bottom: Math.min(ink.bottom, room.bottom),
          left: Math.min(ink.left, room.left)
        }
      }
      docH = Math.max(state.element.scrollHeight || 0,
        bodyExtent(docH, hr.height, rect.top - hr.top, rect.bottom - hr.top))
      docW = Math.max(state.element.scrollWidth || 0, rtl
        ? bodyExtent(docW, hr.width, hr.right - rect.right, hr.right - rect.left)
        : bodyExtent(docW, hr.width, rect.left - hr.left, rect.right - hr.left))
    }
    if (docH > 0) h0 = Math.max(h0, limitDecimals(docH))
    growW(docW)
    // Also measure the styled clone in a temp container; it may lay out differently. The
    // round trip is expensive on large DOMs, so the result is cached per element. docH/docW
    // belong in the key: a stale hint only grows the raster (Math.max), and without them a
    // page that got shorter kept an empty band at the bottom for good.
    try {
      const cssLen = (state.scrollbarCSS || '').length + (state.baseCSS || '').length +
                     (state.fontsCSS || '').length + (state.classCSS || '').length
      const hint = cache.measureHints.get(state.element)
      if (hint && hint.cssLen === cssLen && hint.w0 === layoutW && hint.docH === docH && hint.docW === docW) {
        if (hint.csh > 0) h0 = Math.max(h0, limitDecimals(hint.csh))
        growW(hint.csw)
      } else {
        const wrap = elDoc.createElement('div')
        markInternalNode(wrap)
        wrap.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;width:' + layoutW + 'px!important;overflow:visible!important;visibility:hidden!important;'
        // Shadow DOM keeps baseCSS's tag rules off the live page while mounted (#474), as in
        // reconcileCloneLayout.
        const mShadow = wrap.attachShadow({ mode: 'open' })
        adoptShadowCSS(mShadow, (state.scrollbarCSS || '') + state.baseCSS + 'svg{overflow:visible;} foreignObject{overflow:visible;}' + state.classCSS)
        const copy = mShadow.appendChild(inertMeasurementCopy(state.clone))
        elDoc.body.appendChild(wrap)
        let csh = wrap.scrollHeight
        let csw = wrap.scrollWidth
        if (isBody) {
          // Same margins inside the mount: the wrapper plays <html>.
          const wr = wrap.getBoundingClientRect()
          const cr = copy.getBoundingClientRect()
          csh = bodyExtent(csh, wr.height, cr.top - wr.top, cr.bottom - wr.top)
          csw = rtl
            ? bodyExtent(csw, wr.width, wr.right - cr.right, wr.right - cr.left)
            : bodyExtent(csw, wr.width, cr.left - wr.left, cr.right - wr.left)
        }
        elDoc.body.removeChild(wrap)
        cache.measureHints.set(state.element, { cssLen, w0: layoutW, docH, docW, csh, csw })
        if (csh > 0) h0 = Math.max(h0, limitDecimals(csh))
        growW(csw)
      }
    } catch { /* fallback: use doc dimensions above */ }
  }
  // === recompute height using the kept-children span (no offscreen) ===
  if (state.options?.excludeMode === 'remove' ||
      (typeof state.options?.filter === 'function' && state.options.filterMode === 'remove')) {
    const hEst = estimateKeptHeight(state.element, state.options) // border+padding+contentSpan
    // Safety: never larger than the original, with an epsilon so rounding cannot clip
    const EPS = 1 // px
    // …and only shrink a box whose height COMES FROM its content. An author-set height does
    // not shrink live when a child goes: a 400px card with one excluded button captured 19px
    // tall. Measured, not parsed: a content-sized box's height equals border + padding + the
    // span of its children (absolutely positioned children do not count, on purpose).
    const hAll = estimateKeptHeight(state.element, {})
    // Proportional tolerance: a content-sized box runs a few px taller than its span (on
    // Firefox a 40px auto card measures 36px), while an imposed height is off by multiples.
    // A height set within ~15% of the content may still mis-shrink by a few px.
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
      // No fontsCSS here (#474): the families already resolve to loaded faces, and data: URL
      // copies still loading would shadow them and lay both trees out in fallback metrics.
      const cssAll = (state.scrollbarCSS || '') + state.baseCSS +
        'svg{overflow:visible;} foreignObject{overflow:visible;}' + state.classCSS
      reconcileCloneLayout(state.element, state.clone, cssAll, state.nodeMap, w0, h0)
    } catch (e) {
      sessionWarn(session, 'reconcile-failed', 'reconcile pass failed', e)
      debugWarn(state.options, 'reconcile couldn\'t run; captured without it.', e)
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
    // clipWindow is element-local. A transformed root's gBCR already holds the transform's
    // bbox offset and the clone re-applies the residual linear part, so shift the window by
    // that residual bbox or it lands twice.
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
    // Start the window on a whole output pixel, as Chromium's screenshot does (x 10.5 is
    // device pixel 21 at dpr 2, 11 at dpr 1); a fractional origin blurs every edge. WebKit
    // keeps its origin (see the translate below).
    const k = isSafari() ? 0 : (options.dpr || 1) * (hasW || hasH ? w / baseW : options.scale || 1)
    minX = limitDecimals(k ? Math.round((clipWindow.x + offX) * k) / k : clipWindow.x + offX)
    minY = limitDecimals(k ? Math.round((clipWindow.y + offY) * k) / k : clipWindow.y + offY)
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
        translate: ind2.translate,
        width: w0,
        height: h0
      })
      const { ox: ox2, oy: oy2 } = parseTransformOriginPx(csEl, w0, h0)
      const M = TOTAL.is2D ? TOTAL : new DOMMatrix(TOTAL.toString())
      // prepareClone strips the root's translation, so the bbox leaves it out too, or the
      // content renders offset (left:50% + translateX(-50%) captured on its own).
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

  // What a child paints past the root's box (outerShadows: 'subtree'), measured on the page.
  // The bbox to page-box ratio converts page pixels to root pixels, leaving out what an
  // ancestor scaled. From @frostin/snapdom (element-mirror).
  const perX = rect.width > 0 ? (maxX - minX) / rect.width : 1
  const perY = rect.height > 0 ? (maxY - minY) / rect.height : 1
  let subtree = outerShadows === 'subtree' && !clipWindow
    ? measureSubtreeBleed(state.element, state.nodeMap, state.styleCache, perX, perY)
    : { top: 0, right: 0, bottom: 0, left: 0 }
  // A body capture keeps what descendants paint into its margins (d40: a child's 1px outline
  // on the right margin). Bounded by that room and net of the content measurement, it never
  // outgrows the document extent.
  if (bodyInk) {
    subtree = {
      top: bodyInk.top,
      right: Math.max(0, bodyInk.right - (w0 - rect.width)),
      bottom: Math.max(0, bodyInk.bottom - (h0 - rect.height)),
      left: bodyInk.left
    }
  }
  if (rtlSpill > 0) subtree = { ...subtree, left: Math.max(subtree.left, rtlSpill) }

  // A region capture has exact edges: no root bleed. blur() is not an outer shadow: the root
  // keeps it, so its bleed always counts; shadows, outline and drop-shadow only under
  // outerShadows.
  const bleed = clipWindow
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : outerShadows
      ? {
        top: limitDecimals(Math.max(bleedShadow.top, bleedText.top, subtree.top) + bleedBlur.top + bleedOutline.top + drop.bleed.top),
        right: limitDecimals(Math.max(bleedShadow.right, bleedText.right, subtree.right) + bleedBlur.right + bleedOutline.right + drop.bleed.right),
        bottom: limitDecimals(Math.max(bleedShadow.bottom, bleedText.bottom, subtree.bottom) + bleedBlur.bottom + bleedOutline.bottom + drop.bleed.bottom),
        left: limitDecimals(Math.max(bleedShadow.left, bleedText.left, subtree.left) + bleedBlur.left + bleedOutline.left + drop.bleed.left)
      }
      : {
        top: limitDecimals(bleedBlur.top + subtree.top),
        right: limitDecimals(bleedBlur.right + subtree.right),
        bottom: limitDecimals(bleedBlur.bottom + subtree.bottom),
        left: limitDecimals(bleedBlur.left + subtree.left)
      }

  minX = limitDecimals(minX - bleed.left)
  minY = limitDecimals(minY - bleed.top)
  maxX = limitDecimals(maxX + bleed.right)
  maxY = limitDecimals(maxY + bleed.bottom)

  const vbW0 = Math.max(1, limitDecimals(maxX - minX))
  const vbH0 = Math.max(1, limitDecimals(maxY - minY))

  const svgNS = 'http://www.w3.org/2000/svg'
  // A transformed root's fractional bbox sits flush on the raster edge, and Safari always,
  // Chrome at zoom other than 100%, shave the last 1-2px. Pad the viewBox on every engine.
  const basePad = hasTFBBox(state.element) ? 2 : 0
  const extraPad = !outerTransforms ? 1 : 0
  const pad = limitDecimals(basePad + extraPad)

  // Ceil so a fractional extent never loses its bottom/right edge to whole pixels. A stream
  // patch lays out at the page's subpixel offset (options.__subpixel) through padding, which
  // is layout and snaps like the full frame; a viewBox shift left rounded corners 8 pixels
  // off. Pinned by __tests__/engine.svg.subpixel.test.js.
  const phaseX = options.__subpixel?.x || 0
  const phaseY = options.__subpixel?.y || 0
  const vbW = Math.ceil(vbW0 + pad * 2 + phaseX)
  const vbH = Math.ceil(vbH0 + pad * 2 + phaseY)

  // Stable Chrome does not paint foreignObject overflow in svg-as-image (headless does, do not
  // trust it), so the fo covers the whole viewBox and the offset moves the CONTENT. Not fo
  // x/y (leaves an unpainted band) nor position/margin/transform on its root (Chrome paints
  // those twice at browser zoom other than 100%): padding on the container survives both.
  // A negative offset (clip window right of or below the origin) uses fo x/y: the band it
  // leaves is the culled region.
  const offX = limitDecimals(-(limitDecimals(minX) - pad))
  const offY = limitDecimals(-(limitDecimals(minY) - pad))
  // Lay the clone out on the live device-pixel grid (#508). Chromium implements DPR AS zoom:
  // it rounds `line-height: normal` line boxes and snaps borders on the device grid, while the
  // svg image lays out at 1x (2164px of text where the page took 2203.5px). `zoom` on the
  // container reproduces the grid and scale(1/zoom) on a <g> outside the fo returns to CSS
  // pixels; viewBox, size and meta do not change. The #508 page went from 10.9% to 2.3%
  // mismatch against a live screenshot in real Chrome; a 3,000-cell table at DPR 2.625 pays
  // 37.5 to 39 ms, nothing at DPR 1. Firefox rounds line boxes the same way
  // (real Firefox 156 at devPixelsPerPx 2.625); WebKit does not. The support check is for
  // Firefox before 126, where `zoom` does not exist and the scale group alone would shrink the
  // capture. Pinned by __tests__/engine.svg.layoutZoom.test.js.
  // devicePixelRatio alone does not prove the grid: device emulation (`deviceScaleFactor`,
  // DevTools device mode) reports dpr 2 and lays out at 1x (liveLayoutZoom below).
  const view = elDoc.defaultView || window
  const layoutZoom = !isSafari() && CSS.supports('zoom', '2') ? liveLayoutZoom(view) : 1
  // toCanvas rasterizes Firefox exports smaller than this grid at it first (#516).
  session.layoutZoom = layoutZoom
  // fo x/y and padding snap to a whole layout pixel, so a clip on a finer output grid (#526,
  // or scale 2) lost its fraction (playwright-lite #302). The fraction goes to a translate on
  // the outer <g> and the fo reaches one layout pixel further left and up to still cover the
  // viewBox. Not WebKit: it moves no box with its own layer by an ancestor translate
  // (cropSvgText, svgText.js). Pinned by __tests__/core.clip.test.js.
  const split = clipWindow && !isSafari()
  const shiftX = split ? limitDecimals(offX - Math.floor(offX * layoutZoom + 0.01) / layoutZoom) : 0
  const shiftY = split ? limitDecimals(offY - Math.floor(offY * layoutZoom + 0.01) / layoutZoom) : 0
  const foX = Math.min(0, offX - shiftX) - (shiftX ? 1 / layoutZoom : 0)
  const foY = Math.min(0, offY - shiftY) - (shiftY ? 1 / layoutZoom : 0)
  const padL = offX - shiftX - foX + phaseX
  const padT = offY - shiftY - foY + phaseY
  const foW = limitDecimals(vbW - foX)
  const foH = limitDecimals(vbH - foY)
  const fo = document.createElementNS(svgNS, 'foreignObject')
  fo.setAttribute('x', String(foX * layoutZoom))
  fo.setAttribute('y', String(foY * layoutZoom))
  fo.setAttribute('width', String(foW * layoutZoom))
  fo.setAttribute('height', String(foH * layoutZoom))
  fo.style.overflow = 'visible'

  const styleTag = document.createElement('style')
  // #349/#351: handled per-element in inlineAllStyles (#406) instead of blanket foreignObject rules
  // #327: iOS WebKit re-applies text-size-adjust during drawImage and inflates text inside
  // fixed heights. A rule, not inline: WebKit expands `all:initial` last and clobbers inline
  // overrides. 100%, not `none`, keeps zoom.
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
    // A stream patch needs the exact live width (w0 is a rounded offsetWidth: a 38.69px cell
    // drew 39.31px). Keyed on the option, not a non-zero phase: a patch resting on a whole
    // pixel drew 0.03px narrow too.
    `width:${options.__subpixel ? limitDecimals(padL + rect.width) : foW}px;height:${foH}px` +
    // !important: Chromium 140 serializes `padding-inline: initial` from `all:initial` AFTER
    // this shorthand, which would reset the left/right padding on re-parse.
    ((padL !== 0 || padT !== 0) ? `;padding:${padT}px 0 0 ${padL}px !important` : '') +
    // !important for the same `all:initial` serialization order as the padding.
    (layoutZoom !== 1 ? `;zoom:${layoutZoom} !important` : '') +
    // `all` leaves `direction` alone, so a right-to-left page's `div{direction:rtl}` default
    // right-aligned the clone 8px off the padding offset.
    // Pinned by __tests__/snapdom.rtlPage.test.js.
    ';direction:ltr !important' +
    (bodyRoom ? canvasBackground(elDoc) : '')

  if (bodyRoom && (padL !== bodyRoom.left || padT !== bodyRoom.top) && signatures) {
    anchorPagePositioned(state.element, state.nodeMap, signatures, state.styleCache,
      padL - bodyRoom.left, padT - bodyRoom.top)
  }

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
  // Read-only so a hook cannot desync the SVG from its geometry. CONFIGURABLE: a direct
  // captureDOM call reuses its options bag, and a second capture must redefine it without
  // "Cannot redefine property".
  Object.defineProperty(options, 'meta', {
    value: captureMeta, enumerable: true, writable: false, configurable: true,
  })

  // `width`/`height` are the ABSOLUTE OUTPUT SIZE of the whole viewBox, bleed included, the
  // one rule of every exporter (types/snapdom.d.ts). Sizing the ELEMENT to `w` instead made
  // svg and png exports of one capture disagree. Safari keeps the viewBox size: toImg patches
  // these attributes itself to stay vector.
  const svgOutW = (!wantsSize || isSafari())
    ? vbW
    : (hasW ? w : limitDecimals(vbW * (h / vbH)))
  const svgOutH = (!wantsSize || isSafari())
    ? vbH
    : (hasH ? h : limitDecimals(vbH * (w / vbW)))

  const rootFontSize = parseFloat(getStyle(elDoc.documentElement)?.fontSize) || 16
  // The <g> rides in the header and footer so the join below stays one plain concatenation:
  // 1.4 ms cheaper per capture on a 3,000-cell table than a conditional inside it.
  const group = [
    shiftX || shiftY ? `translate(${shiftX} ${shiftY})` : '',
    layoutZoom !== 1 ? `scale(${1 / layoutZoom})` : ''
  ].join(' ').trim()
  const svgHeader = `<svg xmlns="${svgNS}" width="${svgOutW}" height="${svgOutH}" viewBox="0 0 ${vbW} ${vbH}" font-size="${rootFontSize}px">${group ? `<g transform="${group}">` : ''}`
  const svgFooter = group ? '</g></svg>' : '</svg>'
  svgString = svgHeader + internInlineStyles(foString, fo) + svgFooter
  // #552: the layout zoom is for the browser's own raster. macOS Preview / Quick Look drew an
  // inline <svg> under the container's `zoom` at twice its size, so file exports (toBlob svg,
  // download svg, svgString) swap in the unzoomed wrapper. Only the wrapper tags differ, so
  // only they are kept, serialized from shallow clones. Null at zoom 1.
  // Pinned by __tests__/engine.svg.layoutZoom.test.js.
  if (layoutZoom !== 1) {
    const openTag = (el) => {
      const s = serializer.serializeToString(el.cloneNode(false))
      return s.slice(0, s.indexOf('>') + 1).replace(/\/>$/, '>')
    }
    const flatFo = fo.cloneNode(false)
    flatFo.setAttribute('x', String(foX))
    flatFo.setAttribute('y', String(foY))
    flatFo.setAttribute('width', String(foW))
    flatFo.setAttribute('height', String(foH))
    const flatContainer = container.cloneNode(false)
    flatContainer.style.removeProperty('zoom')
    const flatGroup = shiftX || shiftY ? `translate(${shiftX} ${shiftY})` : ''
    const flatHeader = svgHeader.slice(0, svgHeader.indexOf('>') + 1) + (flatGroup ? `<g transform="${flatGroup}">` : '')
    session.fileSvg = {
      zoomed: [svgHeader + openTag(fo), openTag(container), svgFooter],
      flat: [flatHeader + openTag(flatFo), openTag(flatContainer), flatGroup ? '</g></svg>' : '</svg>'],
    }
  }
  dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
  state.svgString = svgString
  state.dataURL = dataURL
  // The CSS strings export plugins (toHtml et al) read instead of parsing the data URL.
  // svgString stays out (it doubles retained memory); exporters decode the url lazily.
  session.artifacts = {
    classCSS: state.classCSS || '',
    fontsCSS: state.fontsCSS || '',
    baseCSS: state.baseCSS || '',
    scrollbarCSS: state.scrollbarCSS || '',
  }
  // afterRender(context)
  await runHook('afterRender', state)
  // The result closes over this context, so drop the heavy fields after the last render hook.
  // Export hooks read `url` / `artifacts` instead.
  state.clone = state.nodeMap = state.styleCache = state.svgString = null

  // The id is public and may belong to the page. Duplicate ids are possible while our
  // short-lived sandbox exists, so inspect every match and remove only private provenance.
  const sandbox = [...document.querySelectorAll('#snapdom-sandbox')].find(isInternalNode)
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove()
  return state.dataURL
}

/** Whether the root carries a transform that moves its bbox. A local name for
 *  hasBBoxAffectingTransform, nothing more. */
function hasTFBBox(el) {
  return hasBBoxAffectingTransform(el)
}

/**
 * The zoom the live document is actually laid out at, for the #508 layout zoom.
 *
 * A real hi-DPI screen makes Chromium lay out on the device grid (zoom-for-DSF). CDP device
 * emulation (`deviceScaleFactor`, DevTools device mode) reports dpr 2 and lays out at 1x, and
 * a zoomed clone there re-wrapped text the unzoomed one matched exactly.
 * The probe: border widths snap to the layout grid, so a 0.5px border computes to 0.5px on a
 * 2x grid and 1px on a 1x grid. 1px or more means 1x whatever dpr says. An engine that does
 * not snap reports 0.5px and keeps zoom = dpr. Not cached: dpr, browser zoom and the root's
 * `zoom` can change between captures.
 * @param {Window} view - the captured element's window
 * @returns {number} devicePixelRatio, or 1 when the live layout grid is CSS pixels
 */
export function liveLayoutZoom(view) {
  const dpr = view.devicePixelRatio || 1
  if (dpr === 1) return 1
  const doc = view.document
  let zoom = dpr
  try {
    const probe = doc.createElement('div')
    markInternalNode(probe)
    probe.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;' +
      'width:0!important;height:0!important;visibility:hidden!important;pointer-events:none!important;' +
      'border:0 solid transparent!important;border-top-width:0.5px!important'
    ;(doc.body || doc.documentElement).appendChild(probe)
    const bt = parseFloat(view.getComputedStyle(probe).borderTopWidth)
    probe.remove()
    if (bt >= 1) zoom = 1
  } catch { /* keep dpr */ }
  return zoom
}
