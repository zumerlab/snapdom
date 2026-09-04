/**
 * Two edits to the LIVE element before it is cloned, each returning its undo.
 *
 * prepareClone runs both and diff.js runs the content-visibility one; every caller undoes
 * them in a finally, so the page is as it was when the capture returns.
 * @module utils/prepare.helpers
 */

import { isHTMLEl } from './helpers.js'

/**
 * Give a root that has an outline but no border a transparent border of the outline's width
 * while it is cloned (#179), and return the undo that restores the inline border. The gate is
 * all four computed border widths at 0, for the reason below. Pinned by
 * __tests__/utils.prepare.helpers.test.js.
 * @param {Element} element
 * @returns {() => void}
 */
export function stabilizeLayout(element) {
  const style = getComputedStyle(element)
  const outlineStyle = style.outlineStyle
  const outlineWidth = style.outlineWidth

  const outlineVisible = outlineStyle !== 'none' && parseFloat(outlineWidth) > 0
  // Per SIDE, not through the shorthand. `style.borderWidth` serializes to the four widths
  // and parseFloat reads only the FIRST, so `border-bottom: 1px solid #ddd` tested as "no
  // border": the branch below then painted a transparent border over all four sides for the
  // capture, and its restore (`element.style.border = ''` when only some longhands are
  // inline) is removeProperty('border') per CSSOM — deleting the author's border from the
  // LIVE page. Computed border-*-width is already 0 whenever the style is none, so the
  // separate borderStyle read is redundant.
  const borderAbsent = parseFloat(style.borderTopWidth) === 0 &&
    parseFloat(style.borderRightWidth) === 0 &&
    parseFloat(style.borderBottomWidth) === 0 &&
    parseFloat(style.borderLeftWidth) === 0

  if (outlineVisible && borderAbsent) {
    const original = element.style.border
    element.style.border = `${outlineWidth} solid transparent`
    return () => { element.style.border = original }
  }
  return () => {}
}

/**
 * #281: Force content-visibility to 'visible' on all descendants that use 'auto'.
 * Safari (and some Chromium) skip rendering/style computation for content-visibility:auto
 * elements outside the viewport, causing blank captures.
 * With a clipRect (clip mode) the walk is pruned to subtrees whose boxes reach the window:
 * a clip rect far from the real viewport lands on unrendered cv:auto placeholders, but
 * forcing the whole page would cost O(page) for content the culler drops anyway.
 *
 * Only 'auto' is forced. 'hidden' is an explicit authoring decision, not an optimization:
 * the browser paints the element's own box (background, border, padding) and skips its
 * contents outright, and a descendant's `visibility: visible` does not bring them back.
 * Forcing it to 'visible' un-hid the whole subtree into the capture, and also erased the
 * value modules/styles.js reads to carry the declaration into the snapshot, so that guard
 * could never fire.
 * Returns an undo function to restore original values. Pinned by
 * __tests__/utils.prepare.helpers.test.js.
 * @param {Element} root
 * @param {{left:number,top:number,right:number,bottom:number}|null} [clipRect]
 * @returns {() => void}
 */
export function forceContentVisibility(root, clipRect = null) {
  const saved = []
  const force = (el) => {
    if (!isHTMLEl(el)) return
    const cs = getComputedStyle(el)
    const computed = cs.contentVisibility || cs.getPropertyValue('content-visibility') || ''
    if (computed === 'auto') {
      saved.push({ el, original: el.style.contentVisibility || '' })
      el.style.contentVisibility = 'visible'
    }
  }
  try {
    if (clipRect) {
      // Margin mirrors clone.js CLIP_CULL_MARGIN; zero-sized boxes (display:contents,
      // anchors) never prune. Forcing a section before descending gives its children
      // real layout boxes for their own intersection test (nested cv:auto).
      const M = 200
      const walk = (el) => {
        let r
        try { r = el.getBoundingClientRect() } catch { return }
        if ((r.width > 0 || r.height > 0) &&
            (r.right < clipRect.left - M || r.left > clipRect.right + M ||
             r.bottom < clipRect.top - M || r.top > clipRect.bottom + M)) return
        force(el)
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) walk(c)
      }
      walk(root)
    } else {
      for (const el of root.querySelectorAll('*')) force(el)
      force(root)
    }
  } catch { /* non-blocking */ }
  return () => {
    for (const { el, original } of saved) {
      try { el.style.contentVisibility = original } catch {}
    }
  }
}
