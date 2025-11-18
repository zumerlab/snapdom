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
