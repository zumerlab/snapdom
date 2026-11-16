/**
 * Two edits to the LIVE element before it is cloned, each returning its undo.
 *
 * prepareClone runs both and diff.js runs the content-visibility one; every caller undoes
 * them in a finally, so the page is as it was when the capture returns.
 * @module utils/prepare.helpers
 */

import { isHTMLEl } from './helpers.js'
import { noteSelfWrite } from './ownership.js'

const activeVisibility = new WeakMap()

/** Own only the declarations we temporarily change. Concurrent captures share one
 * override; the last undo restores it, without erasing application edits made meanwhile. */
function transientStyles(element, declarations) {
  let patch = activeVisibility.get(element)
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
    noteSelfWrite(element, originalCSS, patch.forcedCSS)
    activeVisibility.set(element, patch)
  }
  patch.users++
  let undone = false
  return () => {
    if (undone) return
    undone = true
    if (--patch.users) return
    activeVisibility.delete(element)
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

/** Matches the boxes forceContentVisibility is holding visible, and their clones. */
export const FORCED_VISIBILITY = '[style*="content-visibility"]'

/**
 * #281: force content-visibility 'auto' to 'visible' below root, since Safari (and some
 * Chromium) skip offscreen cv:auto boxes and the capture comes out blank. A clipRect prunes
 * the walk to the window. Never force 'hidden': it is authored, and forcing it un-hid the
 * subtree. Returns the undo. Pinned by __tests__/utils.prepare.helpers.test.js.
 * @param {Element} root
 * @param {{left:number,top:number,right:number,bottom:number}|null} [clipRect]
 * @param {Element[]|null} [only] - force these and walk nothing (diff.js)
 * @returns {() => void}
 */
export function forceContentVisibility(root, clipRect = null, only = null) {
  const undos = []
  const force = (el) => {
    if (!isHTMLEl(el)) return
    if (activeVisibility.has(el)) {
      undos.push(transientStyles(el, []))
      return
    }
    const cs = getComputedStyle(el)
    const computed = cs.contentVisibility || cs.getPropertyValue('content-visibility') || ''
    if (computed === 'auto') {
      undos.push(transientStyles(el, [['content-visibility', 'visible']]))
    }
  }
  try {
    if (only) {
      for (const el of only) force(el)
    } else if (clipRect) {
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
