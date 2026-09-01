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
 *
 * Only 'auto' is forced. 'hidden' is an explicit authoring decision, not an optimization:
 * the browser paints the element's own box (background, border, padding) and skips its
 * contents outright — a descendant's `visibility: visible` does not bring them back.
 * Forcing it to 'visible' used to un-hide the whole subtree, which is why the
 * "content-visibility:hidden ⇒ visibility:hidden" guard in modules/styles.js could never
 * fire: this pass had already erased the value it looked for.
 * Returns an undo function to restore original values.
 * @param {Element} root
 * @returns {() => void}
 */
export function forceContentVisibility(root) {
  const saved = []
  try {
    // Decide whether an element needs content-visibility forced to 'visible'.
    // If an inline `content-visibility` declaration exists it already wins over any
    // stylesheet rule for the computed value, so we can decide WITHOUT the expensive
    // getComputedStyle() call. Only when inline is empty do we read computed style to
    // catch a stylesheet-driven `auto`. The redundant `getPropertyValue` fallback is
    // dropped: the camelCase accessor returns the computed value for this standard prop.
    const evaluate = (el) => {
      const inlineCV = el.style.contentVisibility || ''
      if (inlineCV) return { original: inlineCV, force: inlineCV === 'auto' }
      const cs = getComputedStyle(el)
      return { original: '', force: (cs.contentVisibility || '') === 'auto' }
    }

    for (const el of root.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue
      const { original, force } = evaluate(el)
      if (force) {
        saved.push({ el, original })
        el.style.contentVisibility = 'visible'
      }
    }
    // Check root itself (querySelectorAll('*') excludes it).
    if (root instanceof HTMLElement) {
      const { original, force } = evaluate(root)
      if (force) {
        saved.push({ el: root, original })
        root.style.contentVisibility = 'visible'
      }
    }
  } catch { /* non-blocking */ }
  return () => {
    for (const { el, original } of saved) {
      try { el.style.contentVisibility = original } catch {}
    }
  }
}
