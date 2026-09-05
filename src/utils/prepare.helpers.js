/**
 * Two edits to the LIVE element before it is cloned, each returning its undo.
 *
 * prepareClone runs both and diff.js runs the content-visibility one; every caller undoes
 * them in a finally, so the page is as it was when the capture returns.
 * @module utils/prepare.helpers
 */

import { isHTMLEl } from './helpers.js'

const activeBorders = new WeakMap()
const activeVisibility = new WeakMap()

/** Own only the declarations we temporarily change. Concurrent captures share one
 * override; the last undo restores it, without erasing application edits made meanwhile. */
function transientStyles(element, declarations, active) {
  let patch = active.get(element)
  const style = element.style
  if (!patch) {
    const originalCSS = style.cssText
    const hadStyle = element.hasAttribute('style')
    const saved = declarations.map(([property, value]) => {
      const entry = {
        property,
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      }
      style.setProperty(property, value, 'important')
      entry.forcedValue = style.getPropertyValue(property)
      return entry
    })
    patch = { users: 0, saved, originalCSS, forcedCSS: style.cssText, hadStyle }
    active.set(element, patch)
  }
  patch.users++
  let undone = false
  return () => {
    if (undone) return
    undone = true
    if (--patch.users) return
    active.delete(element)
    // Preserve exact shorthand/order serialization in the ordinary untouched case.
    if (style.cssText === patch.forcedCSS) style.cssText = patch.originalCSS
    else for (const entry of patch.saved) {
      if (style.getPropertyValue(entry.property) !== entry.forcedValue ||
          style.getPropertyPriority(entry.property) !== 'important') continue
      if (entry.value) style.setProperty(entry.property, entry.value, entry.priority)
      else style.removeProperty(entry.property)
    }
    if (!patch.hadStyle && !style.length) {
      // Blink/WebKit lazily serialize CSSOM writes. Flush the attribute first or removing
      // an attribute that was originally absent can leave a pending empty style behind.
      element.getAttribute('style')
      element.removeAttribute('style')
    }
  }
}

/**
 * Give a root that has an outline but no border a transparent border of the outline's width
 * while it is cloned (#179), and return the undo that restores the inline border. The gate is
 * all four computed border widths at 0, for the reason below. Pinned by
 * __tests__/utils.prepare.helpers.test.js.
 * @param {Element} element
 * @returns {() => void}
 */
export function stabilizeLayout(element) {
  if (activeBorders.has(element)) return transientStyles(element, [], activeBorders)
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
    // A border shorthand also resets border-image and destroys independently authored
    // longhands. Change only the twelve physical declarations the shim needs.
    const declarations = []
    for (const side of ['top', 'right', 'bottom', 'left']) {
      declarations.push([`border-${side}-width`, outlineWidth],
        [`border-${side}-style`, 'solid'], [`border-${side}-color`, 'transparent'])
    }
    return transientStyles(element, declarations, activeBorders)
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
  const undos = []
  const force = (el) => {
    if (!isHTMLEl(el)) return
    if (activeVisibility.has(el)) {
      undos.push(transientStyles(el, [], activeVisibility))
      return
    }
    const cs = getComputedStyle(el)
    const computed = cs.contentVisibility || cs.getPropertyValue('content-visibility') || ''
    if (computed === 'auto') {
      undos.push(transientStyles(el, [['content-visibility', 'visible']], activeVisibility))
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
    for (const undo of undos) { try { undo() } catch {} }
  }
}
