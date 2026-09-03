/**
 * Inline url() backgrounds, masks and border-images onto the clone, per node.
 *
 * The style snapshot writes a class rule with `background-image: none` for any remote url()
 * so the shared CSS never points at a resource the svg cannot load. This pass is the one
 * that reads the real value from the live node, fetches it, and puts the data URL on the
 * clone's inline style, together with the layout longhands (position, size, repeat, mask
 * mode) that keep it where it was. Only nodes the snapshot flagged (needsBackgroundInline)
 * are visited. A fixed-attachment layer is frozen to the viewport slice the user saw.
 * @module background
 */
import { isFirefox, isIOS } from '../utils/browser.js'

import { getStyle, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils'
import { needsBackgroundInline, snapshotFor } from './styles.js'

/** Props that can contain url(...) and may need inlining (also drives preCache prefetch) */
export const URL_PROPS = [
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
/** Background longhands copied only when the node has a background at all (see hasBg). */
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
  // Same-capture snapshot reuse (idea validated independently by v2 PR #492's bg reuse):
  // most of the ~19 CSSOM reads per flagged node repeated what inlineAllStyles already
  // resolved. Present in the snapshot -> that value; absent -> pruned by the property
  // universe, i.e. the computed value is the default and there is nothing to copy ('' skips
  // every site below). No snapshot (stale stamps, or the Firefox bg-clip:text fallback) ->
  // plain live reads, exactly the old path.
  //
  // URL-BEARING reads stay LIVE on purpose — snapshot values are NOT the live values there:
  // the snapshot rewrites a non-data url() background-image to 'none' so the shared class
  // never references a remote resource, and THIS pass is the one that re-reads the real
  // value and inlines it per node (d12-backgrounds moved 2.7% on all three engines when
  // these read the sanitized snapshot). Shorthand fallbacks (#343) are live for the same
  // reason snapshots hold longhands only.
  const snap = snapshotFor(srcNode)
  const read = snap
    ? (prop) => (prop in snap ? snap[prop] : '')
    : (prop) => style.getPropertyValue(prop)

  // Border-image present?
  const bi = read('border-image')
  const bis = read('border-image-source')
  const hasBorderImage = (bi && bi !== 'none') || (bis && bis !== 'none')

  // Background layout longhands (position/size/repeat/origin/clip/...) are inert without a
  // background, yet are never empty, so copying them onto every node bloated the markup and
  // rasterization cost. Copy only when a background actually exists. background-color is
  // included so the background-clip:text trick (color clipped to text) still works.
  const bgImage = style.getPropertyValue('background-image')
  const bgColor = read('background-color')
  const hasBg =
    (bgImage && bgImage !== 'none') ||
    (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') ||
    /url\s*\(|gradient\s*\(/i.test(style.getPropertyValue('background') || '')
  // Firefox cannot rasterize background-clip:text in a foreignObject, so the style snapshot
  // already swapped such a background for a plain text colour (applyBgClipTextFallback);
  // re-copying it here would paint the gradient as a full box over the text it stands in for.
  const skipBackground = isFirefox() && (
    read('background-clip') ||
    read('-webkit-background-clip') || ''
  ).includes('text')
  if (hasBg && !skipBackground) {
    for (const prop of BG_LAYOUT_PROPS) {
      const v = read(prop)
      if (!v) continue
      cloneNode.style.setProperty(prop, v)
    }
  }
  // 1) Inline URL-bearing properties
  for (const prop of URL_PROPS) {
    if (skipBackground && prop === 'background-image') continue
    let val = style.getPropertyValue(prop)
    // Fallback: when background-image is none/empty, parse url() from background shorthand (#343)
    if ((prop === 'background-image') && (!val || val === 'none')) {
      const bgShorthand = style.getPropertyValue('background')
      if (bgShorthand && /url\s*\(/.test(bgShorthand)) {
        // Use filter+join to preserve all url() layers, not just the first
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
    const val = read(prop)
    // Skip empty/initial defaults to avoid bloating
    if (!val || val === 'initial') continue
    cloneNode.style.setProperty(prop, val)
  }
  // 3) Copy border-image auxiliaries only if border-image is active
  if (hasBorderImage) {
    for (const prop of BORDER_AUX_PROPS) {
      const val = read(prop)
      if (!val || val === 'initial') continue
      cloneNode.style.setProperty(prop, val)
    }
  }
  // 4) background-attachment: fixed positions/sizes against the browser viewport, but the
  // rasterized SVG's viewport is the element box — the live crop is lost. Freeze the slice
  // the user was seeing (runs only for the rare flagged nodes).
  if (hasBg && /fixed/.test(read('background-attachment') || '')) {
    try { await freezeFixedBackground(srcNode, cloneNode, style) } catch { /* keep uncompensated */ }
  }
}

/** Resolves one background-size spec against the viewport (fixed layers size there). */
function resolveFixedLayerSize(sizeSpec, iw, ih, vw, vh) {
  const spec = (sizeSpec || 'auto').trim()
  if (spec === 'cover' || spec === 'contain') {
    if (!iw || !ih) return null
    const s = spec === 'cover' ? Math.max(vw / iw, vh / ih) : Math.min(vw / iw, vh / ih)
    return { w: iw * s, h: ih * s }
  }
  const parts = spec.split(/\s+/)
  const comp = (v, base) => {
    if (v === 'auto' || v === undefined) return null
    if (v.endsWith('px')) return parseFloat(v)
    if (v.endsWith('%')) return base * parseFloat(v) / 100
    return undefined // calc()/other → unsupported
  }
  const wRaw = comp(parts[0], vw)
  const hRaw = comp(parts[1], vh)
  if (wRaw === undefined || hRaw === undefined) return null
  let w = wRaw, h = hRaw
  if (w == null && h == null) { w = iw; h = ih }
  else if (w == null) w = iw && ih ? h * (iw / ih) : vw
  else if (h == null) h = iw && ih ? w * (ih / iw) : vh
  if (!w || !h) return null
  return { w, h }
}

/** Rewrites fixed background layers to scroll, freezing viewport-resolved size/position
 *  into element-local pixel values so the capture shows the exact slice the user saw.
 *  A calc() size or position leaves that layer as it was. Runs after asset inlining, so the
 *  intrinsic size comes from the data URL. Pinned by __tests__/module.background.fixed.test.js. */
async function freezeFixedBackground(srcNode, cloneNode, style) {
  const attachments = (style.getPropertyValue('background-attachment') || '').split(',').map(s => s.trim())
  // Engines degrade fixed to scroll inside transformed/filtered ancestors, and
  // iOS-lineage engines ignore fixed entirely — match the LIVE rendering: plain rewrite.
  let degraded = isIOS()
  if (!degraded) {
    for (let p = srcNode.parentElement; p && !degraded; p = p.parentElement) {
      const cs = getStyle(p)
      if ((cs.transform && cs.transform !== 'none') || (cs.filter && cs.filter !== 'none')) degraded = true
    }
  }
  if (degraded) {
    cloneNode.style.setProperty('background-attachment', attachments.map(() => 'scroll').join(', '))
    return
  }
  const rect = srcNode.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const layers = splitBackgroundImage(cloneNode.style.backgroundImage || style.getPropertyValue('background-image') || '')
  const sizes = (cloneNode.style.backgroundSize || style.getPropertyValue('background-size') || 'auto').split(',').map(s => s.trim())
  const positions = (cloneNode.style.backgroundPosition || style.getPropertyValue('background-position') || '0% 0%').split(',').map(s => s.trim())
  const outSizes = []
  const outPositions = []
  for (let i = 0; i < layers.length; i++) {
    const att = attachments[i % attachments.length] || 'scroll'
    const size = sizes[i % sizes.length]
    const pos = positions[i % positions.length]
    if (att !== 'fixed') { outSizes.push(size); outPositions.push(pos); continue }
    // Intrinsic dims: gradients have none (they fill the positioning area = viewport).
    let iw = 0, ih = 0
    const urlMatch = layers[i] && layers[i].match(/url\(["']?([^"')]+)["']?\)/)
    if (urlMatch) {
      try {
        const img = new Image()
        img.src = urlMatch[1]
        await img.decode()
        iw = img.naturalWidth; ih = img.naturalHeight
      } catch { outSizes.push(size); outPositions.push(pos); continue }
    }
    const resolved = urlMatch
      ? resolveFixedLayerSize(size, iw, ih, vw, vh)
      : { w: vw, h: vh } // gradient: positioning area is the viewport
    if (!resolved) { outSizes.push(size); outPositions.push(pos); continue }
    // Position % resolves against (area - image); px is absolute. calc() → bail this layer.
    const posParts = pos.split(/\s+/)
    const comp = (v, area, img) => {
      if (!v) return 0
      if (v.endsWith('px')) return parseFloat(v)
      if (v.endsWith('%')) return (area - img) * parseFloat(v) / 100
      return undefined
    }
    const px = comp(posParts[0] || '0%', vw, resolved.w)
    const py = comp(posParts[1] || posParts[0] || '0%', vh, resolved.h)
    if (px === undefined || py === undefined) { outSizes.push(size); outPositions.push(pos); continue }
    outSizes.push(`${limitPx(resolved.w)}px ${limitPx(resolved.h)}px`)
    outPositions.push(`${limitPx(px - rect.left)}px ${limitPx(py - rect.top)}px`)
  }
  cloneNode.style.setProperty('background-size', outSizes.join(', '))
  cloneNode.style.setProperty('background-position', outPositions.join(', '))
  cloneNode.style.setProperty('background-attachment', attachments.map(() => 'scroll').join(', '))
}

/** Two decimals, enough for a px value and short in the payload. */
const limitPx = (n) => Math.round(n * 100) / 100

/**
 * Inlines background-related images and masks from the source tree onto the clone.
 *
 * The worklist is built from the session clone→source nodeMap and filtered by the
 * needsBackgroundInline flag computed during the style snapshot, so the pass no longer
 * re-reads ~40 computed properties on every node — only flagged nodes do real work.
 * Walking the clone tree (descending through clone-only wrappers like the scroll-translate
 * wrapper) also reaches subtrees the old source/clone parallel walk skipped. Pairing through
 * nodeMap instead of child index is what keeps a clone-only <svg> of inlined defs from
 * shifting every background one sibling over (#439). Also runs on the differential path
 * (diff.js) for the rebuilt subtree. Pinned by __tests__/module.background.test.js and
 * __tests__/module.background.masks.test.js.
 *
 * @param {HTMLElement} source The original source element.
 * @param {HTMLElement} clone The cloned element receiving inline styles.
 * @param {WeakMap} styleCache
 * @param {Object} [options={}]
 * @param {Map<Node, Node>} [nodeMap] Session clone→source map (the capturing session's
 *   own reference; the empty-map default only serves direct test calls).
 * @returns {Promise<void>}
 */
export async function inlineBackgroundImages(source, clone, styleCache, options = {}, nodeMap = new Map()) {
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
