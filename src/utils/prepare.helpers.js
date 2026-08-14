/**
 * Helper utilities for preparing DOM clones
 * @module utils/prepare.helpers
 */

/**
 * Stabilize layout by adding transparent border if element has outline but no border.
 * Returns an undo function to restore the element's original inline border.
 * @param {Element} element
 * @returns {() => void}
 */
export function stabilizeLayout(element) {
  const style = getComputedStyle(element)
  const outlineStyle = style.outlineStyle
  const outlineWidth = style.outlineWidth
  const borderStyle = style.borderStyle
  const borderWidth = style.borderWidth

  const outlineVisible = outlineStyle !== 'none' && parseFloat(outlineWidth) > 0
  const borderAbsent = (borderStyle === 'none' || parseFloat(borderWidth) === 0)

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
 * Returns an undo function to restore original values.
 * @param {Element} root
 * @param {{left:number,top:number,right:number,bottom:number}|null} [clipRect]
 * @returns {() => void}
 */
export function forceContentVisibility(root, clipRect = null) {
  const saved = []
  const force = (el) => {
    if (!(el instanceof HTMLElement)) return
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
