/**
 * Style snapshots: one object of computed values per node, and the caches that keep them
 * across captures.
 *
 * `inlineAllStyles` is the entry. Per node it snapshots the computed style (only the props
 * the page's CSS can touch, see styleScan.js), keys it, and stores the key on the session's
 * styleMap for the class CSS the engine emits. That snapshot is the dominant cost of a
 * capture, so most of this file is about not taking it: a cross-capture cache guarded by
 * one version per record and a probe of the used values it froze (`getSnapshot`).
 *
 * Around it: core/changes.js observes what makes a cached snapshot stale, authorStyles.js
 * says which properties the page's CSS can touch, styleShare.js lets structural twins copy
 * one read within a capture, and styleFreeze.js holds the rewrites that keep the clone's
 * layout (gutter, border box, one-line pin, wrapper heights).
 * @module styles
 */

import { getStyleKey, softensWidth, softenNeedsAutoWidth, shouldIgnoreProp, getStyle, NO_DEFAULTS_TAGS } from '../utils/index.js'
import { isFirefox, isSafari } from '../utils/browser.js'
import { cache } from '../core/cache.js'
import {
  seq, env, bumpEpoch, bumpSeq, stampNode, stampSubtree, stampOf, shadowHostsOf, setupInvalidationOnce,
} from '../core/changes.js'
import { universeFor, importantPropsFor } from './authorStyles.js'
import { SHARE_SKIP_TAGS, shareStateOf, identityFor, shareLists } from './styleShare.js'
import {
  addScrollbarGutter, freezeBorderBox, syncInlineBorderBox, freezeOneLine, stripHeightForWrappers,
  isFlexOrGridItem, BORDER_WIDTHS,
} from './styleFreeze.js'

// Old homes of what moved out, for the test files that import it from here.
export * from './authorStyles.js'
export { styleShareSafe, pseudoSnapshotFor } from './styleShare.js'
export { addScrollbarGutter, ONE_LINE_PROP } from './styleFreeze.js'
export {
  notifyStyleEpoch, hasExternalMutation, isExternalRecord, getOutsideMutationCount,
  getStyleEnvEpoch, getStyleEpoch, getStyleStamp, invalidateStyleCaches, observeShadowRoot,
  invalidateHoverChanges, flushStyleInvalidations,
} from '../core/changes.js'

/** element -> { v, checked, hosts, snapshot, embedFonts, excludeStyleProps, used }.
 *  Cross-capture; a hit needs `v` unchanged (snapshotIsCurrent) and the used values to hold. */
const snapshotCache = new WeakMap()
const MARGIN_PROPS = [
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end',
]
/** style signature -> class key. FIFO-bounded at insertion, see MAX_SNAPSHOT_KEY_CACHE. */
const snapshotKeyCache = new Map()
/** PERF-4: evict snapshotKeyCache when it grows beyond this size.
 *  Each entry stores a long CSS signature string → key string. In SPAs with many
 *  unique element styles, this Map can grow without bound and leak memory. */
const MAX_SNAPSHOT_KEY_CACHE = 2000

/** Deletes cached style snapshots under a root. Animated subtrees re-snapshot per diff
 *  frame: animations repaint without mutation records, so the epoch never bumps and the
 *  cache would freeze the first captured frame. */
export function invalidateSnapshotsUnder(root) {
  if (!root || root.nodeType !== 1) return
  // An animated box pushes the boxes beside it, which keep their snapshots and their stamps.
  bumpSeq()
  snapshotCache.delete(root)
  try {
    const tw = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    while (tw.nextNode()) snapshotCache.delete(tw.currentNode)
  } catch { }
}

/**
 * List what each animation target has animated, as target -> longhand names. An animation
 * or a transition outranks the target's inline declarations, so inlineAllStyles re-resolves
 * those from the computed style, and only those: re-resolving them all wrote the used
 * `width` of a flex item over its authored one, and the clone shrank it a second time.
 * Keyframes name longhands, except a script-made effect, which keeps the shorthand it was
 * given; a detached declaration expands it. An effect on a pseudo-element animates nothing
 * of the element's own.
 * Pinned by `__tests__/core.capture.animationFrames.test.js`.
 * @param {Iterable<Animation>} animations
 * @returns {Map<Element, Set<string>>|null} null when nothing is animated
 */
export function animatedProps(animations) {
  let out = null
  for (const a of animations) {
    const target = a.effect?.target
    if (!target || a.effect.pseudoElement) continue
    let props = (out ||= new Map()).get(target)
    if (!props) out.set(target, props = new Set())
    const probe = target.ownerDocument.createElement('div').style
    for (const frame of a.effect.getKeyframes()) {
      for (const key in frame) {
        if (key === 'offset' || key === 'easing' || key === 'composite' || key === 'computedOffset') continue
        if (key.startsWith('--')) props.add(key)
        else probe[key] = frame[key]
      }
    }
    for (let i = 0; i < probe.length; i++) props.add(probe[i])
  }
  return out
}

/** URL-bearing props that mean inlineBackgroundImages must visit the node. */
const BG_INLINE_FLAG_PROPS = [
  'mask', 'mask-image', '-webkit-mask', '-webkit-mask-image',
  'mask-source', 'mask-box-image-source', 'mask-border-source', '-webkit-mask-box-image-source',
  'border-image', 'border-image-source',
]

/**
 * Whether the background-inline pass has work on this element, per its cached style snapshot.
 * Unknown (no fresh snapshot — STYLE tags, SVG template descendants) → true, so callers fall
 * back to processing the node like before.
 * @param {Element} source
 * @returns {boolean}
 */
export function needsBackgroundInline(source) {
  const rec = snapshotCache.get(source)
  if (rec && snapshotIsCurrent(rec, source)) {
    const f = rec.snapshot && rec.snapshot.__needsBgInline
    if (f !== undefined) return f
  }
  return true
}

/**
 * The element's current style snapshot, or null when there is none to trust. The background
 * pass reads through this instead of the CSSOM: a prop present in the snapshot is the value
 * the capture already resolved, and a prop ABSENT from it was pruned by the property
 * universe — the page cannot touch it, so its computed value is the default and there is
 * nothing to copy. Nodes carrying the Firefox background-clip:text fallback are excluded:
 * their snapshot background props were deliberately swapped (applyBgClipTextFallback) and
 * the background pass must keep seeing the live values it was written against.
 * @param {Element} source
 * @returns {object|null}
 */
export function snapshotFor(source) {
  const rec = snapshotCache.get(source)
  if (!rec || !snapshotIsCurrent(rec, source)) return null
  const snap = rec.snapshot
  if (!snap || snap.__bgClipTextFix) return null
  return snap
}

const readableCache = new WeakMap()
/** The universe minus the props shouldIgnoreProp drops, in the Set's order. Rebuilt when the
 *  Set grows; the universe Sets are only ever added to, so an equal size is an equal Set. */
function readableProps(universe) {
  let rec = readableCache.get(universe)
  if (!rec || rec.size !== universe.size) {
    readableCache.set(universe, rec = { size: universe.size, list: [...universe].filter((p) => !shouldIgnoreProp(p)) })
  }
  return rec.list
}

/**
 * The full computed-style read for one element: every property in `universe` (all of them
 * when null) plus the element's own inline props, with the fix-ups the snapshot needs. An
 * external url() becomes none, text-decoration and text-stroke are read by name because some
 * engines do not enumerate them, four zero borders collapse to `border: none` (#362), and
 * Firefox gets the background-clip:text fallback.
 * @param {CSSStyleDeclaration} style
 * @param {object} [options] - embedFonts adds the font-feature props; excludeStyleProps filters
 * @param {Element|null} [el] - for its inline style
 * @param {Set<string>|null} [universe] - from universeFor; null reads everything
 * @returns {Record<string, string>}
 */
function snapshotComputedStyleFull(style, options = {}, el = null, universe = null) {
  const out = {}
  const excludeStyleProps = options.excludeStyleProps
  const readProp = (prop) => {
    if (excludeStyleProps) {
      if (excludeStyleProps instanceof RegExp && excludeStyleProps.test(prop)) return
      if (typeof excludeStyleProps === 'function' && excludeStyleProps(prop)) return
    }
    let val = style.getPropertyValue(prop)
    if (!val) return
    if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
      val = 'none'
    }
    out[prop] = val
  }
  const addProp = (prop) => {
    if (out[prop] !== undefined || shouldIgnoreProp(prop)) return
    readProp(prop)
  }
  if (universe) {
    // Pruned read: only properties the page's CSS (or this element's inline style) can
    // move off their UA defaults — anything else diffs empty downstream anyway.
    const list = readableProps(universe)
    for (let i = 0; i < list.length; i++) readProp(list[i])
    const inline = el && el.style
    if (inline && inline.length) {
      for (let i = 0; i < inline.length; i++) addProp(inline[i])
    }
  } else {
    for (let i = 0; i < style.length; i++) addProp(style[i])
  }
    // Ensure text-decoration props: some engines do not list them in the iteration.
  const EXTRA_TEXT_DECORATION_PROPS = [
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'text-decoration-thickness',
    'text-underline-offset',
    'text-decoration-skip-ink'
  ]
  for (const prop of EXTRA_TEXT_DECORATION_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  // #340: -webkit-text-stroke on Safari. Capture it even when the iteration omits it.
  const TEXT_STROKE_PROPS = [
    '-webkit-text-stroke',
    '-webkit-text-stroke-width',
    '-webkit-text-stroke-color',
    'paint-order'
  ]
  for (const prop of TEXT_STROKE_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  if (options.embedFonts) {
    const EXTRA_FONT_PROPS = [
      'font-feature-settings',
      'font-variation-settings',
      'font-kerning',
      'font-variant',
      'font-variant-ligatures',
      'font-optical-sizing',
    ]
    for (const prop of EXTRA_FONT_PROPS) {
      if (out[prop]) continue
      try {
        const v = style.getPropertyValue(prop)
        if (v) out[prop] = v
      } catch { }
    }
  }
  // Keep visibility as visibility. Unlike opacity, it is inherited but a child may explicitly
  // restore `visibility: visible`; flattening a hidden ancestor to opacity:0 makes that legal,
  // painted descendant impossible to recover.
  // content-visibility:hidden skips the element's CONTENTS while still painting the element's
  // own box (background, border, padding) - verified against real Chromium. Carry the
  // declaration itself so the rasterizer applies those exact semantics: mapping it to
  // visibility:hidden would erase the box too, and a descendant could override it back, which
  // the real property does not allow. Read explicitly because content-visibility is not always
  // enumerated in the style.length iteration.
  try {
    const cv = out['content-visibility'] || style.getPropertyValue('content-visibility')
    if (cv === 'hidden') out['content-visibility'] = 'hidden'
  } catch { /* ignore */ }

  // Flag whether inlineBackgroundImages has any work on this node (bg/mask/border-image or a
  // background-color that needs its layout longhands for background-clip:text). Read from the
  // live declaration (not `out`) so excludeStyleProps or the url()→none rewrite can't hide it.
  // Stored non-enumerable so key generation/signature iteration never sees it.
  Object.defineProperty(out, '__needsBgInline', { value: computeNeedsBgInline(style), enumerable: false })

  // #362: Tailwind's * { border: 0 solid } renders incorrectly in capture.
  // When all border widths are 0, normalize to border: none for unambiguous output.
  const bt = parseFloat(style.getPropertyValue('border-top-width') || 0) || 0
  const br = parseFloat(style.getPropertyValue('border-right-width') || 0) || 0
  const bb = parseFloat(style.getPropertyValue('border-bottom-width') || 0) || 0
  const bl = parseFloat(style.getPropertyValue('border-left-width') || 0) || 0
  if (bt === 0 && br === 0 && bb === 0 && bl === 0) {
    // If border-image is being used (even with zero border widths), do NOT force
    // the shorthand `border: none` because it can override the intended rendering.
    // (Decorative border-image + 0 widths is valid CSS in some setups.)
    const bis = (style.getPropertyValue('border-image-source') || '').trim()
    const hasBorderImage = bis && bis !== 'none'
    const BORDER_PROPS = [
      'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
      'border-width', 'border-style', 'border-color',
      'border-top-width', 'border-top-style', 'border-top-color',
      'border-right-width', 'border-right-style', 'border-right-color',
      'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
      'border-left-width', 'border-left-style', 'border-left-color',
      'border-block', 'border-block-width', 'border-block-style', 'border-block-color',
      'border-inline', 'border-inline-width', 'border-inline-style', 'border-inline-color',
      // The per-side logical longhands too, or they survive the normalization and re-declare
      // a zero-width solid border after the `border: none` emitted below.
      'border-block-start', 'border-block-start-width', 'border-block-start-style', 'border-block-start-color',
      'border-block-end', 'border-block-end-width', 'border-block-end-style', 'border-block-end-color',
      'border-inline-start', 'border-inline-start-width', 'border-inline-start-style', 'border-inline-start-color',
      'border-inline-end', 'border-inline-end-width', 'border-inline-end-style', 'border-inline-end-color',
    ]
    for (const p of BORDER_PROPS) delete out[p]
    if (!hasBorderImage) out['border'] = 'none'
  }

  applyBgClipTextFallback(out)

  return out
}
/**
 * Firefox cannot rasterize background-clip:text inside an SVG foreignObject image: the
 * background is dropped entirely, so gradient text whose own colour is transparent captures as
 * nothing at all (verified on v3: 0 painted pixels against Chromium's 1198 for the same span).
 * Approximate it with a plain text colour — the average of the gradient's stops — which loses
 * the gradient but keeps the words. Only fires when the text would otherwise be invisible.
 * Pinned by __tests__/module.styles.bgClipText.test.js.
 *
 * Imported from @frostin/snapdom (element-mirror).
 * @param {Record<string,string>} out mutable style snapshot
 */
function applyBgClipTextFallback(out) {
  if (!isFirefox()) return
  /* c8 ignore start -- Firefox only; coverage runs on chromium */
  const clip = out['background-clip'] || out['-webkit-background-clip']
  if (!clip || !clip.includes('text')) return
  const transparent = (v) => v === 'transparent' || v === 'rgba(0, 0, 0, 0)'
  // -webkit-text-fill-color paints the glyphs when set; color is the fallback.
  const fill = out['-webkit-text-fill-color']
  if (!transparent(fill !== undefined ? fill : out['color'])) return
  const solid = bgClipTextFallbackColor(out['background-image'], out['background-color'])
  if (!solid) return
  if (transparent(out['color'])) out['color'] = solid
  if (fill !== undefined) out['-webkit-text-fill-color'] = solid
  out['background-image'] = 'none'
  out['background-color'] = 'transparent'
  delete out['background-clip']
  delete out['-webkit-background-clip']
  // Other passes re-inline the live values onto the clone over the class this snapshot
  // becomes (resolveCSSVars materializes the transparent colour, the authored inline-style
  // normalization re-inlines the gradient), so the fallback is also written inline with
  // !important; inlineAllStyles reads this marker. Non-enumerable: signature and key
  // iteration must not see it.
  Object.defineProperty(out, '__bgClipTextFix', { value: solid, enumerable: false })
  /* c8 ignore stop */
}

/**
 * WebKit paints no text-shadow under `-webkit-text-stroke` inside an SVG foreignObject image
 * (real Safari 27.0.1 and Playwright WebKit, hand-written svg: 802 shadow pixels without the
 * stroke, 0 with it), while `filter: drop-shadow()` still paints (662). The clone trades the
 * one for the other where they are the same picture: a leaf whose only ink is its text, and a
 * single shadow, since chained drop-shadows also shadow each other. WebKit reads a
 * drop-shadow blur as a deviation, twice a text-shadow's, hence the halving. #531, pinned by
 * __tests__/module.styles.strokedTextShadow.test.js.
 * @param {Element} source
 * @param {HTMLElement} clone
 * @param {CSSStyleDeclaration} cs - the source's computed style
 */
function strokedTextShadowToFilter(source, clone, cs) {
  const shadow = cs.textShadow
  if (!shadow || shadow === 'none' || !(parseFloat(cs.webkitTextStrokeWidth) > 0)) return
  if (source.firstElementChild || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
      colorToRgba(cs.backgroundColor)[3] !== 0 ||
      ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0)) return
  // One layer: a comma outside a colour function would start a second.
  if (shadow.replace(/\([^)]*\)/g, '').includes(',')) return
  const color = (shadow.match(/(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|#[\da-f]+|\b[a-z]+\b/i) || [])[0]
  const [x = 0, y = 0, blur = 0] = (shadow.match(/-?[\d.]+px/g) || []).map(parseFloat)
  if (!color) return
  const filter = cs.filter && cs.filter !== 'none' ? `${cs.filter} ` : ''
  clone.style.setProperty('text-shadow', 'none', 'important')
  clone.style.setProperty('filter', `${filter}drop-shadow(${x}px ${y}px ${blur / 2}px ${color})`, 'important')
}

/** A computed colour function. Computed values resolve var() and color-mix(), so none nests. */
const COLOR_FN_RE = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)/g
let colorProbe

/**
 * The sRGB channels and alpha (0-255) of a computed colour, painted on a 1x1 canvas. Computed
 * styles keep oklch(), lab() and color() as authored (Firefox, WebKit), so a regex over rgb()
 * found no colour in a Tailwind v4 palette.
 * @param {string} color
 * @returns {Uint8ClampedArray}
 */
export function colorToRgba(color) {
  if (!colorProbe) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    colorProbe = c.getContext('2d', { willReadFrequently: true })
  }
  colorProbe.clearRect(0, 0, 1, 1)
  // An unparsable value leaves fillStyle as it was: reset it so that reads as transparent.
  colorProbe.fillStyle = 'transparent'
  colorProbe.fillStyle = color
  colorProbe.fillRect(0, 0, 1, 1)
  return colorProbe.getImageData(0, 0, 1, 1).data
}

/**
 * A single colour standing in for a clipped-to-text background: the channel average of every
 * visible colour in the background-image, else the background-color. Firefox serializes
 * oklch(), lab(), color-mix() and display-p3 stops as colour functions, and before they were
 * resolved the text captured with 0 painted pixels. Pinned by
 * __tests__/module.styles.bgClipText.test.js.
 * @param {string} [backgroundImage]
 * @param {string} [backgroundColor]
 * @returns {string|null}
 */
export function bgClipTextFallbackColor(backgroundImage, backgroundColor) {
  const collect = (value) => {
    const colors = []
    for (const fn of (value || '').match(COLOR_FN_RE) || []) {
      const [r, g, b, a] = colorToRgba(fn)
      if (a > 13) colors.push([r, g, b]) // alpha above 0.05
    }
    return colors
  }
  let colors = collect(backgroundImage)
  if (!colors.length) colors = collect(backgroundColor)
  if (!colors.length) return null
  const sum = [0, 0, 0]
  for (const [r, g, b] of colors) {
    sum[0] += r
    sum[1] += g
    sum[2] += b
  }
  return `rgb(${sum.map((c) => Math.round(c / colors.length)).join(', ')})`
}

/** ~10-read probe behind __needsBgInline (also run standalone for NO_DEFAULTS_TAGS,
 *  which skip the full snapshot but can still carry an external mask/border-image). */
function computeNeedsBgInline(style) {
  const bgi = style.getPropertyValue('background-image')
  if (bgi && bgi !== 'none') return true
  const bgc = style.getPropertyValue('background-color')
  if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') return true
  for (const p of BG_INLINE_FLAG_PROPS) {
    const v = style.getPropertyValue(p)
    if (v && v !== 'none') return true
  }
  // #343: some engines report background-image:none while the shorthand carries url()
  const sh = style.getPropertyValue('background')
  return !!(sh && /url\s*\(/i.test(sh))
}

/**
 * Cheap "is this box sized by its own content?" check: any child element or non-whitespace
 * direct text node. O(1) amortized (firstElementChild short-circuits); never reads textContent
 * so it can't go O(n²) on deep trees.
 * @param {Element} el
 */
function hasRenderedContent(el) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue || '')) return true
    // #454: an out-of-flow child doesn't size its parent — KaTeX's .hide-tail span
    // (width:100%, abspos svg inside) is sized by CSS, not content, so its width
    // must be kept verbatim instead of softened away.
    if (n.nodeType === 1) {
      const pos = getStyle(n).position
      if (pos !== 'absolute' && pos !== 'fixed') return true
    }
  }
  return false
}
/**
 * Whether the element's width is author-specified (a length/percentage) rather than derived from
 * its content or from the layout algorithm around it.
 *
 * `getComputedStyle().width` cannot answer this: it resolves to the USED width, so `auto` and
 * `width: 16px` both come back as `16px`. Typed OM reports the COMPUTED value, where `auto` stays
 * `auto` — that is the exact question, and it is available in Chromium and WebKit. Firefox has no
 * Typed OM, so there the answer is inferred from layout instead (see the two probes below).
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs live computed style of `el`
 * @param {boolean} isFlexItem
 */
function hasSpecifiedWidth(el, cs, isFlexItem) {
  try {
    if (typeof el.computedStyleMap === 'function') {
      const v = el.computedStyleMap().get('width')
      if (v != null) return !isContentWidthKeyword(String(v).trim().toLowerCase())
    }
  } catch { /* fall through to the layout probes */ }
  /* c8 ignore start -- reached without Typed OM (Firefox); coverage runs on chromium */
  const inlineWidth = el.style && (el.style.width || el.style.inlineSize)
  if (inlineWidth && !isContentWidthKeyword(String(inlineWidth).trim().toLowerCase())) return true
  // A box that hugs its content is sized by it — `width: max-content` / `fit-content` land here
  // too, and those must keep softening. For a block-level box, also require that the used width
  // is not simply the available width (that is what plain `width: auto` gives).
  if (!contentNarrowerThanBox(el, cs)) return false
  return isFlexItem || usedWidthDiffersFromAvailable(el, cs)
  /* c8 ignore stop */
}

/** Computed `width` values that still let the box be sized by its content or its container. */
const CONTENT_WIDTH_KEYWORDS = new Set([
  'auto', 'min-content', 'max-content', 'stretch', 'fill-available', '-webkit-fill-available',
])
function isContentWidthKeyword(value) {
  // fit-content(<length>) too: the box still shrinks around its content.
  return CONTENT_WIDTH_KEYWORDS.has(value) || value.startsWith('fit-content')
}

/**
 * Fallback probe for flex/grid items: an item sized by its own content is exactly as wide as that
 * content, so a content box wider than everything inside it means the width came from CSS.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
/* c8 ignore start -- only reached without Typed OM (Firefox) */
function contentNarrowerThanBox(el, cs) {
  const box = el.getBoundingClientRect().width -
    (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) -
    (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0)
  if (!(box > 0)) return false
  let left = Infinity, right = -Infinity, range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    let r
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      r = range.getBoundingClientRect()
      if (!r.width && !r.height) continue
    } else if (n.nodeType === 1) {
      const s = getStyle(n)
      if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
      r = n.getBoundingClientRect()
    } else continue
    if (r.left < left) left = r.left
    if (r.right > right) right = r.right
  }
  if (right === -Infinity) return false
  return (right - left) < box - 0.5
}

/**
 * Fallback probe for block-level boxes in normal flow: with `width: auto` they fill the
 * containing block, so a used width that differs from the available width was authored.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
function usedWidthDiffersFromAvailable(el, cs) {
  const parent = el.parentElement
  if (!parent) return false
  const pcs = getStyle(parent)
  const available = parent.getBoundingClientRect().width -
    (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0) -
    (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0) -
    (parseFloat(cs.marginLeft) || 0) - (parseFloat(cs.marginRight) || 0)
  if (!(available > 0)) return false
  return Math.abs(el.getBoundingClientRect().width - available) > 0.5
}
/* c8 ignore stop */

const __snapshotSig = new WeakMap()
/** The snapshot's key into snapshotKeyCache, memoized per snapshot object. */
function styleSignature(snap, tag) {
  let sig = __snapshotSig.get(snap)
  if (sig) return sig
  // Built in INSERTION order, not sorted. This string is only ever a key into
  // snapshotKeyCache — never rendered, serialized, or compared for ordering — and
  // snapshotComputedStyleFull fills every snapshot by walking the same property universe, so
  // two equal snapshots already come out in the same order. The sort was a per-element
  // reordering of an already-ordered list, paid on the COLD path that every one-shot capture
  // takes: Object.entries + sort + map + join over ~130 properties, once per element.
  // Measured on a 1500-node table, per-element cold cost: 118ms sorted -> 77ms here (-35%),
  // with the warm path unchanged.
  //
  // Use push + join, NOT `sig +=`. The concatenating form builds a cons-string that V8 has
  // to flatten the moment it is used as a Map key, which moved the cost rather than removing
  // it (warm went 21ms -> 30ms while cold improved). join produces a flat string directly.
  //
  // The separator is U+0001 rather than the old `:`/`;` because both of those occur inside
  // real property values (a data: URL, a quoted font-family), so the old format could in
  // principle collide two different snapshots onto one key. A control character cannot
  // appear in a computed value.
  //
  // The only cost of dropping the sort is that two elements whose INLINE style properties
  // were authored in a different order now miss each other in the key cache — one extra
  // getStyleKey call, never a wrong key. `__needsBgInline` is non-enumerable, so for...in
  // sees exactly what Object.entries saw.
  // The diff depends on the tag's defaults even when snapshots are equal (#505).
  const parts = [tag]
  for (const k in snap) parts.push(k, snap[k])
  sig = parts.join('\u0001')
  __snapshotSig.set(snap, sig)
  return sig
}
/** A cached snapshot is current while its version is still the newest among what it depends
 *  on: the environment and whatever a selector could follow to this node (changes.js). */
function snapshotIsCurrent(rec, el) {
  return rec.v === stampOf(el, rec.hosts)
}

/** The four sides of a `margin` or `inset` shorthand as computed style serializes it. */
function fourSides(shorthand) {
  const v = shorthand.split(' ')
  return v.length === 4 ? shorthand : `${v[0]} ${v[1] ?? v[0]} ${v[2] ?? v[0]} ${v[3] ?? v[1] ?? v[0]}`
}

const INSET_PROPS = ['top', 'right', 'bottom', 'left']
const NO_SIDES = '0px 0px 0px 0px'

/** The four values of `props` as the snapshot holds them, null when excludeStyleProps took one. */
function frozenSides(snap, props) {
  const a = snap[props[0]], b = snap[props[1]], c = snap[props[2]], d = snap[props[3]]
  return a === undefined || b === undefined || c === undefined || d === undefined ? null : `${a} ${b} ${c} ${d}`
}

/**
 * Whether four sides still read as the snapshot froze them. Chromium and WebKit serialize the
 * used values in the shorthand, one read for the four. Firefox serializes the computed ones
 * (`auto auto 0px 0px` for a box pinned to its bottom left, `0px auto` for a centred block),
 * so a shorthand that differs is asked again side by side before it counts as a change.
 * @param {CSSStyleDeclaration} style
 * @param {string} frozen - the four used values, space separated
 * @param {string} shorthand - 'inset' or 'margin'
 * @param {string[]} sides - its four physical longhands
 * @returns {boolean}
 */
function sidesHold(style, frozen, shorthand, sides) {
  return fourSides(style.getPropertyValue(shorthand)) === frozen ||
    `${style.getPropertyValue(sides[0])} ${style.getPropertyValue(sides[1])} ${style.getPropertyValue(sides[2])} ${style.getPropertyValue(sides[3])}` === frozen
}

/**
 * Note what a fresh snapshot froze that layout can move while the cascade stands still: the
 * node's own box, the offsets of a positioned box, the margins a flex line, a grid area or
 * an absolutely positioned box hands out, and the tracks of a grid. Offsets that all read
 * 0px on a relative box and margins that all read 0px are left out: the first hold nothing,
 * and the second are either zero by the cascade or an `auto` the read below puts back as the
 * keyword. Where Typed OM cannot tell (Firefox) the zero margins are noted too. Read off the
 * snapshot before any pass rewrites it, so it costs no computed-style read.
 * @param {Record<string, string>} snap
 * @param {Element} el
 * @param {boolean} flexItem - its parent is a flex or grid container
 * @returns {{w: string|undefined, h: string|undefined, box: number[]|null|false, inset: string|null, margin: string|null, tracks: string|null}}
 *   `box` is false when the snapshot froze no box (an inline one, or excludeStyleProps took
 *   it), null until the first check reads the rectangle
 */
function usedValuesOf(snap, el, flexItem) {
  const w = snap.width, h = snap.height
  const used = { w, h, box: w === undefined || h === undefined || (w === 'auto' && h === 'auto') ? false : null, inset: null, margin: null, tracks: null }
  const position = snap.position
  const out = position === 'absolute' || position === 'fixed'
  if (out || position === 'relative' || position === 'sticky') {
    const inset = frozenSides(snap, INSET_PROPS)
    if (inset && (out || inset !== NO_SIDES)) used.inset = inset
  }
  if (out || flexItem) {
    const margin = frozenSides(snap, MARGIN_PROPS)
    if (margin && (margin !== NO_SIDES || typeof el.computedStyleMap !== 'function')) used.margin = margin
  }
  if ((snap.display || '').includes('grid')) {
    const columns = snap['grid-template-columns'], rows = snap['grid-template-rows']
    if (columns !== undefined && rows !== undefined) used.tracks = columns + '/' + rows
  }
  return used
}

/**
 * Whether the used values a cached snapshot froze still read the same. The box is compared
 * through getBoundingClientRect: on a recapture of the 250-row table after a nested edit it
 * costs 5% where reading `width` and `height` costs 10%, and `offsetWidth` with
 * `offsetHeight` 4% while missing a change below one pixel (Chromium, paired rounds). The
 * first check after a read compares the two strings once and keeps the rectangle for the
 * next ones.
 * @param {ReturnType<typeof usedValuesOf>} used
 * @param {Element} el
 * @param {CSSStyleDeclaration} style
 * @returns {boolean}
 */
function usedValuesHold(used, el, style) {
  if (used.box !== false) {
    const rect = el.getBoundingClientRect()
    if (used.box) {
      if (rect.width !== used.box[0] || rect.height !== used.box[1]) return false
    } else {
      if (style.getPropertyValue('width') !== used.w || style.getPropertyValue('height') !== used.h) return false
      used.box = [rect.width, rect.height]
    }
  }
  return (!used.inset || sidesHold(style, used.inset, 'inset', INSET_PROPS)) &&
    (!used.margin || sidesHold(style, used.margin, 'margin', MARGIN_PROPS)) &&
    (!used.tracks || style.getPropertyValue('grid-template-columns') + '/' + style.getPropertyValue('grid-template-rows') === used.tracks)
}

/**
 * The element's snapshot: the cached one while it is current, else a fresh full read, or on
 * an identity hit a copy of the twin's read with only the used-value props re-read here.
 * Current means the stamp AND the used values: a cached snapshot is served only while what
 * it froze of the layout still reads the same, and a re-read that finds another box passes
 * the miss on to what resolves against that box (see the stamp note). The used values are
 * read again only once some stamp has moved since they last held (the node clock): a
 * recapture of a page where nothing happened pays one comparison a node.
 * @param {Element} el
 * @param {CSSStyleDeclaration|null} [preStyle] - getComputedStyle(el), when the caller has it
 * @param {object} [options]
 * @param {{st: object, id: number}|null} [shareInfo] - the identity to share under, or null
 * @param {object|null} [session] - the capture's sessionCache, for shadow content's universe
 * @param {boolean} [flexItem] - its parent is a flex or grid container, for usedValuesOf
 * @returns {Record<string, string>}
 */
function getSnapshot(el, preStyle = null, options = {}, shareInfo = null, session = null, flexItem = false) {
  const rec = snapshotCache.get(el)
  // The snapshot content depends on embedFonts (extra font props) and excludeStyleProps
  // (skipped props), which no invalidation signal tracks. Capturing the same element twice
  // with different options must not reuse the snapshot (#348). Callback identity cannot
  // reveal changes to its closure, so function policies always take a fresh snapshot even
  // when the caller already bypassed result memoization.
  const ef = !!(options && options.embedFonts)
  const ex = (options && options.excludeStyleProps) || null
  const style = preStyle || getComputedStyle(el)
  if (typeof ex !== 'function' && rec && snapshotIsCurrent(rec, el) &&
      rec.embedFonts === ef && rec.excludeStyleProps === ex &&
      (rec.checked === seq || usedValuesHold(rec.used, el, style))) {
    rec.checked = seq
    return rec.snapshot
  }
  let snap
  let dyn = null
  const shared = shareInfo && shareInfo.st.snaps.get(shareInfo.id)
  if (shared) {
    // Identity hit: copy the shared full read, then re-read only the layout-varying props on
    // THIS node. The non-enumerable riders carry over: __bgClipTextFix derives from colors,
    // and __needsBgInline from the PRESENCE of url()/gradient/mask/border-image values —
    // all non-geometry computed values, identical between identity twins by construction
    // (same matched rules; animations disable the share). Recomputing the flag per twin was
    // 7 live reads a node for an answer the identity already holds.
    snap = { ...shared.snap }
    // Direct loop over the identity's re-read list (built on its first twin): the old form
    // walked all ~150 keys with a regex test per key, per twin (10.8ms of getSnapshot
    // self-time on the 500-row table, profiled). The values feed `dyn`, which composes this
    // twin's snapshotKeyCache signature from the identity's base signature — styleSignature
    // re-hashed the whole snapshot per twin for another 11ms otherwise.
    const rrList = shared.rr || shareLists(shared, el)
    dyn = []
    for (let i = 0; i < rrList.length; i++) {
      const p = rrList[i]
      const v = style.getPropertyValue(p)
      if (v) snap[p] = v
      else delete snap[p]
      dyn.push(v)
    }
    Object.defineProperty(snap, '__needsBgInline', { value: shared.snap.__needsBgInline, enumerable: false })
    if (shared.snap.__bgClipTextFix !== undefined) {
      Object.defineProperty(snap, '__bgClipTextFix', { value: shared.snap.__bgClipTextFix, enumerable: false })
    }
  } else {
    snap = snapshotComputedStyleFull(style, options, el, universeFor(el, session))
    if (shareInfo) {
      // Stored by REFERENCE, with the riders it already carries: the copy that used to be
      // made here, plus a re-read list and a base signature per identity, cost 27 ms of a
      // 134 ms pipeline on a tree whose nodes are all unique (the deep-tree scene: 1,936
      // leaves, each with its own inline background) for lists no twin ever read. One
      // pass mutates this object after it is stored:
      // stripHeightForWrappers judges this node's OWN children, so it may delete height /
      // block-size that a twin keeps — the flags let shareLists put them back on the
      // re-read list, where the twin reads its own.
      shareInfo.st.snaps.set(shareInfo.id, { snap, rr: null, sig: null, h: 'height' in snap, b: 'block-size' in snap })
    }
  }
  const used = usedValuesOf(snap, el, flexItem)
  // Chromium can report a zero used margin after a partial container layout even
  // though the box remains centered. Typed OM retains the resolved `auto` keyword;
  // carrying it lets the frozen parent/child dimensions reproduce that alignment.
  // Keep ordinary nonzero used margins unchanged, and respect excluded properties.
  // The keyword is a computed value, the same for every twin of an identity, so the share
  // record keeps each answer and Typed OM is asked once per identity and side.
  let restoredAutoMargin = false
  if (typeof el.computedStyleMap === 'function') {
    const twins = shared || (shareInfo ? shareInfo.st.snaps.get(shareInfo.id) : null)
    let typed
    for (const prop of MARGIN_PROPS) {
      if (snap[prop] !== '0px') continue
      let auto = twins?.auto?.[prop]
      if (auto === undefined) {
        try {
          typed ||= el.computedStyleMap()
          auto = typed.get(prop)?.toString() === 'auto'
        } catch { auto = false /* Typed OM is optional; keep the computed style if unsupported. */ }
        if (twins) (twins.auto ||= {})[prop] = auto
      }
      if (auto) {
        snap[prop] = 'auto'
        restoredAutoMargin = true
      }
    }
  }
  stripHeightForWrappers(el, style, snap)
  // Before the twin signature below: it keys this node's final values.
  const clipped = freezeBorderBox(el, style, snap)
  // Here and not in inlineAllStyles: a snapshot served from the cache already carries its
  // gutter, and adding it per capture grew the box by one scrollbar every time.
  const gutter = addScrollbarGutter(el, style, snap)
  if (dyn !== null) {
    if (restoredAutoMargin) dyn.push('\u0005', ...MARGIN_PROPS.map(prop => snap[prop]))
    if (clipped) dyn.push('\u0006' + clipped)
    if (gutter) dyn.push('\u0007' + snap.width, snap.height)
    // Seed the signature memo AFTER the strip: it deletes at most height/block-size, and two
    // twins with different strip outcomes must not collide onto one key.
    const tail = dyn.join('\u0001') + ('height' in snap ? '' : '\u0003') + ('block-size' in snap ? '' : '\u0004')
    __snapshotSig.set(snap, shared.sig + '\u0002' + tail)
    // The signature is shared.sig + tail, so within one share record the tail alone keys the
    // class (inlineAllStyles), without hashing the full signature per twin.
    shareInfo.tail = tail
    shareInfo.rec = shared
  }
  const hosts = shadowHostsOf(el)
  // Before the stamp below is read. A box that changed since the last read passes the miss on.
  // A query container, to everything under it, whose rules it selects. Any other box, to its
  // children (what a slot holds included, and its shadow content through its own stamp) when
  // what their percentages and auto margins resolve against moved: its inline size (the
  // width, or the height under a vertical writing mode), the tracks of a grid, or a block
  // size that was zero, against which every percentage read 0. The block size alone moves
  // nothing below that the node's own check does not read: re-reading every subtree under a
  // box that grew cost a recapture after one added line 61 to 139% (40 panels, 400 cards).
  const before = rec && rec.used
  if (before && (before.w !== used.w || before.h !== used.h || before.tracks !== used.tracks)) {
    const query = (before.w !== used.w || before.h !== used.h) && style.getPropertyValue('container-type')
    const [inline, block] = /^(?:vertical|sideways)/.test(snap['writing-mode']) ? ['h', 'w'] : ['w', 'h']
    if (query && query !== 'normal') stampSubtree(el)
    else if (before[inline] !== used[inline] || before.tracks !== used.tracks || before[block] === '0px') {
      stampNode(el)
      for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
        stampNode(child)
        if (child.localName === 'slot') for (const held of child.assignedElements({ flatten: true })) stampNode(held)
      }
    }
  }
  // Read under a scan the page has since moved past: never current (see scanOf).
  const v = (session?.scanEnv ?? env) !== env ? -1 : stampOf(el, hosts)
  snapshotCache.set(el, { v, checked: seq, hosts, snapshot: snap, embedFonts: ef, excludeStyleProps: ex, used })
  return snap
}

/** Turns whatever inlineAllStyles was given into `{ session, persist, options }`: a ready ctx
 *  as is, a session cache with one ctx memoized on it per options object, or nothing, which
 *  gets throwaway maps so a direct caller never touches the global session. */
function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    // Amortize to one ctx allocation per capture: deepClone calls this per node with the
    // same sessionCache + options references.
    let ctx = sessionOrCtx.stylesCtx
    if (!ctx || sessionOrCtx.stylesCtxOpts !== opts) {
      ctx = {
        session: sessionOrCtx,
        persist: {
          snapshotKeyCache,
          defaultStyle: cache.defaultStyle,
          baseStyle: cache.baseStyle,
          image: cache.image,
          resource: cache.resource,
          background: cache.background,
        },
        options: opts || {},
      }
      sessionOrCtx.stylesCtx = ctx
      sessionOrCtx.stylesCtxOpts = opts
    }
    return ctx
  }

  return {
    // Direct callers without a session get isolated throwaway maps — never the global.
    session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() },
    persist: {
      snapshotKeyCache,
      defaultStyle: cache.defaultStyle,
      baseStyle: cache.baseStyle,
      image: cache.image,
      resource: cache.resource,
      background: cache.background,
    },
    options: (sessionOrCtx || opts || {}),
  }
}

/** An inline value that resolves against something the foreignObject does not reproduce:
 *  a percentage, a font- or viewport-relative unit, calc()/var(), a keyword like auto. */
const CONTEXT_DEPENDENT_VALUE_RE =
  /%|[\d.](?:em|rem|ex|ch|cap|ic|lh|rlh|v[whib]|vmin|vmax|cq[whbi]|cqmin|cqmax)\b|\b(?:calc|var|min|max|clamp|env|attr)\(|\b(?:auto|inherit|initial|unset|revert|currentcolor|-webkit-fill-available|fit-content|min-content|max-content)\b/i

const isTextField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
/**
 * Re-resolves the source's inline declarations through the cascade onto the clone.
 *
 * Four cases need it. Everything else is an absolute value copied onto itself, which the
 * clone's style attribute already holds.
 *  - A stylesheet `!important` must still beat an inline declaration inside the clone (#328).
 *  - An animation or a transition outranks the inline declaration of what it animates: a
 *    transition started through `el.style` has the END value inline while the frame is
 *    halfway, and the capture showed that end value. Only the animated properties are
 *    re-resolved (animatedProps). Pinned by __tests__/core.capture.animationFrames.test.js.
 *  - `background` on text fields only: the selection highlight composes its layers on top
 *    of the longhands this writes on an input's clone. On every other node the shorthand is
 *    the same value, and re-resolving it cost the 500-row table 13.5k reads plus 13.5k
 *    writes for nothing.
 *  - Context-dependent values (`width:100%`, `1.2em`, `calc()`, `auto`) resolve against a
 *    containing block the foreignObject does not have.
 * The context test is one regex over the whole style attribute, on purpose: per longhand it
 * got 67.6 ms down to 63 where the single regex gets 49.7. A null important set (unreliable
 * scan) re-resolves everything. Pinned by __tests__/module.styles.inlineImportant.test.js.
 * @param {Element} source
 * @param {Element} clone
 * @param {CSSStyleDeclaration} computed - getComputedStyle(source)
 * @param {string} attr - the source's style attribute, read once by the caller
 * @param {Set<string>} [animated] - the longhands an animation or transition holds on the source
 */
function normalizeInlineStyleToComputed(source, clone, computed, attr, animated) {
  const inline = source.style
  if (!inline || inline.length === 0) return
  const important = importantPropsFor(source)
  const canSkip = important != null && !CONTEXT_DEPENDENT_VALUE_RE.test(attr)
  // With no `!important` rule in the document only a border width can still differ, and the
  // loop skips every other prop. `all` expands to the border longhands too.
  const bordersOnly = canSkip && important.size === 0 && !animated && !isTextField(source)
  if (bordersOnly && !/border|\ball\s*:/i.test(attr)) return
  let sameBorderWidths
  for (let i = 0, n = inline.length; i < n; i++) {
    const prop = inline[i]
    // Even px borders are context-dependent: the live device grid snaps a positive
    // width to whole pixels. Keeping an authored 0.05px inline value overrides the
    // snapshot's used width and re-snaps it on the SVG grid (#520).
    const borderWidth = prop.startsWith('border-') && prop.endsWith('-width')
    if (canSkip && borderWidth && sameBorderWidths === undefined) {
      const authored = inline.borderWidth
      const previous = snapshotCache.get(source)
      sameBorderWidths = (previous && snapshotIsCurrent(previous, source) &&
        BORDER_WIDTHS.every(p => previous.snapshot[p] === authored)) || computed.borderWidth === authored
      if (sameBorderWidths && bordersOnly) return
    }
    if (canSkip && !important.has(prop) && !animated?.has(prop) && (!borderWidth || sameBorderWidths) && !(prop.startsWith('background') && isTextField(source))) continue
    const val = computed.getPropertyValue(prop)
    // A retained <style> can still contain an important ID selector. The live inline
    // !important wins it; dropping that priority here reverses the cascade in the clone.
    if (val && (!borderWidth || val !== inline.getPropertyValue(prop))) clone.style.setProperty(prop, val, inline.getPropertyPriority(prop))
  }
}

/**
 * Snapshots the source's computed style and records the clone's style-class key on the
 * session's styleMap. deepClone calls it for every element in the capture.
 *
 * Per node: wire invalidation for the node's own document, re-resolve the inline style where
 * the cascade can differ (normalizeInlineStyleToComputed), pin `animation` off so a static
 * frame does not replay from its 0% keyframe, take or share the snapshot, floor a flex item's
 * min-width at 0 (#406), then key it. Soften-eligible boxes (softensWidth) fold tag, content
 * and flex-item state into the key and tally reconcileRisk for capture.js's warning.
 * `<style>` is skipped. NO_DEFAULTS_TAGS (SVG shapes) get an empty key and only the
 * background-inline flag. Pinned by __tests__/module.styles.test.js.
 * @param {Element} source
 * @param {Element} clone
 * @param {object} [sessionOrCtx] - the session cache (styleMap / styleCache / nodeMap), a
 *   ready ctx, or nothing for an isolated one-off call
 * @param {object} [opts] - capture options: cache, embedFonts, excludeStyleProps
 */
export function inlineAllStyles(source, clone, sessionOrCtx, opts) {
  if (source.tagName === 'STYLE') return

  const ctx = _resolveCtx(sessionOrCtx, opts)
  // Normalized upstream to 'soft' | 'disabled'; 'soft' is the only non-disabled value.
  const resetMode = (ctx.options && ctx.options.cache) || 'soft'

  // The node's OWN document. Capturing inside a same-origin iframe wired the parent's
  // observers and watched a document the captured element does not live in.
  if (resetMode !== 'disabled') setupInvalidationOnce(source.ownerDocument)

  if (resetMode === 'disabled' && !ctx.session.bumpedForDisabled) {
    bumpEpoch()
    snapshotKeyCache.clear()
    ctx.session.bumpedForDisabled = true
  }

  const { session, persist } = ctx

  if (!session.styleCache.has(source)) {
    // ROB-1: getComputedStyle() on detached nodes can return an empty or unstable
    // CSSStyleDeclaration in some environments. Wrap defensively so a stale/detached
    // element never throws and callers always receive a usable style object.
    let computed = null
    try { computed = getComputedStyle(source) } catch { /* detached / cross-origin */ }
    session.styleCache.set(source, computed || getComputedStyle((source.ownerDocument || document).documentElement))
  }
  const pre = session.styleCache.get(source)

  // Replace authored inline style with computed values so !important in stylesheets
  // correctly overrides inline styles in the clone (fixes #328)
  const styleAttr = source.getAttribute?.('style')
  if (styleAttr) normalizeInlineStyleToComputed(source, clone, pre, styleAttr, session.animated?.get(source))

  // A static snapshot must not animate. The generated style class already filters animation
  // props (shouldIgnoreProp), but `animation` can still reach the SVG through the normalized
  // inline style above or through `<style>` tags cloned inside the captured subtree; when the
  // SVG is rasterized the animation replays from its 0% keyframe. An entry animation whose
  // start frame hides the element (e.g. `from { opacity: 0 }`, or an off-screen `transform`)
  // therefore blanks it out even though the live element already finished animating. Pin
  // `animation` off with inline `!important` on the elements that actually have one; the
  // current opacity/transform captured in the snapshot below then renders as the frozen,
  // already-settled frame. Asked of the live style on every capture and never kept with the
  // cached snapshot: a state set by script (`input.value`) can name an animation with no
  // record at all. Pinned by __tests__/core.capture.animation.test.js.
  const animName = pre.getPropertyValue('animation-name')
  if (clone && clone.style && animName && animName !== 'none') {
    clone.style.setProperty('animation', 'none', 'important')
  }

  const tag = source.tagName?.toLowerCase() || 'div'
  // NO_DEFAULTS_TAGS (SVG shapes/containers, head stuff) never get a style class —
  // getStyleKey returns '' and the empty key is dropped at emit. Skip the full universe
  // snapshot + signature they'd pay for nothing; their paint survives via clone.js's
  // SVG_PAINT_PROPS pass. Only the bg/mask flag probe runs (CSS masks DO apply to SVG
  // graphics elements) so needsBackgroundInline stays accurate.
  if (NO_DEFAULTS_TAGS.has(tag)) {
    const stub = {}
    Object.defineProperty(stub, '__needsBgInline', { value: computeNeedsBgInline(pre), enumerable: false })
    const hosts = shadowHostsOf(source)
    snapshotCache.set(source, {
      v: stampOf(source, hosts), hosts, snapshot: stub,
      embedFonts: !!(ctx.options && ctx.options.embedFonts),
      excludeStyleProps: (ctx.options && ctx.options.excludeStyleProps) || null,
    })
    session.styleMap.set(clone, '')
    return
  }

  let shareInfo = null
  if (session.styleShare && session.styleMap) {
    const st = shareStateOf(session)
    const id = identityFor(source, st)
    const doc = source.ownerDocument || document
    const active = doc.activeElement
    // A shadow host and a slotted node are styled by a root sheet the scan never read:
    // `:host(:not(:first-child))` split three identical #488 groups and the twins painted
    // the first one's zero margin (the same rule inside ::slotted() splits slotted twins).
    const eligible = id !== -1 &&
      !SHARE_SKIP_TAGS.has(source.tagName) &&
      !(active && active !== doc.body && active !== doc.documentElement && active === source) &&
      (!source.getRootNode || source.getRootNode() === doc) &&
      !source.shadowRoot && !source.assignedSlot
    if (eligible) shareInfo = { st, id }
  }
  const flexItem = isFlexOrGridItem(source)
  const snap = getSnapshot(source, pre, ctx.options, shareInfo, session, flexItem)
  // Inline author declarations were normalized above from getComputedStyle too.
  // Override their zero margin (including logical shorthands) with the retained auto.
  if (styleAttr) {
    for (let i = 0; i < 4; i++) { // the four physical sides
      const prop = MARGIN_PROPS[i]
      if (snap[prop] === 'auto') clone.style.setProperty(prop, 'auto', 'important')
    }
  }

  // Firefox background-clip:text fallback (see applyBgClipTextFallback): the class carries the
  // substitute colour, but resolveCSSVars and the authored inline-style normalization re-inline
  // the live transparent colour and the gradient over any class. Inline !important outranks
  // them all.
  if (snap.__bgClipTextFix && clone && clone.style) {
    clone.style.setProperty('background-image', 'none', 'important')
    clone.style.setProperty('background-color', 'transparent', 'important')
    clone.style.setProperty('color', snap.__bgClipTextFix, 'important')
    clone.style.setProperty('-webkit-text-fill-color', snap.__bgClipTextFix, 'important')
    // prepareClone repaints the real gradient once the clone is complete (bgClipText.js).
    ;(session.bgClipText ||= []).push([source, clone])
  }

  // Asked once per capture, on its ctx: per node the check cost the 1,506-node table 0.3 ms.
  ctx.safari ??= isSafari()
  if (ctx.safari) strokedTextShadowToFilter(source, clone, pre)

  if (clone.style?.length && snap['box-sizing'] === 'border-box' &&
      pre.getPropertyValue('box-sizing') !== 'border-box') syncInlineBorderBox(source, clone, snap)

  freezeOneLine(source, clone, snap, flexItem, session)

  // #406: foreignObject may resolve min-width:auto differently than normal DOM
  // for flex/grid items. Explicitly set min-width:0 on flex/grid items that have
  // the default auto value, so the generated CSS class includes it and we don't
  // need a blanket foreignObject *{min-width:0} rule (which breaks inline-flex+gap).
  // The floor goes into the key, never into `snap`: the snapshot outlives this capture and is
  // shared with its twins, and whether a row overflows belongs to neither. Written into the
  // snapshot, an item kept the floor of the first twin read, or of the capture before its row
  // overflowed. Pinned by __tests__/module.styles.flexFloor.test.js.
  let floor = ''
  if (flexItem) {
    const mw = pre.getPropertyValue('min-width')
    if (!mw || mw === 'auto' || mw === '0px') {
      floor = '0px'
      const ox = pre.getPropertyValue('overflow-x')
      const parent = source.parentElement
      if (mw === 'auto' && (ox === 'visible' || ox === 'clip') && parent &&
          getStyle(parent).display.includes('flex')) {
        const floors = session.flexOverflow || (session.flexOverflow = new WeakMap())
        let overflow = floors.get(parent)
        if (overflow === undefined) {
          overflow = parent.scrollWidth > parent.clientWidth
          if (!overflow) {
            // scrollWidth/clientWidth are integers. Sum used, untransformed boxes once
            // per container to retain fractional overflow too, without per-item reflows.
            const ps = getStyle(parent)
            const px = p => parseFloat(ps.getPropertyValue(p)) || 0
            const available = px('width') - (ps.boxSizing === 'border-box'
              ? px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width') : 0)
            const horizontal = ps.flexDirection.startsWith('row') === (ps.writingMode === 'horizontal-tb')
            const row = horizontal && ps.flexWrap === 'nowrap'
            let used = 0, count = 0
            for (const child of parent.children) {
              if (!session.styleCache.has(child)) session.styleCache.set(child, getComputedStyle(child))
              const cs = session.styleCache.get(child)
              if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue
              const n = p => parseFloat(cs.getPropertyValue(p)) || 0
              const width = n('width') + n('margin-left') + n('margin-right') + (cs.boxSizing === 'border-box'
                ? 0 : n('padding-left') + n('padding-right') + n('border-left-width') + n('border-right-width'))
              used = row ? used + width : Math.max(used, width)
              count++
            }
            // Used flex tracks can round up by one layout unit each (1/60px in
            // Gecko, 1/64px in Blink/WebKit). That alone is not content overflow.
            overflow = used + (row ? Math.max(0, count - 1) * px('column-gap') : 0) > available + count / 60
          }
          floors.set(parent, overflow)
        }
        if (overflow) floor = snap.width
      }
      if (snap['min-width'] === floor) floor = ''
    }
  }

  // getStyleKey only softens width for inline-sized / table / inline boxes, and only there does
  // its output depend on content/flex-item-ness. For every other node (the vast majority — divs,
  // headings, paragraphs…) skip that bookkeeping entirely so the hot path stays untouched.
  let sig = styleSignature(snap, tag)
  let sizedByContent = true
  let flags = floor && '|m' + floor
  if (softensWidth(tag, (snap.display || '').toLowerCase())) {
    sizedByContent = hasRenderedContent(source)
    // #484: softening only reproduces the box when its `width` is auto. On a blockified box in
    // normal flow (`span{display:block;width:16px}`) the min-width floor cannot cap the stretch,
    // and a flex/grid item gets no floor at all (#406) — both lost the authored width. Treat an
    // author-specified width as "not sized by content" so it is kept verbatim.
    if (sizedByContent && softenNeedsAutoWidth(tag, snap, flexItem) &&
        hasSpecifiedWidth(source, pre, flexItem)) {
      sizedByContent = false
    }
    // Fold content/flex into the cache key so soften-eligible elements with identical styles
    // but different shape don't collide on the shared snapshotKeyCache.
    flags += (sizedByContent ? '|c' : '') + (flexItem ? '|f' : '')
    // This is the exact condition getStyleKey uses to actually drop the width (the #429/#433/
    // #434 family): tally it so capture.js can suggest `reconcile: true` when it's never used —
    // cheap, since softensWidth/sizedByContent are already computed for this node regardless.
    // Nowrap/pre boxes stay frozen (#474), so they carry no re-wrap risk.
    const wsMode = snap['text-wrap-mode'] || snap['white-space'] || ''
    if (sizedByContent && wsMode !== 'nowrap' && wsMode !== 'pre') {
      session.reconcileRisk = (session.reconcileRisk || 0) + 1
    }
  }
  sig += flags
  // A twin first asks its share record by tail (see getSnapshot): a few dozen short keys per
  // identity in place of one lookup by the full signature per node.
  const memo = shareInfo && shareInfo.tail !== undefined ? (shareInfo.rec.keys ||= new Map()) : null
  const mk = memo && shareInfo.tail + flags
  let key = memo ? memo.get(mk) : undefined
  if (key === undefined) {
    key = persist.snapshotKeyCache.get(sig)
    if (key === undefined) {
      key = getStyleKey(floor ? { ...snap, 'min-width': floor } : snap, tag, sizedByContent, flexItem)
      // Bound at INSERTION: evicting only on an epoch bump left the Map unbounded for as long
      // as the page's styles held still. Map iterates in insertion order, so this is FIFO.
      if (persist.snapshotKeyCache.size >= MAX_SNAPSHOT_KEY_CACHE) {
        persist.snapshotKeyCache.delete(persist.snapshotKeyCache.keys().next().value)
      }
      persist.snapshotKeyCache.set(sig, key)
    }
    if (memo) memo.set(mk, key)
  }
  session.styleMap.set(clone, key)
}
