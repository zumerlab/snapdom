/**
 * Utilities for inlining background images as data URLs.
 * @module background
 */

import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils'
import { cache } from '../core/cache.js'
import { needsBackgroundInline } from './styles.js'

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

/** Mask longhands to preserve spatial layout (copy as-is).
 * Must run AFTER the `mask` shorthand in URL_PROPS — setting the shorthand
 * resets every longhand to its initial value (#402: lost mask-mode/composite). */
const MASK_LAYOUT_PROPS = [
  'mask-position',
  'mask-size',
  'mask-repeat',
  'mask-mode',
  'mask-composite',
  // WebKit variants
  '-webkit-mask-position',
  '-webkit-mask-size',
  '-webkit-mask-repeat',
  '-webkit-mask-composite',
  // Extra (optional but helpful across engines)
  'mask-origin',
  'mask-clip',
  '-webkit-mask-origin',
  '-webkit-mask-clip',
  // Some engines expose X/Y position separately:
  '-webkit-mask-position-x',
  '-webkit-mask-position-y',
]
const BG_LAYOUT_PROPS = [
  'background-position', 'background-position-x', 'background-position-y',
  'background-size', 'background-repeat',
  'background-origin', 'background-clip',
  'background-attachment', 'background-blend-mode'
]
/** Border-image aux longhands (copy only when active) */
const BORDER_AUX_PROPS = [
  'border-image-slice',
  'border-image-width',
  'border-image-outset',
  'border-image-repeat',
]

/**
 * Inline URL-bearing properties (background/mask/border-image) from one source element onto its
 * clone, plus the layout longhands that keep them positioned (mask position/size, bg layout for
 * background-clip:text, border-image auxiliaries).
 * @param {Element} srcNode
 * @param {HTMLElement} cloneNode
 * @param {WeakMap} styleCache
 * @param {Object} options
 */
async function inlineBackgroundForNode(srcNode, cloneNode, styleCache, options) {
  const style = styleCache.get(srcNode) || getStyle(srcNode)
  if (!styleCache.has(srcNode)) styleCache.set(srcNode, style)

  // Border-image present?
  const bi = style.getPropertyValue('border-image')
  const bis = style.getPropertyValue('border-image-source')
  const hasBorderImage = (bi && bi !== 'none') || (bis && bis !== 'none')

  // Background layout longhands (position/size/repeat/origin/clip/...) are inert without a
  // background, yet are never empty, so copying them onto every node bloated the markup and
  // rasterization cost. Copy only when a background actually exists. background-color is
  // included so the background-clip:text trick (color clipped to text) still works.
  const bgImage = style.getPropertyValue('background-image')
  const bgColor = style.getPropertyValue('background-color')
  const hasBg =
    (bgImage && bgImage !== 'none') ||
    (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') ||
    /url\s*\(|gradient\s*\(/i.test(style.getPropertyValue('background') || '')
  if (hasBg) {
    for (const prop of BG_LAYOUT_PROPS) {
      const v = style.getPropertyValue(prop)
      if (!v) continue
      cloneNode.style.setProperty(prop, v)
    }
  }
  // 1) Inline URL-bearing properties
  for (const prop of URL_PROPS) {
    let val = style.getPropertyValue(prop)
    // Fallback: when background-image is none/empty, parse url() from background shorthand (#343)
    if ((prop === 'background-image') && (!val || val === 'none')) {
      const bgShorthand = style.getPropertyValue('background')
      if (bgShorthand && /url\s*\(/.test(bgShorthand)) {
        // Use filter+join to preserve all url() layers, not just the first (#NEW-5)
        val = splitBackgroundImage(bgShorthand).filter(p => /url\s*\(/.test(p)).join(', ') || val
      }
    }
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
}

/**
 * Inlines background-related images and masks from the source tree onto the clone.
 *
 * The worklist is built from the session clone→source nodeMap and filtered by the
 * needsBackgroundInline flag computed during the style snapshot, so the pass no longer
 * re-reads ~40 computed properties on every node — only flagged nodes do real work.
 * Walking the clone tree (descending through clone-only wrappers like the scroll-translate
 * wrapper) also reaches subtrees the old source/clone parallel walk skipped.
 *
 * @param {HTMLElement} source The original source element.
 * @param {HTMLElement} clone The cloned element receiving inline styles.
 * @param {WeakMap} styleCache
 * @param {Object} [options={}]
 * @param {Map<Node, Node>} [nodeMap] Session clone→source map. Must be the capturing
 *   session's own reference: the global cache.session.nodeMap (fallback) is reassigned by
 *   concurrent nested iframe captures and may be an orphaned map by the time this pass runs.
 * @returns {Promise<void>}
 */
export async function inlineBackgroundImages(source, clone, styleCache, options = {}, nodeMap = cache.session.nodeMap) {
  if (!clone) return

  const jobs = []
  if (source && needsBackgroundInline(source)) jobs.push([source, clone])
  const stack = [clone]
  while (stack.length) {
    const cn = stack.pop()
    if (!cn.children) continue
    for (const child of cn.children) {
      if (child.tagName === 'STYLE') continue
      const src = nodeMap.get(child)
      if (src && needsBackgroundInline(src)) jobs.push([src, child])
      stack.push(child)
    }
  }

  // Batch of 6 mirrors inlineImages: bounded fetch concurrency, snapFetch dedupes inflight.
  const BATCH = 6
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.allSettled(
      jobs.slice(i, i + BATCH).map(([s, c]) => inlineBackgroundForNode(s, c, styleCache, options))
    )
  }
}
