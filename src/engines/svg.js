/**
 * SVG render engine: the default way a finished clone becomes pixels.
 *
 * Owns clone to render (`captureDOM` owns element to clone, stages.js): base reset, bbox and
 * bleed math, foreignObject assembly and encoding. An ENGINE, not core; htmlInCanvas.js is its
 * peer on the same finished clone. Burst's differential recapture re-enters it.
 *
 * @module engines/svg
 */

import { isSafari, getStyle } from '../utils/index.js'
import { isFirefox } from '../utils/browser.js'
import { cache } from '../core/cache.js'
import { runHook } from '../core/plugins.js'
import { sessionWarn, debugWarn } from '../utils/debug.js'
import { isInternalNode, markInternalNode } from '../utils/ownership.js'
import { freezeLineBreaks, lineRisk } from '../modules/lineBreaks.js'
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
 * Intern repeated inline style attributes as attribute-selector rules (500-row table, 12
 * distinct values in 3005 attributes: draw 52.6ms to 37.4ms). String-level, so the retained
 * clone is untouched. Styles that compete with author ID rules or inline !important, and
 * editable assets, stay inline. Not on Safari: never measured or verified there, where
 * fixSafariShadows rewrites the shadows of both the sheet and the attributes.
 * Pinned by __tests__/engine.svg.intern.test.js.
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
 * Shared by captureDOM and burst's differential recapture. Writes `options.meta` on the
 * context and `layoutZoom`, `fileSvg`, `artifacts` on the session, then drops the clone.
 * A differential frame passes null `signatures`, so it measures every node and re-anchors none.
 * @param {object} state - capture context, or diff's wrapper around one
 * @param {{clipWindow: object|null, outerTransforms: boolean, outerShadows: boolean|'subtree', rootTransform2D: object|null, fontsCSS: string, universe: Set<string>|null, session: import('../core/session.js').CaptureSession, signatures: Map<Element, string>|null}} ex
 * @returns {Promise<string>} SVG data URL
 */
export async function composeAndSerialize(state, ex) {
  const { clipWindow, outerTransforms, outerShadows, rootTransform2D, fontsCSS, universe, session, signatures } = ex
  const options = state.options
  // Fold diff's wrapper onto the context and pin `options` (it never entered captureDOM). The
  // wrapper's `options` IS the target: copying it writes a cycle or throws in strict mode.
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
  // #449: an iframe doc pinned by rasterizeIframe keeps its viewport size. The pin is an
  // option, not an attribute on <html>, which the frame's observer saw and killed the outer
  // burst memo. Clip mode windows the viewBox and skips the expansion.
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
    // Document extents count the body's margins, an empty band at the bottom; bodyExtent keeps
    // only real overflow.
    const isBody = state.element === elDoc.body
    // A right-to-left page overflows to the left, so its extra width becomes left bleed.
    const rtl = isBody && getStyle(elDoc.documentElement).direction === 'rtl'
    const growW = (v) => {
      if (!(v > 0)) return
      if (rtl) rtlSpill = Math.max(rtlSpill, limitDecimals(v - rect.width))
      else w0 = Math.max(w0, limitDecimals(v))
    }
    if (isBody && elDoc.documentElement) {
      const hr = elDoc.documentElement.getBoundingClientRect()
      // Rects are in zoomed px under a `zoom` on <html>, the room is used in the body's own:
      // unscaled, a page-anchored box sat 1px left and 4px up at zoom 1.25.
      const z = state.element.currentCSSZoom || 1
      const room = {
        top: Math.max(0, rect.top - hr.top) / z,
        right: Math.max(0, hr.right - rect.right) / z,
        bottom: Math.max(0, hr.bottom - rect.bottom) / z,
        left: Math.max(0, rect.left - hr.left) / z
      }
      bodyRoom = room
      if (outerShadows !== 'subtree' && (room.top || room.right || room.bottom || room.left)) {
        // Only a signature with an outer effect can ink the room (600-card body, Chromium:
        // 1.9 ms to 0.5 ms). A node with no signature is measured.
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
    // Measure the styled clone too, cached per element. docH/docW belong in the key: a stale
    // hint only grows (Math.max), so a page that got shorter kept an empty band for good.
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
    // Shrink only a box whose height comes from its content: a 400px card with one excluded
    // button captured 19px tall. Measured, not parsed.
    const hAll = estimateKeptHeight(state.element, {})
    // Proportional: on Firefox a 40px auto card spans 36px, while an imposed height is off by
    // multiples.
    const slack = Math.max(2, h0 * 0.15)
    const contentSized = Number.isFinite(hAll) && hAll >= h0 - slack
    if (contentSized && Number.isFinite(hEst) && hEst > 0) {
      h0 = Math.max(1, Math.min(h0, limitDecimals(hEst + EPS)))
    }
    // Width almost never needs the same adjustment; the analogous helper would be estimateKeptWidth(...)
  }
  // Opt-in: pin only the boxes whose measured size diverges from the live tree.
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
  // Output basis: the element box, or the clip window.
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

  // BBOX
  let minX = 0, minY = 0, maxX = w0, maxY = h0

  if (clipWindow) {
    // clipWindow is element-local. A transformed root's gBCR already holds the transform's
    // bbox offset and the clone re-applies the residual linear part, so shift the window by
    // that residual bbox or it lands twice.
    let offX = 0, offY = 0
    if (hasBBoxAffectingTransform(state.element)) {
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
    const useTFBBox = outerTransforms && hasBBoxAffectingTransform(state.element)
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

  // BLEED
  const bleedShadow = parseBoxShadow(csEl)
  const bleedText = parseTextShadow(csEl)
  const bleedBlur = parseFilterBlur(csEl)
  const bleedOutline = parseOutline(csEl)
  const drop = parseFilterDropShadows(csEl)

  // What children paint past the root (outerShadows: 'subtree'), in root pixels: the bbox to
  // page-box ratio removes what an ancestor scaled. From @frostin/snapdom.
  const perX = rect.width > 0 ? (maxX - minX) / rect.width : 1
  const perY = rect.height > 0 ? (maxY - minY) / rect.height : 1
  let subtree = outerShadows === 'subtree' && !clipWindow
    ? measureSubtreeBleed(state.element, state.nodeMap, state.styleCache, perX, perY)
    : { top: 0, right: 0, bottom: 0, left: 0 }
  // A body capture keeps what descendants paint into its margins (d40), bounded by that room.
  if (bodyInk) {
    subtree = {
      top: bodyInk.top,
      right: Math.max(0, bodyInk.right - (w0 - rect.width)),
      bottom: Math.max(0, bodyInk.bottom - (h0 - rect.height)),
      left: bodyInk.left
    }
  }
  if (rtlSpill > 0) subtree = { ...subtree, left: Math.max(subtree.left, rtlSpill) }

  // A clip has exact edges. blur() is not an outer shadow: the root keeps it, so its bleed
  // always counts.
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
  const basePad = hasBBoxAffectingTransform(state.element) ? 2 : 0
  const extraPad = !outerTransforms ? 1 : 0
  const pad = limitDecimals(basePad + extraPad)

  // Ceil, or the bottom/right edge is lost. A stream patch takes its subpixel phase as padding,
  // which snaps like the full frame; a viewBox shift left rounded corners 8 pixels off.
  // Pinned by __tests__/engine.svg.subpixel.test.js.
  const phaseX = options.__subpixel?.x || 0
  const phaseY = options.__subpixel?.y || 0
  const vbW = Math.ceil(vbW0 + pad * 2 + phaseX)
  const vbH = Math.ceil(vbH0 + pad * 2 + phaseY)

  // Stable Chrome does not paint fo overflow (headless does: do not trust it), so the offset
  // is padding on the container. Not fo x/y (unpainted band), nor position/margin/transform
  // (painted twice at browser zoom other than 100%). A negative offset uses fo x/y: its band
  // is the culled region.
  const offX = limitDecimals(-(limitDecimals(minX) - pad))
  const offY = limitDecimals(-(limitDecimals(minY) - pad))
  // #508: Chromium and Firefox lay the page out on the device-pixel grid, the svg image at 1x,
  // so line boxes drift apart. `zoom` on the container restores the grid and scale(1/zoom) on
  // the outer <g> undoes it (the #508 page: 10.9% to 2.3% mismatch in real Chrome; a 3,000-cell
  // table at DPR 2.625 pays 37.5 to 39 ms). WebKit does not round by DPR.
  // Pinned by __tests__/engine.svg.layoutZoom.test.js.
  const view = elDoc.defaultView || window
  // The support check is for Firefox before 126, where the scale alone would shrink the capture.
  // The page also lays the element out under its own and its ancestors' `zoom`: a `1px`
  // border under zoom 1.3125 is 0.762px live and 1px in a 1x image, and a table cell cannot
  // absorb the difference the way a block does (freezeBorderBox), so every row grew.
  // Firefox shapes the system font for the zoomed size, with tighter tracking: 12px system-ui
  // came out 8% narrower and a heading wrapped (d22). An integer grid snaps a 1px border the
  // same at 1x, so Firefox skips the device zoom there (90 demos on a real 2x grid: mean
  // mismatch against the page 0.99% to 0.44%, 17 line-count mismatches to 0).
  const zooms = !isSafari() && CSS.supports('zoom', '2')
  const grid = zooms ? liveLayoutZoom(view) : 1
  const layoutZoom = zooms
    ? (isFirefox() && Number.isInteger(grid) ? 1 : grid) * (state.element.currentCSSZoom || 1) : 1
  // toCanvas rasterizes Firefox exports smaller than this grid at it first (#516).
  session.layoutZoom = layoutZoom
  // fo x/y and padding snap to a layout pixel, so a clip's fraction (#526, playwright-lite
  // #302) goes to a translate on the outer <g>. Not WebKit: it moves no box with its own layer
  // by an ancestor translate (cropSvgText). Pinned by __tests__/core.clip.test.js.
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
  // #372: isolate the wrapper from iframe CSS (div { border: 10px solid red }). It spans the
  // whole fo: standalone-SVG Chromium clips fo content at the container box.
  container.style.cssText =
    'all:initial;box-sizing:border-box;display:block;overflow:visible;' +
    // A stream patch needs the exact live width (rounded w0 drew a 38.69px cell 39.31px). Keyed
    // on the option, not a non-zero phase.
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
  // Under a fractional layout zoom a line can come out wider or narrower than on the page and
  // break a word early or pull one up: serialize a copy that keeps the page's line breaks where
  // they are at risk, and leave the clone as it is. A whole zoom keeps the page's grid (432
  // boxes sized by their own text, Chromium at 2x: no line moved with or without the pass).
  let tree = fo
  if (!Number.isInteger(layoutZoom)) {
    try {
      tree = freezeLineBreaks(fo, state.clone, state.nodeMap, elDoc, lineRisk(layoutZoom)) || fo
    } catch (e) {
      sessionWarn(session, 'line-breaks-failed', 'line break pass failed', e)
    }
  }
  const foString = serializer.serializeToString(tree)
  const wantsSize = hasW || hasH

  // `contentX/contentY` locate the capture box in the viewBox; `(vbW - w0) / 2` is wrong under
  // asymmetric bleed, transformed roots and clips.
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
  // Read-only so a hook cannot desync it. Configurable: a reused options bag is redefined on
  // the next capture.
  Object.defineProperty(options, 'meta', {
    value: captureMeta, enumerable: true, writable: false, configurable: true,
  })

  // `width`/`height` size the whole viewBox, bleed included, as every exporter does. Safari
  // keeps the viewBox size: toImg patches it to stay vector.
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
  svgString = svgHeader + internInlineStyles(foString, tree) + svgFooter
  // #552: macOS Preview / Quick Look drew an inline <svg> under `zoom` at twice its size, so
  // svg files swap in the unzoomed wrapper tags kept here.
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

  // The id is public: remove only our own sandbox.
  const sandbox = [...document.querySelectorAll('#snapdom-sandbox')].find(isInternalNode)
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove()
  return state.dataURL
}

/**
 * The zoom the live document is actually laid out at, for the #508 layout zoom.
 *
 * Device emulation (`deviceScaleFactor`, DevTools device mode) reports dpr 2 but lays out at
 * 1x, where a zoomed clone re-wrapped text. A 0.5px border computes to one device pixel, so
 * 1px means 1x unless a device pixel is that wide; an engine that does not snap keeps zoom = dpr. Not cached: dpr and browser
 * zoom change between captures.
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
    // Zoomed out (dpr under 1) the probe reads one device pixel, 1.25px at 0.8: a real grid,
    // where a table's dividers and a paragraph's line boxes moved in a 1x image (Chromium, a
    // real 0.8 grid: 5.4% to 0.0% on a page of paragraphs). Firefox stays at 1x there, its
    // system font narrows under the zoom.
    if (bt >= 1 && (isFirefox() || Math.abs(bt - 1 / dpr) > 0.01)) zoom = 1
  } catch { /* keep dpr */ }
  return zoom
}
