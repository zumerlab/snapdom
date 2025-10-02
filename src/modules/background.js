/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils'

/**
 * Recursively inlines background-related images and masks from the source element to its clone.
 *
 * This function walks through the source DOM tree and its clone, copying inline styles for
 * background images, masks, and border images to ensure the clone retains all visual image
 * resources inline (e.g., data URLs), avoiding external dependencies.
 *
 * It also preserves the `background-color` property if it is not transparent.
 *
 * Special handling is done for `border-image` related properties: the
 * `border-image-slice`, `border-image-width`, `border-image-outset`, and `border-image-repeat`
 * are only copied if `border-image` or `border-image-source` are present and active.
 *
 * @param {HTMLElement} source The original source element from which styles are read.
 * @param {HTMLElement} clone The cloned element to which inline styles are applied.
 * @param {Object} [options={}] Optional parameters passed to image inlining functions.
 * @returns {Promise<void>} Resolves when all inlining operations (including async image fetches) complete.
 */
/**
 * Inlines URL-bearing properties (background/mask/border-image)
 * and also preserves mask positioning longhands (position/size/repeat).
 * This fixes cases like `mask: url(...) center/60% 60% no-repeat`.
 */
export async function inlineBackgroundImages(source, clone, styleCache, options = {}) {
  const queue = [[source, clone]]

  /** Props that can contain url(...) and may need inlining */
  const URL_PROPS = [
    'background-image',

    // Mask shorthands & images (both standard and WebKit)
    'mask',
    'mask-image',
    '-webkit-mask',
    '-webkit-mask-image',

    // Mask sources (rare, but keep)
    'mask-source',
    'mask-box-image-source',
    'mask-border-source',
    '-webkit-mask-box-image-source',

    // Border image
    'border-image',
    'border-image-source',
  ]

  /** Mask longhands to preserve spatial layout (copy as-is) */
  const MASK_LAYOUT_PROPS = [
    'mask-position',
    'mask-size',
    'mask-repeat',
    // WebKit variants
    '-webkit-mask-position',
    '-webkit-mask-size',
    '-webkit-mask-repeat',
    // Extra (optional but helpful across engines)
    'mask-origin',
    'mask-clip',
    '-webkit-mask-origin',
    '-webkit-mask-clip',
    // Some engines expose X/Y position separately:
    '-webkit-mask-position-x',
    '-webkit-mask-position-y',
  ]

  /** Border-image aux longhands (copy only when active) */
  const BORDER_AUX_PROPS = [
    'border-image-slice',
    'border-image-width',
    'border-image-outset',
    'border-image-repeat',
  ]

  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift()
    // Style cache
    const style = styleCache.get(srcNode) || getStyle(srcNode)
    if (!styleCache.has(srcNode)) styleCache.set(srcNode, style)
    // Border-image present?
    const hasBorderImage = (() => {
      const bi = style.getPropertyValue('border-image')
      const bis = style.getPropertyValue('border-image-source')
      return (bi && bi !== 'none') || (bis && bis !== 'none')
    })()
    // 1) Inline URL-bearing properties
    for (const prop of URL_PROPS) {
      const val = style.getPropertyValue(prop)
      if (!val || val === 'none') continue
      // Split multiple layers (comma-separated)
      const splits = splitBackgroundImage(val)

      const inlined = await Promise.all(
        splits.map(entry => inlineSingleBackgroundEntry(entry, options))
      )

      if (inlined.some(p => p && p !== 'none' && !/^url\(undefined/.test(p))) {
        cloneNode.style.setProperty(prop, inlined.join(', '))
      }
    }
    // 2) Copy mask layout longhands (position / size / repeat, etc.)
    for (const prop of MASK_LAYOUT_PROPS) {
      const val = style.getPropertyValue(prop)
      // Skip empty/initial defaults to avoid bloating
      if (!val || val === 'initial') continue
      cloneNode.style.setProperty(prop, val)
    }
    // 3) Copy border-image auxiliaries only if border-image is active
    if (hasBorderImage) {
      for (const prop of BORDER_AUX_PROPS) {
        const val = style.getPropertyValue(prop)
        if (!val || val === 'initial') continue
        cloneNode.style.setProperty(prop, val)
      }
    }
    // 4) Recurse
    const sChildren = Array.from(srcNode.children)
    const cChildren = Array.from(cloneNode.children)
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]])
    }
  }
}
