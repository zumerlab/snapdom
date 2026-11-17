/**
 * Style snapshots: one object of computed values per node, and the caches that keep them
 * across captures.
 *
 * `inlineAllStyles` is the entry: per node it snapshots the computed style (only the props the
 * page's CSS can touch, see styleScan.js), keys it, and stores the key on the session's
 * styleMap for the class CSS the engine emits. The snapshot is the dominant cost of a capture,
 * so most of this file avoids taking it: a cross-capture cache guarded by one version per
 * record and a probe of the used values it froze (`getSnapshot`).
 *
 * Neighbours: core/changes.js observes what makes a snapshot stale, authorStyles.js names the
 * props the page's CSS can touch, styleShare.js lets structural twins copy one read, and
 * styleFreeze.js keeps the clone's layout (gutter, border box, one-line pin, wrapper heights).
 * @module styles
 */

import { getStyleKey, softensWidth, softenNeedsAutoWidth, shouldIgnoreProp, getStyle, NO_DEFAULTS_TAGS } from '../utils/index.js'
import { isFirefox, isSafari } from '../utils/browser.js'
import {
  seq, env, bumpEpoch, bumpSeq, stampNode, stampSubtree, stampOf, shadowHostsOf, setupInvalidationOnce,
} from '../core/changes.js'
import { universeFor, importantPropsFor } from './authorStyles.js'
import { SHARE_SKIP_TAGS, shareStateOf, identityFor, shareLists } from './styleShare.js'
import {
  addScrollbarGutter, freezeBorderBox, syncInlineBorderBox, freezeOneLine, stripHeightForWrappers,
  isFlexOrGridItem, BORDER_WIDTHS,
} from './styleFreeze.js'

/** Per element: { v, checked, hosts, snapshot, embedFonts, excludeStyleProps, used }.
 *  Cross-capture; a hit needs `v` unchanged (snapshotIsCurrent) and the used values to hold. */
const snapshotCache = new WeakMap()
const MARGIN_PROPS = [
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end',
]

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
 * List the longhands each animation target has animated. inlineAllStyles re-resolves only
 * those: re-resolving every inline declaration wrote a flex item's used `width` over its
 * authored one and the clone shrank it twice. A script-made effect keeps its shorthand, which
 * a detached declaration expands.
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
 * True when unknown (no fresh snapshot: STYLE tags, SVG template descendants), so the node
 * is processed.
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
 * pass reads it instead of the CSSOM: a prop ABSENT from it was pruned by the universe and
 * holds its default. Null under the Firefox background-clip:text fallback, whose background
 * props were swapped (applyBgClipTextFallback) while that pass must see the live ones.
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
 * when null) plus its own inline props.
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
    // Pruned read: only props the page's CSS or the inline style can move off their UA
    // defaults; anything else diffs empty downstream anyway.
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
  // Keep visibility as visibility: a child may restore `visibility: visible`, which opacity:0
  // on the hidden ancestor would make impossible to recover.
  // content-visibility:hidden skips the CONTENTS but paints the element's own box (real
  // Chromium). Carry the declaration itself: as visibility:hidden it would erase the box too,
  // and a descendant could override it back. Read by name: it is not always enumerated.
  try {
    const cv = out['content-visibility'] || style.getPropertyValue('content-visibility')
    if (cv === 'hidden') out['content-visibility'] = 'hidden'
  } catch { /* ignore */ }

  // Read from the live declaration, not `out`, so excludeStyleProps or the url() rewrite cannot
  // hide it. Non-enumerable, so key iteration never sees it.
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
 * Firefox drops background-clip:text inside an SVG foreignObject image, so gradient text with
 * a transparent colour captures as nothing (0 painted pixels against Chromium's 1198 for the
 * same span). The average of the gradient's stops stands in as a plain text colour, only when
 * the text would otherwise be invisible.
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
  // resolveCSSVars and the inline-style normalization re-inline the live colour and gradient
  // over the class, so inlineAllStyles also writes the fallback inline with !important from
  // this marker. Non-enumerable: key iteration must not see it.
  Object.defineProperty(out, '__bgClipTextFix', { value: solid, enumerable: false })
  /* c8 ignore stop */
}

/**
 * WebKit paints no text-shadow under `-webkit-text-stroke` in an SVG foreignObject image (real
 * Safari 27.0.1 and Playwright WebKit: 802 shadow pixels without the stroke, 0 with it) but
 * still paints `filter: drop-shadow()`. Swapped only on a leaf whose only ink is its text, with
 * one shadow (chained drop-shadows shadow each other). WebKit reads a drop-shadow blur as a
 * deviation, twice a text-shadow's, hence the halving.
 * #531, pinned by __tests__/module.styles.strokedTextShadow.test.js.
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
 * A single colour standing in for a clipped-to-text background: the average of its visible
 * colours. Firefox serializes oklch(), lab(), color-mix() and display-p3 stops as colour
 * functions; unresolved, the text captured with 0 painted pixels.
 * Pinned by __tests__/module.styles.bgClipText.test.js.
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
    // #454: an out-of-flow child does not size its parent: KaTeX's .hide-tail span
    // (width:100%, abspos svg inside) is sized by CSS, so its width must not be softened.
    if (n.nodeType === 1) {
      const pos = getStyle(n).position
      if (pos !== 'absolute' && pos !== 'fixed') return true
    }
  }
  return false
}
/**
 * Whether the element's width is author-specified (a length or percentage) rather than derived
 * from its content or the layout around it. `getComputedStyle().width` cannot tell: it returns
 * the USED width, so `auto` and `width: 16px` both read `16px`. Typed OM keeps `auto` (Chromium
 * and WebKit); Firefox has none, so there the two layout probes below infer it.
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
  // A box that hugs its content (`max-content` and `fit-content` too) keeps softening. A block
  // box must also differ from the available width, which plain `width: auto` gives.
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

/** Per snapshot: the style key it last produced and its flags, so a cache hit skips
 *  getStyleKey. No memo across snapshots: a signature of every value cost more than the key it
 *  saved (9.1% of a capture of 240 unique cards against 0.6%). */
const snapshotKey = new WeakMap()

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
 * Whether the size the element's last snapshot froze still reads the same, as computed
 * values. For the differential reconcile (diff.js), on a box whose key holds no width: the
 * size sits in its inline style then, which no key comparison sees.
 * @param {Element} el
 * @param {CSSStyleDeclaration} style - its live computed style
 * @returns {boolean}
 */
export function sizeHolds(el, style) {
  const used = snapshotCache.get(el)?.used
  return !used || used.box === false || (style.getPropertyValue('width') === used.w && style.getPropertyValue('height') === used.h)
}

/**
 * Whether the margins the element's last snapshot froze still read the same. For the
 * differential reconcile (diff.js): a key compares what it holds, and a margin of 0px is not
 * in it. True when no margin was noted (usedValuesOf).
 * @param {Element} el
 * @param {CSSStyleDeclaration} style - its live computed style
 * @returns {boolean}
 */
export function marginsHold(el, style) {
  const margin = snapshotCache.get(el)?.used?.margin
  return !margin || sidesHold(style, margin, 'margin', MARGIN_PROPS)
}

/**
 * Note what a fresh snapshot froze that layout can move while the cascade stands still: its
 * box, a positioned box's offsets, the margins a flex line, grid area or absolute box hands
 * out, a grid's tracks. All-zero offsets on a relative box and all-zero margins are left out,
 * except margins in Firefox, where Typed OM cannot restore an `auto`. Read before any pass
 * rewrites the snapshot.
 * @param {Record<string, string>} snap
 * @param {Element} el
 * @param {boolean} flexItem - its parent is a flex or grid container
 * @returns {{w: string|undefined, h: string|undefined, box: number[]|null|false, inset: string|null, margin: string|null, tracks: string|null}}
 *   `box` is false when no box was frozen, null until the first check reads the rectangle
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
  // Without Typed OM (Firefox) an `auto` margin is frozen as the px it resolved to, zero
  // included, on any box: a centred block whose container widened kept its old margins.
  const typed = typeof el.computedStyleMap === 'function'
  if (out || flexItem || !typed) {
    const margin = frozenSides(snap, MARGIN_PROPS)
    if (margin && (margin !== NO_SIDES || !typed)) used.margin = margin
  }
  if ((snap.display || '').includes('grid')) {
    const columns = snap['grid-template-columns'], rows = snap['grid-template-rows']
    if (columns !== undefined && rows !== undefined) used.tracks = columns + '/' + rows
  }
  return used
}

/**
 * Whether the used values a cached snapshot froze still read the same. The box goes through
 * getBoundingClientRect: on a 250-row table recapture after a nested edit it costs 5%, where
 * `width`/`height` cost 10%, and `offsetWidth`/`offsetHeight` 4% but miss sub-pixel changes
 * (Chromium).
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
 * The element's snapshot: cached while its stamp AND its used values hold, else a fresh read,
 * or on an identity hit the twin's read with only the used-value props re-read. Used values
 * are re-checked only once some stamp has moved, so an idle recapture pays one comparison a
 * node.
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
  // The snapshot depends on embedFonts and excludeStyleProps, which no invalidation tracks, so
  // a capture with other options must not reuse it (#348). A function policy can change its
  // closure unseen, so it always takes a fresh snapshot.
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
    // Inherit the shared read, riders included (non-geometry, the same for every twin):
    // copying ~150 keys was 5 of the 34 ms of a first 250-row table capture. An empty re-read
    // is stored as undefined to hide the shared value, so nothing may `delete` from a snapshot.
    const rrList = shared.rr || shareLists(shared, el, shareInfo.st)
    snap = Object.create(shared.snap)
    dyn = []
    for (let i = 0; i < rrList.length; i++) {
      const v = style.getPropertyValue(rrList[i])
      snap[rrList[i]] = v || undefined
      dyn.push(v)
    }
  } else {
    snap = snapshotComputedStyleFull(style, options, el, universeFor(el, session))
    if (shareInfo) {
      // By REFERENCE, copied by shareLists on the first twin: a copy per identity cost 27 ms
      // of a 134 ms pipeline on the deep tree, whose 1,936 leaves are all unique.
      shareInfo.st.snaps.set(shareInfo.id, { snap, rr: null })
    }
  }
  const used = usedValuesOf(snap, el, flexItem)
  // Chromium can report a zero used margin after a partial container layout though the box
  // stays centred; Typed OM keeps the `auto` keyword, and carrying it reproduces the alignment.
  // Nonzero margins and excluded props are left alone. The keyword is computed, the same for
  // every twin, so the share record keeps each answer: one Typed OM ask per identity and side.
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
  // Before the twin tail below: it keys this node's final values.
  const clipped = freezeBorderBox(el, style, snap)
  // Here and not in inlineAllStyles: a snapshot served from the cache already carries its
  // gutter, and adding it per capture grew the box by one scrollbar every time.
  const gutter = addScrollbarGutter(el, style, snap)
  if (dyn !== null) {
    if (restoredAutoMargin) dyn.push('\u0005', ...MARGIN_PROPS.map(prop => snap[prop]))
    if (clipped) dyn.push('\u0006' + clipped)
    if (gutter) dyn.push('\u0007' + snap.width, snap.height)
    // AFTER the strip: it blanks at most height/block-size, and two twins with different
    // strip outcomes must not collide onto one key. Everything else a twin holds is the
    // identity's, so within one share record the tail alone keys the class (inlineAllStyles).
    shareInfo.tail = dyn.join('\u0001') + (snap.height === undefined ? '\u0003' : '') + (snap['block-size'] === undefined ? '\u0004' : '')
    shareInfo.rec = shared
  }
  const hosts = shadowHostsOf(el)
  // A changed box passes the miss on, before the stamp below is read: a query container to its
  // subtree, any other box to its children when what their % and auto margins resolve against
  // moved. Not on every block-size change: re-reading each subtree under a box that grew cost a
  // recapture after one added line 61 to 139% (40 panels, 400 cards).
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

/**
 * Whether the items of a flex container overflow it along its inline axis, once per pass.
 * Decides the min-width floor of its items (inlineAllStyles): an item of an overflowing row
 * keeps its used width, any other can shrink (#406). The differential path asks again for the
 * rows a change touched (diff.js).
 * @param {Element} parent - a flex container
 * @param {import('../core/session.js').ClonePass} session
 * @returns {boolean}
 */
export function flexRowOverflows(parent, session) {
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
  return overflow
}

/** Turns whatever inlineAllStyles was given into `{ session, options }`: a ready ctx
 *  as is, a session cache with one ctx memoized on it per options object, or nothing, which
 *  gets throwaway maps so a direct caller never touches the global session. */
function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session) return sessionOrCtx
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    // Amortize to one ctx allocation per capture: deepClone calls this per node with the
    // same sessionCache + options references.
    let ctx = sessionOrCtx.stylesCtx
    if (!ctx || sessionOrCtx.stylesCtxOpts !== opts) {
      ctx = {
        session: sessionOrCtx,
        options: opts || {},
      }
      sessionOrCtx.stylesCtx = ctx
      sessionOrCtx.stylesCtxOpts = opts
    }
    return ctx
  }

  return {
    // Direct callers without a session get isolated throwaway maps, never the global.
    session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() },
    options: (sessionOrCtx || opts || {}),
  }
}

/** An inline value that resolves against something the foreignObject does not reproduce:
 *  a percentage, a font- or viewport-relative unit, calc()/var(), a keyword like auto. */
const CONTEXT_DEPENDENT_VALUE_RE =
  /%|[\d.](?:em|rem|ex|ch|cap|ic|lh|rlh|v[whib]|vmin|vmax|cq[whbi]|cqmin|cqmax)\b|\b(?:calc|var|min|max|clamp|env|attr)\(|\b(?:auto|inherit|initial|unset|revert|currentcolor|-webkit-fill-available|fit-content|min-content|max-content)\b/i

const isTextField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
let firefox
/**
 * Re-resolves the source's inline declarations onto the clone where the cascade can differ:
 * a stylesheet `!important` (#328), an animated property, `background` on a text field, and a
 * value relative to a containing block the foreignObject does not have (`width:100%`, `auto`).
 * Pinned by __tests__/module.styles.inlineImportant.test.js.
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
  // One regex over the whole attribute on purpose: per longhand it got 67.6 ms down to 63
  // where this gets 49.7. A null important set (unreliable scan) re-resolves everything.
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
    // An animation outranks the inline value: one started through `el.style` holds the END
    // value inline mid-frame. Pinned by __tests__/core.capture.animationFrames.test.js.
    // `background` only on text fields, where the selection highlight composes over it:
    // elsewhere it cost the 500-row table 13.5k reads plus 13.5k writes.
    if (canSkip && !important.has(prop) && !animated?.has(prop) && (!borderWidth || sameBorderWidths) && !(prop.startsWith('background') && isTextField(source))) continue
    const val = computed.getPropertyValue(prop)
    // A retained <style> can still contain an important ID selector. The live inline
    // !important wins it; dropping that priority here reverses the cascade in the clone.
    if (val && (!borderWidth || val !== inline.getPropertyValue(prop))) clone.style.setProperty(prop, val, inline.getPropertyPriority(prop))
  }
}

/**
 * Snapshots the source's computed style and records the clone's style-class key on the
 * session's styleMap; deepClone calls it per element. Pinned by __tests__/module.styles.test.js.
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
    ctx.session.bumpedForDisabled = true
  }

  const { session } = ctx

  if (!session.styleCache.has(source)) {
    // ROB-1: getComputedStyle() on detached nodes can return an empty or unstable
    // CSSStyleDeclaration in some environments. Wrap defensively so a stale/detached
    // element never throws and callers always receive a usable style object.
    let computed = null
    try { computed = getComputedStyle(source) } catch { /* detached / cross-origin */ }
    session.styleCache.set(source, computed || getComputedStyle((source.ownerDocument || document).documentElement))
  }
  const pre = session.styleCache.get(source)
  // Firefox (141): once the grid-template-columns of one grid container has been read, the
  // `auto` margins of every other grid container read 0px until its own tracks are read. So
  // a grid's tracks are read first, before the inline declarations and the snapshot: a
  // right-aligned grid was captured at the left.
  // Pinned by __tests__/module.styles.inlineAutoMargin.test.js.
  if ((firefox ??= isFirefox()) && pre.display?.includes('grid')) pre.getPropertyValue('grid-template-columns')

  // Replace authored inline style with computed values so !important in stylesheets
  // correctly overrides inline styles in the clone (fixes #328)
  const styleAttr = source.getAttribute?.('style')
  if (styleAttr) normalizeInlineStyleToComputed(source, clone, pre, styleAttr, session.animated?.get(source))

  // A static snapshot must not animate: `animation` can still reach the SVG through the inline
  // style or a cloned `<style>`, and the rasterized SVG replays it from 0%, so an entry
  // animation from `opacity: 0` blanks an element that finished animating live. Asked of the
  // live style every capture, never cached: a state set by script (`input.value`) can name an
  // animation with no record at all.
  // Pinned by __tests__/core.capture.animation.test.js.
  const animName = pre.getPropertyValue('animation-name')
  if (clone && clone.style && animName && animName !== 'none') {
    clone.style.setProperty('animation', 'none', 'important')
  }

  const tag = source.tagName?.toLowerCase() || 'div'
  // NO_DEFAULTS_TAGS (SVG shapes, head tags) never get a style class, so they skip the full
  // snapshot; clone.js's SVG_PAINT_PROPS keeps their paint. Only the bg/mask flag is probed
  // (CSS masks DO apply to SVG graphics) so needsBackgroundInline stays accurate.
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
    // Never shared: the focused element (UA :focus-visible ring), and a shadow host or slotted
    // node, styled by a root sheet the scan never read: `:host(:not(:first-child))` split three
    // identical #488 groups and the twins painted the first one's zero margin.
    const eligible = id !== -1 &&
      !SHARE_SKIP_TAGS.has(source.tagName) &&
      !(active && active !== doc.body && active !== doc.documentElement && active === source) &&
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

  // Firefox background-clip:text fallback: resolveCSSVars and the inline-style normalization
  // re-inline the live colour and gradient over the class, and only inline !important wins.
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

  // #406: foreignObject may resolve min-width:auto differently for flex/grid items, and a
  // blanket *{min-width:0} breaks inline-flex+gap. The floor goes into the key, never `snap`,
  // which outlives the capture and is shared with twins: there an item kept the floor of the
  // first twin read, or of the capture before its row overflowed.
  // Pinned by __tests__/module.styles.flexFloor.test.js.
  let floor = ''
  if (flexItem) {
    const mw = pre.getPropertyValue('min-width')
    if (!mw || mw === 'auto' || mw === '0px') {
      floor = '0px'
      const ox = pre.getPropertyValue('overflow-x')
      const parent = source.parentElement
      if (mw === 'auto' && (ox === 'visible' || ox === 'clip') && parent &&
          getStyle(parent).display.includes('flex')) {
        const overflow = flexRowOverflows(parent, session)
        if (overflow) floor = snap.width
      }
      if (snap['min-width'] === floor) floor = ''
    }
  }

  // Only soften-eligible boxes (inline-sized, table, inline) key on content and flex-item
  // state; every other node skips that bookkeeping, so the hot path stays untouched.
  let sizedByContent = true
  let flags = floor && '|m' + floor
  if (softensWidth(tag, (snap.display || '').toLowerCase())) {
    sizedByContent = hasRenderedContent(source)
    // #484: softening reproduces the box only when its `width` is auto: a blockified
    // `span{display:block;width:16px}` and a flex/grid item (no floor, #406) lost the authored
    // width. An author-specified width counts as not sized by content.
    if (sizedByContent && softenNeedsAutoWidth(tag, snap, flexItem) &&
        hasSpecifiedWidth(source, pre, flexItem)) {
      sizedByContent = false
    }
    // Content and flex-item state change what getStyleKey writes for a soften-eligible box.
    flags += (sizedByContent ? '|c' : '') + (flexItem ? '|f' : '')
    // The exact condition getStyleKey drops the width on (#429/#433/#434 family), tallied so
    // capture.js can suggest `reconcile: true`. Nowrap/pre boxes stay frozen (#474).
    const wsMode = snap['text-wrap-mode'] || snap['white-space'] || ''
    if (sizedByContent && wsMode !== 'nowrap' && wsMode !== 'pre') {
      session.reconcileRisk = (session.reconcileRisk || 0) + 1
    }
  }
  // A twin asks its share record by tail (see getSnapshot): a few dozen short keys per
  // identity. Any other node asks the snapshot itself, which answers when it was served again
  // from the cache under the same flags.
  const memo = shareInfo && shareInfo.tail !== undefined ? (shareInfo.rec.keys ||= new Map()) : null
  const mk = memo && shareInfo.tail + flags
  const kept = memo ? null : snapshotKey.get(snap)
  let key = memo ? memo.get(mk) : kept && kept.flags === flags ? kept.key : undefined
  if (key === undefined) {
    key = getStyleKey(snap, tag, sizedByContent, flexItem, floor, universeFor(source, session))
    if (memo) memo.set(mk, key)
    else snapshotKey.set(snap, { flags, key })
  }
  session.styleMap.set(clone, key)
}
