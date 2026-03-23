/**
 * Helper utilities for preparing DOM clones
 * @module utils/prepare.helpers
 */

/**
 * Stabilize layout by adding transparent border if element has outline but no border
 * @param {Element} element
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
    element.style.border = `${outlineWidth} solid transparent`
  }
}

/**
 * #281: Force content-visibility to 'visible' on all descendants that use 'auto'.
 * Safari (and some Chromium) skip rendering/style computation for content-visibility:auto
 * elements outside the viewport, causing blank captures.
 * Returns an undo function to restore original values.
 * @param {Element} root
 * @returns {() => void}
 */
export function forceContentVisibility(root) {
  const saved = []
  try {
    const all = root.querySelectorAll('*')
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue
      const cv = el.style.contentVisibility || ''
      const cs = getComputedStyle(el)
      const computed = cs.contentVisibility || cs.getPropertyValue('content-visibility') || ''
      if (computed === 'auto' || computed === 'hidden') {
        saved.push({ el, original: cv })
        el.style.contentVisibility = 'visible'
      }
    }
    // Check root itself
    if (root instanceof HTMLElement) {
      const cs = getComputedStyle(root)
      const computed = cs.contentVisibility || cs.getPropertyValue('content-visibility') || ''
      if (computed === 'auto' || computed === 'hidden') {
        saved.push({ el: root, original: root.style.contentVisibility || '' })
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
