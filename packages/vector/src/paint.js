/**
 * The paint tree: DOM containment in, one pruned tree plus a back-to-front index out.
 *
 * This module owns the decision the rest of the export hangs from (D3): **the
 * hierarchy is containment, the paint order is an index**. Every node carries
 * `paint.z`, its rank among its emitted siblings per CSS 2.1 Appendix E, and the
 * backend sorts `children` by it. A strict linearisation of Appendix E would give
 * a flat reparented list, which is correct and useless — in Figma `children` is
 * simultaneously z-order and Auto Layout flow order, so a flat list destroys hug
 * sizing, padding, components and instances. Reparenting therefore happens only
 * where the divergence is real AND visible: see `buildPaintTree`.
 *
 * Three exports, three different jobs:
 *
 *  - `isStackingContext` and `paintOrder` are pure. They take plain objects, run
 *    in Node with no DOM, and are the two pieces the harness fuzzes.
 *  - `buildPaintTree` walks **snapdom's mounted clone**, not the live DOM (see the
 *    scope section of `packages/CONTRACT.md`). It produces structure and geometry
 *    only — it never calls a collector. Each node keeps its source element on a
 *    non-enumerable `el` (non-enumerable so the assembled document stays
 *    JSON-serialisable and `validate` never sees a DOM object in a node), and the
 *    orchestrator fills `fills`/`strokes`/`effects`/`text` from it.
 *
 * What walking the clone changes here, and nothing else does:
 *
 *  - **Pseudo-elements are real elements.** `::before`/`::after`/`::first-letter`
 *    arrive as `<span data-snapdom-pseudo="::before">` with a measurable box, so
 *    they enter through the ordinary walk. There is no synthesis path and no "out
 *    of scope" declaration left for them; what remains is the two kinds the clone
 *    canNOT materialise (`::marker`, `::first-line`), which the browser still
 *    renders natively and we still lose.
 *  - **Shadow DOM is flattened**, its CSS rewritten to prefixed classes, so nothing
 *    traverses `shadowRoot` any more. A host that still HAS one means the caller
 *    handed us a live tree, and that is an error, not a silent omission — except
 *    for the one root the adapter itself provokes and repairs: mounting the clone
 *    upgrades its custom elements, the browser attaches a shadow root, and the
 *    adapter empties it back to a bare `<slot>` and marks it. That one is
 *    `B4.upgraded-custom-element`, info, and it is declared rather than hidden.
 *  - **The clone carries nodes the page does not have**: exclusion spacers, clip
 *    husks and scroll wrappers. Each is identified below and each says so — a node
 *    that disappears because it was an artifact still gets its own diagnostic code.
 *  - **Paint lives in prefixed CLASSES, not inline styles.** Every predicate here
 *    reads computed style, which is only real once the clone is mounted, so
 *    `buildPaintTree` refuses to walk a detached root rather than pruning a whole
 *    document that "paints nothing".
 *
 * Geometry convention: `abs` is the border box **with the whole transform chain
 * from the capture root neutralised**, so a node's own `transform` composes with
 * its `frame` instead of double-counting. Where a transform is in play the box
 * cannot come from `getBoundingClientRect` — that returns the bbox of the
 * transformed quad — so it comes from the layout offset chain, which is
 * transform-free by definition and integer-rounded, and that rounding is a
 * diagnostic like every other approximation.
 */
import { parseTransform } from './css/matrix.js'
import { parseColor } from './css/color.js'
import { isExcluded } from './exclusion.js'

/** Never rendered, or rendered by something else that we walk instead. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'BASE',
  'SOURCE', 'TRACK', 'PARAM', 'MAP', 'AREA', 'BR', 'WBR', 'SLOT',
])

/** Replaced content that becomes an `image` node: one paint, no children of ours. */
const IMAGE_TAGS = new Set(['IMG', 'CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT'])

/** Rasterised downstream — vector has nothing to say about their contents. */
const RASTER_ONLY_TAGS = new Set(['CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT'])

/** UA-rendered widgets: a box we can read, plus internals we cannot. */
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'PROGRESS', 'METER'])

/** Subtrees whose paint needs a dedicated collector rather than the HTML walk. */
const OPAQUE_TAGS = new Set([
  'SVG', 'MATH', 'CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT',
  'INPUT', 'TEXTAREA', 'SELECT', 'PROGRESS', 'METER', 'IMG',
])
const MATH_NS = 'http://www.w3.org/1998/Math/MathML'

/** snapdom stamps every materialised pseudo-element with its own selector. */
const PSEUDO_ATTR = 'data-snapdom-pseudo'
/** The synthesized dim layer `prepareClone` appends for an open modal's `::backdrop`. */
const BACKDROP_ATTR = 'data-sd-backdrop'
/** Marks a clone whose flattened shadow tree was rewritten to this scope id. */
const SHADOW_SCOPE_ATTR = 'data-sd'
/**
 * Marks a custom element the browser upgraded when the adapter connected the
 * clone, and whose freshly attached shadow root the adapter emptied back down to
 * a bare `<slot>`. The root is still there — you cannot detach one — so without
 * this mark the check below would read our own repair as a live tree.
 * Set by `adapters/snapdom.js`.
 */
const DEFUSED_SHADOW_ATTR = 'data-snapdom-vector-defused'

/** `contain` values that contain paint or layout, and so make a stacking context. */
const CONTAIN_SC = /\b(layout|paint|strict|content)\b/
/** The subset that also clips. */
const CONTAIN_CLIP = /\b(paint|strict|content)\b/

/**
 * `will-change` values that create a stacking context, per css-will-change: the
 * properties that create one at any non-initial value. `z-index` is in Blink's
 * list too but only bites on a positioned element, which the `position` test
 * already caught.
 */
const WILL_CHANGE_SC = new Set([
  'opacity', 'transform', 'rotate', 'scale', 'translate', 'perspective',
  'transform-style', 'filter', 'backdrop-filter', 'clip-path', 'mask',
  'mask-image', 'mask-border', 'isolation', 'mix-blend-mode', 'contain',
  'offset-path', 'offset', 'view-transition-name',
])

/** Fidelity grades, worst-wins. Mirrors `FIDELITY` in @zumer/svd. */
const GRADE_RANK = { E: 0, A: 1, C: 2, R: 3, RH: 3, O: 4 }

const EPS = 0.01

// ——— pure helpers ———

/** A computed value that is present and not the "off" keyword. */
function isSet (v) {
  return typeof v === 'string' && v !== '' && v !== 'none'
}

function num (v, fallback = 0) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** `null` for `auto` — the distinction between auto and 0 decides the stacking context. */
function zIndexOf (cs) {
  const raw = cs.zIndex
  if (raw === undefined || raw === null || raw === '' || raw === 'auto') return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

function opacityOf (cs) {
  const n = parseFloat(cs.opacity)
  return Number.isFinite(n) ? n : 1
}

function floatOf (cs) {
  return cs.float || cs.cssFloat || 'none'
}

function willChangeCreatesSC (value) {
  if (!isSet(value)) return false
  return value.split(',').some(v => WILL_CHANGE_SC.has(v.trim().toLowerCase()))
}

/** The document root element, which is a stacking context by definition. */
function isRootElement (el) {
  const doc = el && el.ownerDocument
  return !!doc && doc.documentElement === el
}

/**
 * Only reached for `position: static` elements — everything positioned with a
 * z-index has already returned true — so a flex/grid *container* child here is
 * always a real flex/grid item.
 */
function isFlexOrGridItem (el, parentCs) {
  let cs = parentCs
  if (!cs) {
    const parent = el && el.parentElement
    if (!parent || typeof getComputedStyle !== 'function') return false
    cs = getComputedStyle(parent)
  }
  return /^(inline-)?(flex|grid)$/.test(cs.display || '')
}

/**
 * Does `el` create a stacking context?
 *
 * Pure: `cs` may be any object with the computed properties as strings, so this
 * runs in Node against a fake. `el` is only consulted for the two rules a style
 * object cannot answer — being the document root, and being a flex/grid item —
 * and both degrade to `false` when it is absent.
 *
 * @param {Element|null} el
 * @param {CSSStyleDeclaration|Record<string,string>} cs computed style for `el`
 * @param {CSSStyleDeclaration|Record<string,string>} [parentCs] computed style of
 *   the parent element; supplied by `buildPaintTree`, which already has it cached.
 *   Without it the flex/grid-item rule falls back to `getComputedStyle` and, with
 *   no DOM, is skipped.
 * @returns {boolean}
 */
export function isStackingContext (el, cs, parentCs) {
  if (!cs) return false
  if (isRootElement(el)) return true

  const position = cs.position || 'static'
  if (position === 'fixed' || position === 'sticky') return true

  const z = zIndexOf(cs)
  if (z !== null && position !== 'static') return true

  if (opacityOf(cs) < 1) return true
  if (isSet(cs.mixBlendMode) && cs.mixBlendMode !== 'normal') return true
  if (cs.isolation === 'isolate') return true

  if (isSet(cs.transform) || isSet(cs.rotate) || isSet(cs.scale) || isSet(cs.translate)) return true
  if (isSet(cs.perspective)) return true
  if (cs.transformStyle === 'preserve-3d' || cs.webkitTransformStyle === 'preserve-3d') return true
  if (isSet(cs.offsetPath)) return true

  if (isSet(cs.filter) || isSet(cs.webkitFilter)) return true
  if (isSet(cs.backdropFilter) || isSet(cs.webkitBackdropFilter)) return true
  if (isSet(cs.clipPath) || isSet(cs.webkitClipPath)) return true
  if (isSet(cs.maskImage) || isSet(cs.webkitMaskImage)) return true
  if (isSet(cs.maskBorderSource) || isSet(cs.webkitMaskBoxImage)) return true

  if (CONTAIN_SC.test(cs.contain || '')) return true
  if (cs.contentVisibility === 'auto' || cs.contentVisibility === 'hidden') return true
  if (isSet(cs.viewTransitionName)) return true
  if (willChangeCreatesSC(cs.willChange)) return true

  return z !== null && isFlexOrGridItem(el, parentCs)
}

/** Inline-level display values, including `contents`, which joins the parent's IFC. */
function isInlineLevel (display) {
  return /^(inline|ruby|contents)/.test(display || '')
}

/**
 * Does this display keep the element's text in its PARENT's inline formatting
 * context? Inline-level is not the same question: `inline-block`, `inline-flex`,
 * `inline-grid` and `inline-table` are ATOMIC inlines — they take part in the
 * parent's line box as one opaque item, and their own text is a context of their
 * own. Treating them as non-atomic made `collect/text.js` (which draws the line
 * in the right place) reject them while `paint.js` had already decided the parent
 * spoke for them, and the text of every `<span class="pill">` in a table cell
 * disappeared with nothing but a "no painted characters" note.
 */
function joinsParentText (display) {
  return /^(inline|ruby|contents)$/.test(display || '') || /^ruby-/.test(display || '')
}

/**
 * Read an ordering descriptor off whatever the caller passed: a bare object with
 * the CSS properties, or a record carrying a computed style under `cs`/`style`.
 */
function descriptorOf (sibling, index) {
  const src = sibling || {}
  const cs = src.cs || src.style || src
  const position = cs.position || 'static'
  const z = zIndexOf(cs)
  const sc = src.stackingContext !== undefined
    ? !!src.stackingContext
    : (src.paint && src.paint.stackingContext !== undefined
        ? !!src.paint.stackingContext
        : isStackingContext(src.el || null, cs))
  const positioned = position !== 'static'
  // A flex/grid item with a z-index is painted exactly as a positioned element
  // with that z-index would be, so it takes the positioned lanes too.
  const ordered = positioned || (z !== null && sc)

  let layer
  if (ordered && z !== null && z < 0) layer = 1
  else if (ordered) layer = z === null || z === 0 ? 5 : 6
  // css-color-3 §3.2 and css-transforms-1: an element that creates a stacking
  // context without being positioned paints where a `position:relative;
  // z-index:0` element would, NOT in its in-flow lane.
  else if (sc) layer = 5
  else if (floatOf(cs) !== 'none') layer = 3
  else if (isInlineLevel(cs.display)) layer = 4
  else layer = 2

  return { layer, z: z === null ? 0 : z, index }
}

/**
 * CSS 2.1 Appendix E, back to front, within one stacking context:
 * the context root's own background and borders (that is the parent node, not a
 * sibling, so it is not in this list), then negative stacking contexts ascending,
 * in-flow non-inline blocks, non-positioned floats, in-flow inline content,
 * z-index `0`/`auto` positioned boxes and non-positioned stacking contexts, then
 * positive z-index ascending. Ties keep document order.
 *
 * The result is a **dense rank**, not the z-index: 0..n-1 in back-to-front order.
 * That way sorting by `paint.z` reproduces the order with no tie-break rule, and
 * the emitter never has to re-derive anything. The authored z-index survives in
 * `source.css`.
 *
 * Pure.
 *
 * @param {Array<Object>} siblings each either a bare descriptor
 *   (`{position, zIndex, float, display, stackingContext}`) or a record with the
 *   computed style on `cs`/`style` and optionally the element on `el`.
 * @returns {number[]} one integer per sibling, in input order
 */
export function paintOrder (siblings) {
  const list = (siblings || []).map(descriptorOf)
  const sorted = list
    .slice()
    .sort((a, b) => a.layer - b.layer || a.z - b.z || a.index - b.index)
  const out = new Array(list.length)
  for (let rank = 0; rank < sorted.length; rank++) out[sorted[rank].index] = rank
  return out
}

// ——— paint detection ———

/**
 * `false` only when the colour is provably fully transparent. Computed colours
 * that are not `rgb()`/`rgba()` (a `color()` or `oklch()` in a wide-gamut page)
 * are assumed to paint: over-emitting a node costs a node, under-emitting loses
 * the fill.
 */
function paintsColor (value) {
  if (!value || value === 'transparent') return false
  const m = /^rgba?\(([^)]*)\)$/i.exec(value.trim())
  if (!m) return true
  const parts = m[1].split(/[,/]/).map(s => parseFloat(s))
  return !(parts.length >= 4 && parts[3] === 0)
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left']

function paintsBorder (cs) {
  for (const side of SIDES) {
    const style = cs[`border${side}Style`]
    if (!style || style === 'none' || style === 'hidden') continue
    if (num(cs[`border${side}Width`]) <= 0) continue
    if (paintsColor(cs[`border${side}Color`])) return true
  }
  return false
}

function paintsOutline (cs) {
  const style = cs.outlineStyle
  if (!style || style === 'none' || style === 'hidden') return false
  return num(cs.outlineWidth) > 0 && paintsColor(cs.outlineColor)
}

/** Anything `collectBox` would find: backgrounds, borders, outline, shadows, effects. */
function paintsBox (cs) {
  return isSet(cs.backgroundImage) ||
    paintsColor(cs.backgroundColor) ||
    paintsBorder(cs) ||
    paintsOutline(cs) ||
    isSet(cs.boxShadow) ||
    isSet(cs.filter) || isSet(cs.webkitFilter) ||
    isSet(cs.backdropFilter) || isSet(cs.webkitBackdropFilter) ||
    isSet(cs.maskImage) || isSet(cs.webkitMaskImage)
}

/**
 * Compositing that must own a layer of its own. These force a node even with a
 * single child — collapsing `opacity:.5` onto one child changes the result the
 * moment that child has overlapping descendants, which is why the contract makes
 * it a hard rule rather than a heuristic.
 */
function forcesGroup (cs) {
  return opacityOf(cs) < 1 ||
    (isSet(cs.mixBlendMode) && cs.mixBlendMode !== 'normal') ||
    cs.isolation === 'isolate' ||
    isSet(cs.filter) || isSet(cs.webkitFilter) ||
    isSet(cs.backdropFilter) || isSet(cs.webkitBackdropFilter) ||
    isSet(cs.maskImage) || isSet(cs.webkitMaskImage)
}

function clipsContent (cs) {
  return (cs.overflowX && cs.overflowX !== 'visible') ||
    (cs.overflowY && cs.overflowY !== 'visible') ||
    isSet(cs.clipPath) || isSet(cs.webkitClipPath) ||
    CONTAIN_CLIP.test(cs.contain || '') ||
    cs.contentVisibility === 'auto' || cs.contentVisibility === 'hidden'
}

/** Properties that move the border box away from where layout put it. */
function hasTransform (cs) {
  return isSet(cs.transform) || isSet(cs.rotate) || isSet(cs.scale) ||
    isSet(cs.translate) || isSet(cs.offsetPath)
}

/**
 * Makes the element the containing block of `position:fixed` descendants — and,
 * together with `position != static`, of absolutely positioned ones.
 */
function isFixedContainingBlock (cs) {
  return hasTransform(cs) ||
    isSet(cs.filter) || isSet(cs.webkitFilter) ||
    isSet(cs.backdropFilter) || isSet(cs.webkitBackdropFilter) ||
    isSet(cs.perspective) ||
    CONTAIN_SC.test(cs.contain || '') ||
    willChangeCreatesSC(cs.willChange)
}

// ——— geometry ———

/**
 * Untransformed border box in layout space. `offsetLeft`/`offsetTop` are defined
 * against the offset parent's PADDING edge, hence the `clientLeft`/`clientTop`
 * correction on the way up, and none of them sees a transform — which is the
 * whole reason this exists next to `getBoundingClientRect`. They are rounded to
 * integers, so every caller records the loss.
 */
function layoutBox (el) {
  if (typeof el.offsetWidth !== 'number' || typeof el.offsetLeft !== 'number') return null
  let x = 0
  let y = 0
  let node = el
  let guard = 0
  while (node && guard++ < 1024) {
    x += node.offsetLeft
    y += node.offsetTop
    const parent = node.offsetParent
    if (!parent) break
    x += parent.clientLeft
    y += parent.clientTop
    node = parent
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

function rectOf (el) {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** MathMLElement has no offset box. Measure the clone with its transform chain
 * neutralized, then restore it synchronously before any collector runs. Using
 * its painted bbox as layout would apply translations and scales twice. */
function mathLayoutBox (el, rootEl) {
  const saved = []
  try {
    for (let current = el; current; current = current.parentElement) {
      const style = current.style
      if (style) {
        const transformed = hasTransform(current.ownerDocument.defaultView.getComputedStyle(current))
        saved.push([current, current.getAttribute('style')])
        for (const name of ['transition', 'translate', 'rotate', 'scale', 'offset-path']) {
          style.setProperty(name, 'none', 'important')
        }
        // An identity matrix keeps the containing block that an existing
        // transform establishes for fixed/absolute descendants.
        style.setProperty('transform', transformed ? 'matrix(1,0,0,1,0,0)' : 'none', 'important')
      }
      if (current === rootEl) break
    }
    return { box: rectOf(el), root: rectOf(rootEl) }
  } finally {
    // Restore geometry while transitions are still disabled. Otherwise the
    // measurement itself could start a new transition on the mounted clone.
    for (const [element, style] of saved) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
      element.style.setProperty('transition', 'none', 'important')
    }
    if (saved.length) el.getBoundingClientRect()
    for (const [element, style] of saved) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }
  }
}

function unionBoxes (boxes) {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function overlaps (a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS &&
    a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
}

/** `outer` covers all of `inner`, so a clip at `outer` would cut nothing off it. */
function containsBox (outer, inner) {
  return inner.x >= outer.x - EPS && inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
}

// ——— snapdom clone artifacts ———

/**
 * Which pseudo-element this clone node IS, or `null` for an ordinary element.
 *
 * `pseudo.js` materialises `::before`, `::after` and `::first-letter` as spans that
 * carry their own selector in `data-snapdom-pseudo`; `prepare.js` appends the
 * `::backdrop` of a lifted top-layer element as a `[data-sd-backdrop]` div. Both are
 * real boxes with real paint — the only thing they need from us is to say what they
 * are, because a layer named `span` is a layer the designer cannot place.
 *
 * @param {Element} el
 * @returns {string|null} e.g. `'::before'`
 */
function pseudoSelectorOf (el) {
  if (typeof el.getAttribute !== 'function') return null
  const marked = el.getAttribute(PSEUDO_ATTR)
  if (marked) return marked.startsWith('::') ? marked : `::${marked.replace(/^:/, '')}`
  return el.hasAttribute(BACKDROP_ATTR) ? '::backdrop' : null
}

/**
 * `makeHideSpacer` (snapdom/src/core/clone.js): the stand-in for an element the
 * caller excluded in `hide` mode. A bare div whose entire style attribute is the
 * four declarations below — it holds the space and paints nothing, and snapdom
 * gives it no attribute of its own, so the signature IS the identification. An
 * authored div cannot wear it by accident: it would have to carry those exact four
 * declarations inline, no class and no content.
 */
function isExclusionSpacer (el) {
  if (el.tagName !== 'DIV' || el.firstChild) return false
  if (el.attributes.length !== 1 || !el.hasAttribute('style')) return false
  const s = el.style
  return s.length === 4 && s.visibility === 'hidden' && !!s.display && !!s.width && !!s.height
}

/**
 * `makeClipHusk` (same file): what is left of a subtree that painted entirely
 * outside the capture's clip window. A shallow clone — so it is empty — with the
 * original's computed styles, a frozen box pinned by matching min/max, and
 * `visibility:hidden`. Unlike a spacer it stands for content that exists on the
 * page, which is why it is emitted rather than pruned.
 */
function isClipHusk (el) {
  if (el.firstChild) return false
  const s = el.style
  if (!s || s.visibility !== 'hidden' || s.boxSizing !== 'border-box') return false
  const pinnedW = !!s.width && s.minWidth === s.width && s.maxWidth === s.width
  const pinnedH = !!s.height && s.minHeight === s.height && s.maxHeight === s.height
  return pinnedW || pinnedH
}

/**
 * `wrapScrolledClone` (snapdom/src/core/prepare.js): the inner div that carries
 * `translate(-scrollX, -scrollY)` so a scrolled container shows what it showed live.
 * It is not an element of the page, but it positions every child it holds, so it is
 * kept — dropping the layer would drop the offset with it.
 */
function isScrollWrapper (el) {
  if (el.tagName !== 'DIV') return false
  if (el.attributes.length !== 1 || !el.hasAttribute('style')) return false
  const s = el.style
  // `all: unset` is read from the CSSOM, never from the style ATTRIBUTE: Chromium
  // serializes the shorthand expanded into every longhand it covers, so the attribute
  // text has no `all:` in it at all while `style.all` still answers `unset`.
  return s.all === 'unset' && s.display === 'inline-block' && s.width === '100%' &&
    s.willChange === 'transform' && /^translate\(/.test(s.transform || '')
}

/**
 * `svgDefs.js` (snapdom): a zero-sized `<svg class="inline-defs-container">`
 * inserted as the clone's first child, holding copies of the `<defs>` that the
 * captured SVGs reference but that live OUTSIDE the captured subtree. It is a
 * lookup table, not a picture — it paints nothing at any size, and its whole
 * content is reached through `url(#…)` from elsewhere.
 *
 * It has to be named here because the walk would otherwise type it `vector`,
 * hand it to `collectImage`, and mint a 300×150 asset for a 0×0 box: a fourth
 * icon that is not an icon. `collect/image.js` resolves references against this
 * container by design, so pruning the node loses nothing.
 */
function isInlineDefsContainer (el) {
  return el.localName === 'svg' && !!el.classList &&
    el.classList.contains('inline-defs-container') && el.getAttribute('aria-hidden') === 'true'
}

/**
 * @param {Element} el
 * @returns {'exclusion-spacer'|'clip-husk'|'scroll-wrapper'|'defs-container'|null}
 */
function cloneArtifactOf (el) {
  if (typeof el.hasAttribute !== 'function' || !el.style) return null
  if (isExclusionSpacer(el)) return 'exclusion-spacer'
  if (isScrollWrapper(el)) return 'scroll-wrapper'
  if (isClipHusk(el)) return 'clip-husk'
  if (isInlineDefsContainer(el)) return 'defs-container'
  return null
}

// ——— CSS counters: verifying the numbers the clone arrived with ———

/**
 * A materialised `::before` carries its number as literal text, so nothing
 * downstream can tell `2.1` from `2.3` — the export is not low-fidelity, it is
 * WRONG, and it says so nowhere. This section recomputes the counters the way
 * css-lists-3 §4 defines them and compares, so a wrong number leaves as a
 * declared wrong number instead of a confident one.
 *
 * It repairs nothing. The resolution happens in snapdom, before the clone exists
 * (`snapdom/src/modules/counter.js`), and the numbers are baked into text nodes
 * that were already laid out at that width; rewriting them here would be a
 * second implementation of a feature that has one owner.
 */

/** `counter-reset: a 1, b` → `[['a',1],['b',0]]`. `none`/empty → `[]`. */
function parseCounterDecl (value, fallback) {
  if (typeof value !== 'string' || !value || value === 'none') return []
  const out = []
  for (const part of value.split(',')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    // `reversed(name)` is css-lists-3 and Chromium serializes it verbatim; the
    // walk has no reversed support, so the counter is left out rather than
    // counted forwards.
    if (/^reversed\(/i.test(tokens[0])) continue
    const n = Number(tokens[1])
    out.push([tokens[0], Number.isFinite(n) ? n : fallback])
  }
  return out
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]

/**
 * The counter styles whose rendering is defined in css-counter-styles-3 and can
 * be reproduced here. A custom `@counter-style` cannot, and a token that names
 * one aborts the whole comparison rather than guessing at it.
 *
 * @returns {string|null} null when the style is not one we can render
 */
function formatCounter (value, style) {
  switch (String(style || 'decimal').toLowerCase()) {
    case 'decimal': return String(value)
    case 'decimal-leading-zero': {
      const abs = Math.abs(value)
      return `${value < 0 ? '-' : ''}${abs < 10 ? '0' : ''}${abs}`
    }
    case 'lower-alpha': case 'lower-latin': case 'upper-alpha': case 'upper-latin': {
      if (value < 1) return String(value)
      let s = ''
      let x = value
      while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) }
      return /upper/.test(style) ? s.toUpperCase() : s
    }
    case 'lower-roman': case 'upper-roman': {
      if (value < 1 || value > 3999) return String(value)
      let num = value
      let out = ''
      for (const [v, sym] of ROMAN) while (num >= v) { out += sym; num -= v }
      return style === 'upper-roman' ? out : out.toLowerCase()
    }
    default: return null
  }
}

/**
 * Correct counter values for every element under `root`, keyed by element.
 *
 * The scope rule is the whole game and it is the one snapdom gets wrong: a
 * counter created by `counter-reset` on E is in scope for **E, E's descendants
 * and E's following siblings**, and for nothing else. So the state an element
 * hands to its next sibling is the state as of the element ITSELF — instances
 * pushed by its descendants are gone, while increments those descendants applied
 * to instances that were already in scope survive, which falls out of sharing
 * the instance objects by reference instead of copying their values.
 *
 * @returns {WeakMap<Element, Map<string, number[]>>} innermost value last
 */
function buildCounterValues (root, st) {
  const values = new WeakMap()
  const dfs = (el, incoming) => {
    const cs = st.styleOf(el)
    // `display:none` generates no boxes and therefore no counters.
    if (!cs || cs.display === 'none') return incoming

    let state = incoming
    const push = (name, instance) => {
      const next = new Map(state)
      next.set(name, [...(state.get(name) || []), instance])
      state = next
    }
    const top = (name) => {
      const stack = state.get(name)
      return stack && stack.length ? stack[stack.length - 1] : null
    }

    for (const [name, value] of parseCounterDecl(cs.counterReset, 0)) push(name, { value })
    for (const [name, value] of parseCounterDecl(cs.counterSet, 0)) {
      const instance = top(name)
      if (instance) instance.value = value
      else push(name, { value })
    }
    for (const [name, by] of parseCounterDecl(cs.counterIncrement, 1)) {
      const instance = top(name)
      // No counter in scope: css-lists-3 says the increment implies a
      // `counter-reset: name 0` on this element, scope included.
      if (instance) instance.value += by
      else push(name, { value: by })
    }

    const snapshot = new Map()
    for (const [name, stack] of state) snapshot.set(name, stack.map((i) => i.value))
    values.set(el, snapshot)

    let childState = state
    for (const child of el.children) childState = dfs(child, childState)
    // `state`, not `childState`: what a following sibling sees is this element's
    // own scope, with the shared instances carrying whatever the subtree did.
    return state
  }
  dfs(root, new Map())
  return values
}

/** Rules that could be the source of a counter-bearing `content`, in sheet order. */
function counterContentRules (st) {
  if (st.counterRules) return st.counterRules
  const rules = []
  const collect = (list) => {
    for (const rule of list || []) {
      const content = rule.style && rule.style.content
      if (content && /\bcounters?\s*\(/.test(content)) {
        for (const part of String(rule.selectorText || '').split(',')) {
          const m = /^(.*?)::?(before|after)\s*$/i.exec(part.trim())
          if (m && m[1]) rules.push({ base: m[1].trim(), sel: `::${m[2].toLowerCase()}`, content })
        }
      }
      // Not `else`: CSS nesting gave CSSStyleRule a `cssRules` of its own, so a
      // rule can both declare and contain. Testing containment first skipped
      // every style rule in the sheet — an empty CSSRuleList is still truthy.
      if (rule.cssRules) collect(rule.cssRules)
    }
  }
  if (typeof document !== 'undefined' && document.styleSheets) {
    for (const sheet of document.styleSheets) {
      // A cross-origin sheet throws on `cssRules`; its templates are simply not
      // knowable from here, and an unknown template means no claim is made.
      try { collect(sheet.cssRules) } catch { /* not readable */ }
    }
  }
  st.counterRules = rules
  return rules
}

/**
 * The `content` template behind a materialised pseudo — from the page's own
 * stylesheets, because the clone puts it out of reach of `getComputedStyle`:
 * snapdom suppresses `content` on the originating element
 * (`[data-snapdom-has-before]::before{content:none}`) so the span is not painted
 * on top of the pseudo it stands for.
 *
 * Last matching rule wins, which is the cascade for equal specificity and close
 * enough for a check that fails silent — a wrong template does not match the
 * rendered text and the comparison is abandoned rather than reported.
 */
function pseudoContentTemplate (el, sel, st) {
  let found = null
  for (const rule of counterContentRules(st)) {
    if (rule.sel !== sel) continue
    try {
      if (el.matches(rule.base)) found = rule.content
    } catch { /* an unsupported selector is not a match */ }
  }
  return found
}

/**
 * Splits a computed `content` value into literals and counter calls.
 * @returns {Array<{lit:string}|{name:string, style:string, sep:string|null}>|null}
 *   null when the value holds anything else — `attr()`, `url()`, quotes — since
 *   only an exactly reconstructible template can convict a number of being wrong.
 */
function parseContentTokens (css) {
  const out = []
  let i = 0
  const text = String(css)
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"' || ch === "'") {
      let lit = ''
      i++
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') {
          // CSS escapes in a serialized string are `\"`, `\\` and hex escapes.
          const hex = /^\\([0-9a-f]{1,6})\s?/i.exec(text.slice(i))
          if (hex) { lit += String.fromCodePoint(parseInt(hex[1], 16)); i += hex[0].length; continue }
          lit += text[i + 1] || ''
          i += 2
          continue
        }
        lit += text[i++]
      }
      i++
      out.push({ lit })
      continue
    }
    const call = /^counters?\s*\(/i.exec(text.slice(i))
    if (!call) return null
    const isCounters = /^counters/i.test(call[0])
    const close = text.indexOf(')', i)
    if (close === -1) return null
    const args = text.slice(i + call[0].length, close).split(',').map((a) => a.trim())
    i = close + 1
    const unquote = (v) => (v && /^["'].*["']$/.test(v) ? v.slice(1, -1) : v)
    if (isCounters) out.push({ name: args[0], sep: unquote(args[1]) || '', style: args[2] || 'decimal' })
    else out.push({ name: args[0], sep: null, style: args[1] || 'decimal' })
  }
  return out.length ? out : null
}

const RX_ESCAPE = /[.*+?^${}()|[\]\\]/g

/**
 * Checks one materialised pseudo's number against the counters the clone itself
 * declares, and says so when they disagree.
 *
 * @param {Element} span   the `<span data-snapdom-pseudo>` snapdom materialised
 * @param {string} sel     `'::before'` or `'::after'`
 * @returns {{expected:string, observed:string, names:string[]}|null} null when
 *   they agree, when the template is not reconstructible, or when the element
 *   has no counter-bearing content at all
 */
function checkCounterContent (span, sel, st) {
  const origin = span.parentElement
  if (!origin) return null
  const template = pseudoContentTemplate(origin, sel, st)
  if (!template) return null
  const tokens = parseContentTokens(template)
  if (!tokens) return null

  if (!st.counters) st.counters = buildCounterValues(st.rootEl, st)
  // The pseudo is a child of its originating element in the clone and DFS order
  // put it after the element's own increments, which is where CSS puts it too.
  const scope = st.counters.get(span) || st.counters.get(origin)
  if (!scope) return null

  let expected = ''
  const names = []
  let pattern = ''
  for (const token of tokens) {
    if (token.lit !== undefined) {
      expected += token.lit
      pattern += token.lit.replace(RX_ESCAPE, '\\$&')
      continue
    }
    const stack = scope.get(token.name) || []
    names.push(token.name)
    const parts = (token.sep === null ? stack.slice(-1) : stack).map((v) => formatCounter(v, token.style))
    if (parts.some((p) => p === null)) return null
    expected += parts.join(token.sep === null ? '' : token.sep)
    pattern += '(.*?)'
  }

  const observed = span.textContent || ''
  if (observed === expected) return null
  // The template has to explain the rendered string before it can accuse it: if
  // it does not match, the rule we picked is not the rule that produced this
  // text and nothing here is worth reporting.
  if (!new RegExp(`^${pattern}$`).test(observed)) return null
  return { expected, observed, names }
}

// ——— ::marker: rebuilding what the UA paints and the clone cannot carry ———

/**
 * A list marker is the one piece of generated content snapdom leaves native: it
 * has no element, no box and no `getComputedStyle` that answers where it is, so
 * for as long as it stayed native the item exported without its number. What IS
 * readable is everything it is MADE of — `list-style-type` plus the page's own
 * `@counter-style` rules from the CSSOM, the marker's font and colour from
 * `getComputedStyle(li, '::marker')`, and the ordinal from the list itself — so
 * the marker is rebuilt as a real absolutely-positioned span in the clone and
 * then walked, measured and collected like any other text. No geometry is
 * invented: the span is placed, measured, corrected by the delta, and measured
 * again, and one that does not land where it was aimed is removed rather than
 * shipped.
 *
 * Two facts about Chromium's placement, both measured on `demo/challenges.html`
 * rather than assumed (`§1 · ` at 12px/750 ends at 510.0 with the item's content
 * edge at 510; `◆  ` at 11px ends at 534.0 with the edge at 534):
 *
 *  - a `list-style-position: outside` marker is RIGHT-ALIGNED to the item's
 *    content edge — the marker string's advance ends exactly there;
 *  - it sits on the item's first line baseline.
 *
 * The string itself is the part that could be silently wrong, so it is checked
 * against the browser rather than trusted: flipping the item to
 * `list-style-position: inside` puts the real marker in the line box and the
 * first text run moves right by exactly the real marker's advance. If our
 * candidate string does not measure the same, we do not know what the UA is
 * drawing and the item keeps its `B4.list-marker` declaration.
 */

/** Ceiling on the probe: two forced layouts over a list this long is not worth it. */
const MAX_SYNTH_MARKERS = 400

/** Ascents come from a canvas, the same source `collect/text.js` measures baselines with. */
function measureContext (st) {
  if (st.measure === undefined) {
    try {
      st.measure = document.createElement('canvas').getContext('2d')
    } catch {
      st.measure = null
    }
  }
  return st.measure
}

function fontShorthand (cs) {
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
}

/** Chromium rounds `fontBoundingBox*` per size, so this caches on the exact string. */
function ascentOf (font, st) {
  if (!st.ascents) st.ascents = new Map()
  if (st.ascents.has(font)) return st.ascents.get(font)
  const g = measureContext(st)
  let ascent = null
  if (g) {
    g.font = font
    if (g.font) {
      const m = g.measureText('Hxg')
      if (Number.isFinite(m.fontBoundingBoxAscent)) ascent = m.fontBoundingBoxAscent
    }
  }
  st.ascents.set(font, ascent)
  return ascent
}

/** `"◆" "▲" "●"` → `['◆','▲','●']`; null when a token is not a quoted string. */
function parseSymbolList (css) {
  if (typeof css !== 'string') return null
  const out = []
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch !== '"' && ch !== "'") return null
    let lit = ''
    i++
    while (i < css.length && css[i] !== ch) {
      if (css[i] === '\\') {
        const hex = /^\\([0-9a-f]{1,6})\s?/i.exec(css.slice(i))
        if (hex) { lit += String.fromCodePoint(parseInt(hex[1], 16)); i += hex[0].length; continue }
        lit += css[i + 1] || ''
        i += 2
        continue
      }
      lit += css[i++]
    }
    i++
    out.push(lit)
  }
  return out
}

/** The page's `@counter-style` rules, by name. */
function counterStyleRules (st) {
  if (st.counterStyles) return st.counterStyles
  const map = new Map()
  const collect = (list) => {
    for (const rule of list || []) {
      if (typeof rule.name === 'string' && typeof rule.system === 'string' &&
          typeof rule.symbols === 'string') map.set(rule.name, rule)
      if (rule.cssRules) collect(rule.cssRules)
    }
  }
  if (typeof document !== 'undefined' && document.styleSheets) {
    for (const sheet of document.styleSheets) {
      try { collect(sheet.cssRules) } catch { /* cross-origin */ }
    }
  }
  st.counterStyles = map
  return map
}

/**
 * The predefined styles css-counter-styles-3 §6 writes down as `@counter-style`
 * rules, which is why they can be reproduced at all: they are normative text,
 * not UA private data. The bullet styles declare `suffix: " "`; the numeric and
 * alphabetic ones declare none and so take the property's initial value, `". "`.
 * Anything not here (`disclosure-*`, the CJK and Ethiopic systems, `extends`)
 * stays unreproduced rather than approximated.
 */
const PREDEFINED_MARKERS = {
  disc: '• ',
  circle: '◦ ',
  square: '▪ ',
}

/**
 * The three markers Chromium does not render as text at all: it paints a shape,
 * sized from the marker's font-size and from nothing else. Measured
 * (`scratchpad/probe-marker2.mjs`, dpr 4, Arial / Georgia / Times at 10..40px):
 * the ink is the SAME width in all three families at the same size, which is
 * what proves the glyph is not the font's — a `•` set as text would be as wide
 * as the family makes it, and would land where the string's advance puts it.
 *
 * That is why a bullet cannot be synthesized as text: at 14px the UA's marker
 * BOX is 19.00px wide, its ink is 4.00px, and `"• "` set in the page's own font
 * measures 10.25px. Right-aligning that string to the item's content edge — the
 * rule the text markers are placed by and verified against — puts the bullet
 * about 7px right of where Chromium paints it, which reads as a bullet stuck to
 * its own text.
 *
 * The three laws below are least-squares fits over those 12 sizes, and each one
 * carries the worst residual it had. They are Chromium's, and `B4.list-marker-
 * synthesized` says so on every node that uses them.
 */
const SYMBOL_MARKERS = new Set(['disc', 'circle', 'square'])

/** Ink diameter. `round(0.3 · font-size)` reproduced all 12 measurements exactly. */
const symbolDiameter = (fontSize) => Math.max(1, Math.round(0.3 * fontSize))

/** Gap from the ink's right edge to the item's content edge. Worst residual 0.5px. */
const symbolGap = (fontSize) => 0.3 * fontSize + 6.7

/** Ink centre above the first baseline. Worst residual 0.7px (at 11px). */
const symbolRise = (fontSize) => 0.29 * fontSize

/**
 * The `::marker`'s own `content`, which REPLACES the marker the list-style
 * produces (css-lists-3 §3.2) — and which, unlike everything else about a
 * marker, `getComputedStyle` answers honestly.
 *
 * Reading it is not a refinement, it is a correctness fix: `demo/figma.html`'s
 * `.cl-steps li::marker { content: counter(list-item) " ·" }` renders `1 ·` and
 * this build was emitting `1. ` — the string `list-style-type: decimal` would
 * have produced. It passed the advance check because the two are 0.4px apart,
 * so a wrong STRING shipped as a verified one.
 *
 * @returns {string|null|'none'} the raw CSS value, `'none'` when the author
 *   suppressed the marker, null when there is no authored content
 */
function markerContentOf (markerCs) {
  const raw = markerCs && typeof markerCs.content === 'string' ? markerCs.content.trim() : ''
  if (!raw || raw === 'normal' || raw === 'auto') return null
  if (raw === 'none') return 'none'
  return raw
}

/**
 * The ordinals of `li` and of every list item it is nested in, outermost first —
 * what `counters(list-item, sep)` renders.
 */
function listItemStack (li, st) {
  const out = []
  let node = li
  let guard = 0
  while (node && guard++ < 256) {
    const cs = st.styleOf(node)
    if (cs && /list-item/.test(cs.display || '')) {
      const ordinal = listItemOrdinal(node, st)
      if (ordinal === null) return null
      out.unshift(ordinal)
    }
    node = node.parentElement
  }
  return out
}

/**
 * An authored `::marker { content }` rendered to the string it paints, or null
 * when it is not a template this build can reproduce exactly — `attr()`, a
 * `url()`, an image, or a counter style it cannot format. Null is a rejection,
 * never a fallback: the whole point of reading `content` is that guessing
 * produced the wrong glyphs.
 */
function resolveMarkerContent (css, li, st) {
  let tokens = null
  try {
    tokens = parseContentTokens(css)
  } catch {
    return null
  }
  if (!tokens) return null
  let out = ''
  let nested = false
  for (const token of tokens) {
    if (token.lit !== undefined) {
      out += token.lit
      continue
    }
    let parts
    if (token.name === 'list-item') {
      const stack = listItemStack(li, st)
      if (!stack || !stack.length) return null
      parts = (token.sep === null ? stack.slice(-1) : stack).map((v) => formatCounter(v, token.style))
    } else {
      if (!st.counters) st.counters = buildCounterValues(st.rootEl, st)
      const scope = st.counters.get(li)
      if (!scope) return null
      const stack = scope.get(token.name) || []
      if (!stack.length) return null
      parts = (token.sep === null ? stack.slice(-1) : stack).map((v) => formatCounter(v, token.style))
    }
    if (!parts.length || parts.some((p) => p === null)) return null
    // `counters()` prints the whole stack, and the stack is what the clone gets
    // wrong: see `overruled` in `synthesizeMarkers`.
    if (token.sep !== null) nested = true
    out += parts.join(token.sep === null ? '' : token.sep)
  }
  return { text: out, nested }
}

/**
 * The text a `::marker` renders for `value`, or null when we cannot reproduce it
 * exactly. A marker with the wrong suffix is wrong CONTENT, not a rough one, so
 * every string this returns is measured against the UA's own marker in
 * `synthesizeMarkers` before it is allowed to stand.
 */
function markerTextFor (type, value, st) {
  const rule = counterStyleRules(st).get(type)
  if (!rule) {
    if (PREDEFINED_MARKERS[type]) return PREDEFINED_MARKERS[type]
    if (!Number.isFinite(value)) return null
    const body = formatCounter(value, type)
    return body === null ? null : `${body}. `
  }
  if (!Number.isFinite(value)) return null
  const symbols = parseSymbolList(rule.symbols)
  if (!symbols || !symbols.length) return null
  const prefixList = rule.prefix ? parseSymbolList(rule.prefix) : []
  const suffixList = rule.suffix ? parseSymbolList(rule.suffix) : []
  if (prefixList === null || suffixList === null) return null
  const prefix = prefixList.length ? prefixList[0] : ''
  // css-counter-styles-3: `suffix` has an initial value of ". ", not "".
  const suffix = rule.suffix ? (suffixList.length ? suffixList[0] : '') : '. '

  const system = String(rule.system || 'symbolic').trim().toLowerCase()
  const n = symbols.length
  let body = null
  if (system === 'cyclic') {
    body = symbols[(value - 1 + n * Math.ceil(Math.abs(value) / n + 1)) % n]
  } else if (system === 'symbolic') {
    if (value < 1) return null
    body = symbols[(value - 1) % n].repeat(Math.ceil(value / n))
  } else if (system === 'numeric') {
    if (n < 2) return null
    let v = Math.abs(value)
    body = v === 0 ? symbols[0] : ''
    while (v > 0) { body = symbols[v % n] + body; v = Math.floor(v / n) }
    if (value < 0) return null
  } else if (system === 'alphabetic') {
    if (value < 1 || n < 2) return null
    let v = value
    body = ''
    while (v > 0) { v--; body = symbols[v % n] + body; v = Math.floor(v / n) }
  } else if (/^fixed\b/.test(system)) {
    const first = Number((/^fixed\s+(-?\d+)/.exec(system) || [])[1] ?? 1)
    const i = value - first
    if (i < 0 || i >= n) return null
    body = symbols[i]
  } else {
    // `additive` and `extends` need `additive-symbols` / the extended style's
    // own definition; neither is reproduced rather than approximated.
    return null
  }
  return body === null || body === undefined ? null : prefix + body + suffix
}

/**
 * The ordinal the UA numbers this item with: `value` on the item wins, then the
 * running count from the list's `start`. `reversed` is not counted here.
 */
function listItemOrdinal (li, st) {
  const parent = li.parentElement
  if (!parent) return null
  const ordered = parent.tagName === 'OL'
  if (ordered && parent.hasAttribute('reversed')) return null
  // Same trap as `value` below: `Number(null)` is 0, and taking it started every
  // ordered list at zero.
  const rawStart = ordered ? parent.getAttribute('start') : null
  const start = rawStart === null || rawStart.trim() === '' ? NaN : Number(rawStart)
  let current = (Number.isFinite(start) ? start : 1) - 1
  for (const sib of parent.children) {
    const cs = st.styleOf(sib)
    if (!cs || !/list-item/.test(cs.display || '')) {
      if (sib === li) return null
      continue
    }
    // `getAttribute` answers null when the attribute is absent, and `Number(null)`
    // is 0 — which numbered every item in the list zero and still passed the
    // advance check, because "§0 · " and "§1 · " are the same width.
    const raw = sib.getAttribute ? sib.getAttribute('value') : null
    const own = raw === null || raw.trim() === '' ? NaN : Number(raw)
    current = Number.isFinite(own) ? own : current + 1
    if (sib === li) return current
  }
  return null
}

/** The first laid-out text run inside `el`, as its rect plus the element styling it. */
function firstTextRun (el) {
  const doc = el.ownerDocument
  if (!doc || typeof doc.createTreeWalker !== 'function') return null
  const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */)
  let node
  while ((node = walker.nextNode())) {
    if (!node.data || !node.data.trim()) continue
    const range = doc.createRange()
    range.selectNodeContents(node)
    const rects = range.getClientRects()
    if (rects.length) return { rect: rects[0], host: node.parentElement }
  }
  return null
}

/**
 * `font-variant-numeric` is on this list for a reason worth writing down: the
 * `::marker` UA sheet sets `tabular-nums` (css-lists-3 §3.2), so the browser
 * lays `§1 · ` and `§2 · ` out at the SAME width — and a canvas cannot be told
 * about tabular figures at all, which is why the width check below is done in
 * the DOM and not with `measureText`.
 */
const MARKER_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'fontVariantNumeric', 'fontFeatureSettings', 'fontSynthesis',
  'letterSpacing', 'wordSpacing', 'color', 'textTransform', 'unicodeBidi',
]

/**
 * Rebuilds every reproducible `::marker` in the clone as a real element.
 * Runs before the walk and is layout-neutral: the spans are out of flow, and the
 * `list-style-position` probe is reverted before anything is measured.
 *
 * @param {Element} root
 * @param {object} st
 */
function synthesizeMarkers (root, st) {
  if (typeof document === 'undefined' || !measureContext(st)) return
  const doc = root.ownerDocument
  if (!st.markerSynthesized) st.markerSynthesized = new WeakSet()
  if (!st.markerRejected) st.markerRejected = new Map()
  const candidates = []
  for (const el of [root, ...root.querySelectorAll('li, [style*="list-item"], [class]')]) {
    if (candidates.length >= MAX_SYNTH_MARKERS) break
    const cs = st.styleOf(el)
    if (!cs || !/list-item/.test(cs.display || '')) continue
    // Only the outside marker has the measured placement rule; `inside` is an
    // inline box in the line and would need the line broken around it.
    if (cs.listStylePosition !== 'outside') continue
    if (isSet(cs.listStyleImage)) continue
    if (cs.direction !== 'ltr' || cs.visibility !== 'visible') continue
    if (el.querySelector(`:scope > [${PSEUDO_ATTR}="::marker"]`)) continue
    let markerCs
    try {
      markerCs = getComputedStyle(el, '::marker')
    } catch {
      continue
    }
    if (!markerCs || !markerCs.fontSize) continue

    // `content` outranks `list-style-type` — including `content: none`, which is
    // the author saying the marker paints nothing at all. Nothing is lost there,
    // so it is not declared either.
    const authored = markerContentOf(markerCs)
    if (authored === 'none') continue
    if (cs.listStyleType === 'none' && !authored) continue

    let text = null
    let symbol = null
    let nested = false
    if (authored) {
      const resolved = resolveMarkerContent(authored, el, st)
      if (!resolved) {
        st.markerRejected.set(el, `its ::marker sets content: ${authored}, which is not a template this ` +
          'build can resolve exactly (it reads strings, counter() and counters())')
        continue
      }
      text = resolved.text
      nested = resolved.nested
    } else if (SYMBOL_MARKERS.has(cs.listStyleType)) {
      const fontSize = num(markerCs.fontSize)
      if (!(fontSize > 0)) continue
      const d = symbolDiameter(fontSize)
      symbol = {
        type: cs.listStyleType,
        // A `circle` is the same disc drawn hollow, and its ink measured exactly
        // 1px wider than the filled one at every size: a 1px stroke on the
        // outside of the same circle.
        size: cs.listStyleType === 'circle' ? d + 1 : d,
        stroke: cs.listStyleType === 'circle' ? Math.max(1, Math.round(fontSize / 14)) : 0,
        gap: symbolGap(fontSize),
        rise: symbolRise(fontSize),
        color: markerCs.color,
        fontSize,
      }
    } else {
      // No ordinal, no number. Falling back to 1 was silent content corruption of
      // exactly the kind this whole path exists to avoid: every item of an
      // `<ol reversed>` would have printed "1." and PASSED the advance check,
      // because the UA sheet gives a marker `tabular-nums` and "1." and "3." are
      // the same width.
      const value = listItemOrdinal(el, st)
      if (value === null) {
        st.markerRejected.set(el, 'the ordinal this item is numbered with could not be resolved (an ' +
          '`<ol reversed>`, or an item whose list is not its parent element), and a marker with the ' +
          'wrong number is wrong content rather than an approximation of it')
        continue
      }
      text = markerTextFor(cs.listStyleType, value, st)
      if (!text) continue
    }
    const anchor = firstTextRun(el)
    if (!anchor || !anchor.host) continue
    const hostCs = st.styleOf(anchor.host)
    const ascent = hostCs ? ascentOf(fontShorthand(hostCs), st) : null
    if (ascent === null) continue
    const box = el.getBoundingClientRect()
    candidates.push({
      el,
      text,
      symbol,
      authored: !!authored,
      nested,
      markerCs,
      // The probe below reads the marker from INSIDE the line box, where its
      // trailing white-space collapses against the text that follows it. A
      // suffix of two spaces measures one there, so that is the string the check
      // compares — otherwise every wide-suffix style is rejected for being right.
      collapsedText: text ? text.replace(/[ \t\n\r\f]+/g, ' ') : null,
      contentLeft: box.left + num(cs.borderLeftWidth) + num(cs.paddingLeft),
      baseline: anchor.rect.top + ascent,
      textLeft: anchor.rect.left,
    })
  }
  if (!candidates.length) return

  // The browser's own answer for "how wide is the real marker": inside the line
  // box, the first text run starts exactly that much further right.
  for (const c of candidates) c.el.style.setProperty('list-style-position', 'inside', 'important')
  for (const c of candidates) {
    const probe = firstTextRun(c.el)
    c.measured = probe ? probe.rect.left - c.textLeft : null
  }
  for (const c of candidates) c.el.style.removeProperty('list-style-position')

  const placed = []
  for (const c of candidates) {
    if (c.measured === null) {
      st.markerRejected.set(c.el, `${c.symbol ? `a ${c.symbol.type} bullet` : `"${c.text}"`} could not be ` +
        'checked against the marker the UA draws')
      continue
    }
    const span = doc.createElement('span')
    span.setAttribute(PSEUDO_ATTR, '::marker')
    span.setAttribute('data-snapdom-vector-marker', '')
    span.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;' +
      'white-space:pre;line-height:normal;text-decoration:none;pointer-events:none;'
    if (c.symbol) {
      // A shape, not a glyph: `display:block` so the box IS the ink, and
      // `box-sizing:border-box` so a hollow `circle`'s stroke stays inside the
      // size that was measured.
      span.style.display = 'block'
      span.style.boxSizing = 'border-box'
      span.style.width = `${c.symbol.size}px`
      span.style.height = `${c.symbol.size}px`
      if (c.symbol.type === 'circle') span.style.border = `${c.symbol.stroke}px solid ${c.symbol.color}`
      else span.style.background = c.symbol.color
      if (c.symbol.type !== 'square') span.style.borderRadius = '50%'
    } else {
      // Collapsed first: this is still the CHECK, laid out by the same engine that
      // drew the real marker, and the only measurement that can see tabular figures.
      span.textContent = c.collapsedText
      for (const prop of MARKER_STYLE_PROPS) {
        const value = c.markerCs[prop]
        if (value) span.style[prop] = value
      }
    }
    c.el.appendChild(span)
    c.span = span
    placed.push(c)
  }
  if (!placed.length) return

  const checked = []
  for (const c of placed) {
    // A bullet has no advance to compare — the UA is not setting a string. What
    // the probe still says is how wide the marker BOX is, and the shape has to
    // fall inside it: that is what catches an engine whose bullet is somewhere
    // else entirely, which is the failure the string check exists to catch.
    if (c.symbol) {
      const room = c.symbol.gap + c.symbol.size
      if (room > c.measured + 1.5) {
        st.markerRejected.set(c.el, `a ${c.symbol.type} bullet drawn by the law measured in Chromium would ` +
          `sit ${room.toFixed(2)}px left of the content edge and this engine's marker box is only ` +
          `${c.measured.toFixed(2)}px wide, so the bullet would land outside the marker`)
        c.span.remove()
        continue
      }
      checked.push(c)
      continue
    }
    const run = firstTextRun(c.span)
    const mine = run ? run.rect.width : null
    if (mine === null || Math.abs(mine - c.measured) > 1) {
      // One disagreement is not evidence against us, and it is the one this file
      // already has a repair for elsewhere: `counters(list-item, …)` prints the
      // whole stack of list-item counters in scope, and the clone is MOUNTED
      // beside the page it was cloned from, so Chromium's sibling-carry
      // (`snapdom/src/modules/counter.js`, and see `repairCounters`) leaks the
      // live document's list-item instances into it. Measured on a two-level
      // list: the clone's own marker box is 28.03px where the item renders `1) `
      // (16.36px) on the page, because the clone renders `1.1) `. The stack
      // resolved above is the css-lists-3 one, taken from the tree, and the
      // extra levels can only make the UA's marker WIDER — so a wider marker on
      // a `counters()` template is overruled, and says so on the node.
      const overruled = c.nested && mine !== null && mine < c.measured
      if (!overruled) {
        st.markerRejected.set(c.el, mine === null
          ? `"${c.text}" could not be laid out to check against the marker the UA draws`
          : `"${c.text}" lays out ${mine.toFixed(2)}px wide in the line box and the marker the UA draws is ${c.measured.toFixed(2)}px`)
        c.span.remove()
        continue
      }
      c.overruled = { mine, measured: c.measured }
    }
    checked.push(c)
  }
  for (const c of checked) if (!c.symbol) c.span.textContent = c.text
  placed.length = 0
  placed.push(...checked)
  if (!placed.length) return

  // Aim, measure, correct by the delta: nothing here depends on which box the
  // absolute position resolved against.
  for (const c of placed) {
    if (c.symbol) {
      const rect = c.span.getBoundingClientRect()
      c.fix = rect.width > 0
        ? {
            dx: (c.contentLeft - c.symbol.gap - c.symbol.size) - rect.left,
            dy: (c.baseline - c.symbol.rise - c.symbol.size / 2) - rect.top,
          }
        : null
      continue
    }
    const run = firstTextRun(c.span)
    const font = fontShorthand(st.styleOf(c.span) || c.markerCs)
    const ascent = ascentOf(font, st)
    c.fix = run && ascent !== null
      ? { dx: c.contentLeft - run.rect.right, dy: c.baseline - (run.rect.top + ascent), ascent, font }
      : null
  }
  for (const c of placed) {
    if (!c.fix) { c.span.remove(); continue }
    c.span.style.left = `${c.fix.dx}px`
    c.span.style.top = `${c.fix.dy}px`
  }
  for (const c of placed) {
    if (!c.fix) continue
    let ok
    if (c.symbol) {
      const rect = c.span.getBoundingClientRect()
      ok = Math.abs(rect.right - (c.contentLeft - c.symbol.gap)) < 0.5 &&
        Math.abs((rect.top + rect.height / 2) - (c.baseline - c.symbol.rise)) < 0.5
    } else {
      const run = firstTextRun(c.span)
      ok = !!run &&
        Math.abs(run.rect.right - c.contentLeft) < 0.5 &&
        Math.abs(run.rect.top + c.fix.ascent - c.baseline) < 0.5
    }
    if (!ok) {
      st.markerRejected.set(c.el, `${c.symbol ? `a ${c.symbol.type} bullet` : `"${c.text}"`} would not land ` +
        'where it was aimed at, so the placement is not the one that was measured')
      c.span.remove()
      continue
    }
    st.markerSynthesized.add(c.el)
    c.el.setAttribute('data-snapdom-vector-marker-host', c.symbol ? `${c.symbol.type} bullet` : c.text)
    if (c.symbol) c.el.setAttribute('data-snapdom-vector-marker-shape', c.symbol.type)
    else if (c.authored) c.el.setAttribute('data-snapdom-vector-marker-authored', '')
    if (c.overruled) {
      c.el.setAttribute('data-snapdom-vector-marker-overruled',
        `${c.overruled.mine.toFixed(2)}/${c.overruled.measured.toFixed(2)}`)
    }
  }
}

/**
 * Rewrites every materialised counter whose number disagrees with the counters
 * the clone itself declares, before anything in the tree is measured.
 *
 * Repairing rather than declaring is deliberate and it is the exception, not the
 * rule. Everywhere else this engine states what it lost; here there is nothing to
 * state a loss OF — by the time the clone exists the number is literal text, so
 * a reader has no way to tell "2.3" from a correct 2.3, and the export ships a
 * WRONG number rather than an approximated one. That is content corruption, the
 * same class as a word split in half, and this file already has the correct
 * value: `checkCounterContent` resolves the same counters with css-lists-3
 * scoping and only answers when the pseudo's own `content` template EXPLAINS the
 * rendered string and the two still disagree.
 *
 * The cause is upstream and is not fixed here: `snapdom/src/modules/counter.js`,
 * the sibling-carry at the end of `build()`, lets a counter created by a
 * `counter-reset` on a DESCENDANT escape into the next sibling subtree — so
 * `<h5 counter-reset:sub>` in one `<section>` leaks `sub` into the next one and
 * `2.1` renders as `2.3`. That is the fix worth having; this is the repair that
 * stops it reaching a designer's canvas in the meantime, and every instance of it
 * is declared.
 *
 * @param {Element} root
 * @param {object} st
 */
function repairCounters (root, st) {
  if (typeof document === 'undefined') return
  const spans = root.querySelectorAll(`[${PSEUDO_ATTR}="::before"], [${PSEUDO_ATTR}="::after"]`)
  if (!spans.length) return
  if (!st.counterRepaired) st.counterRepaired = new Map()
  for (const span of spans) {
    const sel = span.getAttribute(PSEUDO_ATTR)
    let drift = null
    try {
      drift = checkCounterContent(span, sel, st)
    } catch { continue }
    if (!drift) continue
    span.textContent = drift.expected
    st.counterRepaired.set(span, { ...drift, sel })
  }
}

/**
 * Declares one repaired counter against the node that carries its characters,
 * once per pseudo however many walk steps see it.
 *
 * @param {Element} span   the materialised pseudo
 * @param {string} sel     `'::before'` or `'::after'`
 * @param {object} node    the emitted node the pseudo's text lands in
 */
function reportCounterDrift (span, sel, node, st) {
  if (!st.counterChecked) st.counterChecked = new WeakSet()
  if (st.counterChecked.has(span)) return
  st.counterChecked.add(span)
  const drift = st.counterRepaired && st.counterRepaired.get(span)
  if (!drift) return
  pushDiag(st, {
    code: 'B4.counter-misnumbered',
    severity: 'warn',
    _node: node,
    pseudo: sel,
    counters: drift.names,
    expected: drift.expected,
    got: drift.observed,
    note: `snapdom materialised this ${sel} as "${drift.observed}"; the counters it is built from ` +
      `(${drift.names.join(', ')}) are worth "${drift.expected}" under css-lists-3 scoping, and ` +
      'that is what this capture carries — the string was rewritten in the clone before anything ' +
      'was measured, so the box and the baseline describe the repaired text. It is a REPAIR and ' +
      'not a measurement, which is why it is here: the cause is `snapdom/src/modules/counter.js`, ' +
      'the sibling-carry at the end of `build()`, which lets a counter created by a ' +
      '`counter-reset` on a DESCENDANT escape into the next sibling subtree',
  })
  degrade(node, 'A', `counter rewritten from "${drift.observed}" to "${drift.expected}"`)
}

// ——— form controls: the widget the UA draws and no CSS property describes ———

/**
 * A native control is the one box in the tree whose CONTENTS are not in the tree.
 * `getComputedStyle` says nothing about the tick, the dot, the chevron, the track
 * or the thumb; the UA shadow pseudos that would (`::-webkit-slider-thumb` and
 * friends) return the ELEMENT's own style when no page rule matches them —
 * measured on `demo/challenges.html#fx-form`, where every one of the seven
 * answered `404px x 38px, rgb(255,255,255)`, i.e. the `<select>`'s own box. So
 * there is nothing to read and only two honest options: leave the control empty
 * and say so, or REBUILD the widget from what the element does declare — its
 * type, its state, its value and its `accent-color` — and say that too.
 *
 * This section builds a description, not a picture. It carries semantics and
 * colour; the geometry constants and the drawing live in the backend
 * (`emit/svg-flat.js`, `emitControl`), because "how wide is a checkmark stroke"
 * is a question with a different answer per backend and only one of them is SVG.
 *
 * **Every colour and every proportion here was measured off Chromium's own
 * raster**, at dpr 4, on the fixture and on a bare page, rather than taken from
 * documentation:
 *
 *  - the unchecked box's border is `#767676` and 1px at a 16px control;
 *  - the slider's unfilled track and the progress track are `#efefef`;
 *  - `accent-color: auto` resolves to `#0075ff`, and a `<meter>` with no accent
 *    paints `#107c10` in its optimum band and `#d83b01` outside it;
 *  - the mark ON the accent (the tick, the radio dot's surround) is white on a
 *    dark accent and near-black on a light one, which is a contrast decision the
 *    UA makes and `inkOn` reproduces.
 *
 * It is a RECONSTRUCTION and the node says so: `B4.form-control` keeps its code
 * and now names what was drawn and what was not, so a reader who trusted the old
 * text ("nothing here paints the widget") is not silently told a new story.
 */

/** Native controls whose widget this build can rebuild. `<button>` paints its own label. */
const WIDGET_TAGS = new Set(['INPUT', 'SELECT', 'PROGRESS', 'METER'])

/** `<input type>` values that carry a UA widget worth drawing. */
const WIDGET_INPUT_TYPES = new Set(['checkbox', 'radio', 'range'])

/** Chromium's own colours, read off its raster (see the section header). */
const UA_ACCENT = '#0075ff'
const UA_BORDER = '#767676'
const UA_TRACK = '#efefef'
const UA_SURFACE = '#ffffff'
const UA_METER_OPTIMUM = '#107c10'
const UA_METER_SUBOPTIMUM = '#d83b01'

/** Fallbacks for the two colours above, so a descriptor is never colourless. */
const RGBA_WHITE = [1, 1, 1, 1]
const RGBA_NEAR_BLACK = [0.06, 0.06, 0.06, 1]

/** `parseColor` or null, with the warnings dropped — a colour we chose, not one we read. */
function rgbaOf (css) {
  const hit = css ? parseColor(css) : null
  return hit ? hit.rgba : null
}

/**
 * The mark the UA paints ON the accent colour. Chromium picks it for contrast,
 * not from a property, so the rule is reproduced rather than guessed: sRGB
 * relative luminance over 0.5 takes the dark mark, under it the white one.
 */
function inkOn (rgba) {
  if (!rgba) return RGBA_WHITE
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(rgba[0]) + 0.7152 * lin(rgba[1]) + 0.0722 * lin(rgba[2])
  return L > 0.45 ? RGBA_NEAR_BLACK : RGBA_WHITE
}

/** A finite number from an attribute or an IDL property, or `fallback`. */
function numberOr (value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Where a range/progress/meter sits in its own scale, 0..1, or null when the
 * element is indeterminate (a `<progress>` with no `value` attribute is a
 * DIFFERENT widget — an animated barber's pole — and drawing a bar for it would
 * invent a number the page does not have).
 */
function fractionOf (el, tag, min, max) {
  if (tag === 'PROGRESS' && !(el.hasAttribute && el.hasAttribute('value'))) return null
  const value = numberOr(el.value, NaN)
  if (!Number.isFinite(value)) return null
  if (!(max > min)) return null
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/**
 * What the UA draws inside this control, as data a backend can paint.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @returns {object|null} null when the control has no widget this build rebuilds
 *   (`appearance:none` took it away, or it is a text field, a file picker, a date
 *   picker or a multiple `<select>`, whose widgets are text and buttons rather
 *   than a shape)
 */
function describeWidget (el, cs) {
  const tag = (el.tagName || '').toUpperCase()
  if (!WIDGET_TAGS.has(tag)) return null
  // `appearance:none` means the author replaced the widget with their own CSS,
  // which the ordinary collectors already read. Drawing ours on top of theirs
  // would put two checkboxes in the same box.
  if ((cs.appearance || cs.webkitAppearance || 'auto') === 'none') return null
  if ((cs.visibility || 'visible') !== 'visible') return null

  const accentCss = cs.accentColor && cs.accentColor !== 'auto' ? cs.accentColor : null
  const accent = rgbaOf(accentCss) || rgbaOf(UA_ACCENT)
  const common = {
    accent,
    accentSource: accentCss ? 'accent-color' : 'ua-default',
    ink: inkOn(accent),
    border: rgbaOf(UA_BORDER),
    track: rgbaOf(UA_TRACK),
    surface: rgbaOf(UA_SURFACE),
    direction: cs.direction === 'rtl' ? 'rtl' : 'ltr',
    disabled: !!el.disabled,
  }

  if (tag === 'INPUT') {
    const type = String(el.type || (el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase()
    if (!WIDGET_INPUT_TYPES.has(type)) return null
    if (type === 'range') {
      const min = numberOr(el.min, 0)
      const max = numberOr(el.max, 100)
      return {
        ...common,
        kind: 'range',
        fraction: fractionOf(el, tag, min, max),
        value: String(el.value == null ? '' : el.value),
        min,
        max,
      }
    }
    return {
      ...common,
      kind: type,
      checked: !!el.checked,
      indeterminate: !!el.indeterminate,
    }
  }

  if (tag === 'SELECT') {
    // A multiple/sized select is a LIST: the widget is its options, which are
    // text this backend has no box for. Nothing to draw, and `collectBox` says so.
    if (el.multiple || numberOr(el.size, 1) > 1) return null
    return {
      ...common,
      kind: 'select',
      // The arrow is painted in the select's own `color`, measured on the fixture
      // (`#0f172a`, the authored colour, not a UA grey).
      ink: rgbaOf(cs.color) || common.ink,
      inset: {
        top: num(cs.borderTopWidth),
        right: num(cs.borderRightWidth),
        bottom: num(cs.borderBottomWidth),
        left: num(cs.borderLeftWidth),
      },
    }
  }

  const max = numberOr(el.max, 1)
  const min = tag === 'METER' ? numberOr(el.min, 0) : 0
  const widget = {
    ...common,
    kind: tag === 'METER' ? 'meter' : 'progress',
    fraction: fractionOf(el, tag, min, max),
    value: String(el.value == null ? '' : el.value),
    min,
    max,
  }
  if (widget.kind === 'meter' && !accentCss) {
    // Chromium recolours a meter by which band the value falls in. The bands are
    // readable (`low`/`high`/`optimum`), the exact rule for "even less good" is
    // not, so only the two measured colours are used and the note says so.
    const low = numberOr(el.low, min)
    const high = numberOr(el.high, max)
    const value = numberOr(el.value, min)
    widget.accent = rgbaOf(value >= low && value <= high ? UA_METER_OPTIMUM : UA_METER_SUBOPTIMUM)
    widget.accentSource = 'ua-meter-band'
    widget.ink = inkOn(widget.accent)
  }
  return widget
}

// ——— names and paths ———

/** Framework-generated class names carry no meaning for a designer reading layers. */
const NOISY_CLASS = /^(css|sc|emotion|jsx|svelte|ng|v)-|^[\w-]*[0-9a-f]{6,}$/i

function significantClasses (el) {
  const list = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : []
  return list.filter(c => c && !NOISY_CLASS.test(c)).slice(0, 2)
}

function escapeIdent (value) {
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(value)
  return String(value).replace(/([^\w-])/g, '\\$1')
}

/**
 * First words of the text this block itself renders — `textContent` would be the
 * whole subtree, and a container that happens to hold one stray text node would
 * get named after every descendant it contains.
 */
function textExcerpt (text) {
  const raw = (text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  return raw.length > 32 ? `${raw.slice(0, 31)}…` : raw
}

/**
 * @param {string|null} [pseudo] the pseudo-element this node came from, when it is
 *   one: the span's own tag and generated class say nothing a reader can use, and a
 *   layer called `span` next to the box it decorates is exactly the anonymous layer
 *   this project promises not to produce.
 */
function nodeName (el, tag, kind, text, pseudo) {
  if (pseudo) {
    const excerpt = textExcerpt(text)
    return excerpt ? `${pseudo} “${excerpt}”` : pseudo
  }
  if (kind === 'text') {
    const excerpt = textExcerpt(text)
    return excerpt ? `${tag} “${excerpt}”` : tag
  }
  if (el.id) return `#${el.id}`
  const classes = significantClasses(el)
  if (classes.length) return `.${classes.join('.')}`
  return tag
}

function pathSegment (el, tag, pseudo) {
  // The clone's own spans have generated classes and a position among siblings that
  // the source document does not have; the selector that DOES address them there is
  // the pseudo itself.
  if (pseudo) return pseudo
  if (el.id) return `#${escapeIdent(el.id)}`
  const classes = significantClasses(el)
  if (classes.length) return `${tag}.${classes.map(escapeIdent).join('.')}`
  const parent = el.parentElement
  if (!parent) return tag
  let n = 1
  for (const sib of parent.children) {
    if (sib === el) break
    n++
  }
  return `${tag}:nth-child(${n})`
}

/** The declarations a downstream reader needs to explain a node's placement. */
function sourceCss (cs) {
  const out = { display: cs.display, position: cs.position }
  if (cs.zIndex && cs.zIndex !== 'auto') out.zIndex = cs.zIndex
  if (floatOf(cs) !== 'none') out.float = floatOf(cs)
  if (clipsContent(cs)) out.overflow = `${cs.overflowX} ${cs.overflowY}`.trim()
  if (/(flex|grid)/.test(cs.display || '')) {
    if (isSet(cs.flexDirection)) out.flexDirection = cs.flexDirection
    if (isSet(cs.gridTemplateColumns)) out.gridTemplateColumns = cs.gridTemplateColumns
    if (cs.gap && cs.gap !== 'normal') out.gap = cs.gap
  }
  return out
}

// ——— diagnostics ———

function pushDiag (st, diag) {
  const seen = (st.diagCount.get(diag.code) || 0) + 1
  st.diagCount.set(diag.code, seen)
  if (seen <= st.maxPerCode) st.diagnostics.push(diag)
  else st.suppressed.set(diag.code, (st.suppressed.get(diag.code) || 0) + 1)
}

/** Worst grade wins: a node that is both approximate and omitted is omitted. */
function degrade (node, grade, note) {
  if (GRADE_RANK[grade] > GRADE_RANK[node.fidelity.grade]) node.fidelity.grade = grade
  if (note && !node.fidelity.notes.includes(note)) node.fidelity.notes.push(note)
}

// ——— the walk ———

/**
 * @typedef {Object} CollectCtx
 * @property {(el: Element) => CSSStyleDeclaration} [styleOf] memoised computed styles
 * @property {number} [maxNodes=20000] hard ceiling; the walk stops and says so
 * @property {number} [maxDepth=256]
 * @property {boolean} [pseudo] **no longer read here.** It meant "probe
 *   `getComputedStyle(el, '::before')` and declare generated content out of scope",
 *   and the clone materialises that content, so the probe is gone. What the clone
 *   cannot materialise (`::marker`, `::first-line`) is declared unconditionally —
 *   see `findUnrepresentedPseudos`
 * @property {string|((el: Element) => boolean)|Array<string|((el: Element) => boolean)>} [exclude]
 * @property {number} [maxDiagnosticsPerCode=100]
 */

function makeState (rootEl, ctx) {
  const styles = new WeakMap()
  const styleOf = ctx.styleOf || ((el) => {
    let cs = styles.get(el)
    if (!cs) {
      cs = getComputedStyle(el)
      styles.set(el, cs)
    }
    return cs
  })
  const exclude = []
  for (const rule of [].concat(ctx.exclude || [])) {
    if (typeof rule === 'string' || typeof rule === 'function') exclude.push(rule)
  }
  return {
    rootEl,
    styleOf,
    exclude,
    maxNodes: Number.isFinite(ctx.maxNodes) ? ctx.maxNodes : 20000,
    maxDepth: Number.isFinite(ctx.maxDepth) ? ctx.maxDepth : 256,
    maxPerCode: Number.isFinite(ctx.maxDiagnosticsPerCode) ? ctx.maxDiagnosticsPerCode : 100,
    diagnostics: [],
    diagCount: new Map(),
    suppressed: new Map(),
    count: 0,
    truncated: false,
    rootOrigin: { x: 0, y: 0 },
    rootLayout: null,
  }
}

/** Is `child` part of `el`'s own inline formatting context? */
function joinsInlineContext (child, st) {
  if (isExcluded(child, st.exclude)) return false
  const tag = child.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag) || OPAQUE_TAGS.has(tag)) return false
  const cs = st.styleOf(child)
  if (!cs || cs.display === 'none' || !joinsParentText(cs.display)) return false
  if (cs.position === 'absolute' || cs.position === 'fixed') return false
  return floatOf(cs) === 'none'
}

/**
 * Does this element carry text in its OWN inline formatting context? The walk
 * follows in-flow inline descendants only: a block-level child starts a context
 * of its own and `collectText` runs per block, so descending into it here would
 * put the same characters in two nodes.
 */
function hasOwnText (el, st) {
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      if (/\S/.test(child.data)) return true
      continue
    }
    if (child.nodeType !== 1) continue
    if (joinsInlineContext(child, st) && hasOwnText(child, st)) return true
  }
  return false
}

/** The same text, concatenated, for the layer name. Stops once it has enough. */
function ownText (el, st, out = []) {
  for (const child of el.childNodes) {
    if (out.length > 40) break
    if (child.nodeType === 3) out.push(child.data)
    else if (child.nodeType === 1 && joinsInlineContext(child, st)) ownText(child, st, out)
  }
  return out.join('')
}

/** An in-flow block-level child next to loose text means anonymous block boxes. */
function hasInFlowBlockChild (el, st) {
  for (const child of el.children) {
    const tag = child.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) continue
    const cs = st.styleOf(child)
    if (!cs || cs.display === 'none' || isInlineLevel(cs.display)) continue
    if (cs.position === 'absolute' || cs.position === 'fixed') continue
    if (floatOf(cs) !== 'none') continue
    return true
  }
  return false
}

/**
 * The properties a `::first-letter` / `::first-line` rule is worth reporting for.
 * Anything that changes the SIZE or the ADVANCE of the glyphs, because that is
 * what makes the emitted text visibly wrong rather than merely off-colour.
 */
const FIRST_PSEUDO_PROPS = [
  'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'fontVariant',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'float', 'color',
]

/**
 * The pseudo-elements the clone does **not** materialise, and that the browser
 * therefore keeps rendering natively — inside the clone as much as it did on the
 * page, which means they paint and we cannot collect them.
 *
 * `::before`/`::after`/`::first-letter` are deliberately NOT here: `pseudo.js` turns
 * them into real `<span data-snapdom-pseudo>` elements with a measurable box, they
 * come in through the ordinary walk, and declaring them lost after that would be a
 * lie. What is left is the two kinds that have no element to become:
 *
 *  - `::marker` — a list item's marker is painted by the UA from `list-style-*`, and
 *    snapdom ships authored marker rules as a scoped `[data-sd-pN]::marker{}` rule
 *    precisely so the browser re-renders it. There is no box in the tree for it.
 *  - `::first-line` — generates no content at all; it RESTYLES glyphs that we do
 *    collect, at the element's own style instead of the pseudo's, so the characters
 *    are present with the wrong size, weight and advance.
 *
 * A pseudo that no rule targets returns the element's own values in Chromium, so any
 * difference in `FIRST_PSEUDO_PROPS` is a rule that hit. The probe runs against the
 * clone, where snapdom's scoped rule is in force, so it sees what actually renders.
 *
 * **Not gated on `ctx.pseudo`.** That flag meant "probe generated content and declare
 * it out of scope", and there is no such probe left — the orchestrator turns it off
 * for exactly that reason. Reusing it here would take a switch that exists to silence
 * a false report and use it to silence a true one. The gate is `textCarrier` instead,
 * which is also the honest one: both pseudos only exist where there is an inline
 * formatting context, so nothing else pays for the two `getComputedStyle` calls.
 */
function findUnrepresentedPseudos (el, cs, textCarrier, st) {
  const out = []
  if (/list-item/.test(cs.display || '') &&
      (cs.listStyleType !== 'none' || isSet(cs.listStyleImage)) &&
      !(st && st.markerSynthesized && st.markerSynthesized.has(el))) {
    // `::marker { content: none }` paints nothing, so there is nothing to
    // declare — reporting it would be a loss that never happened.
    let suppressed = false
    try {
      suppressed = typeof getComputedStyle === 'function' &&
        markerContentOf(getComputedStyle(el, '::marker')) === 'none'
    } catch { /* no pseudo style available: report as before */ }
    if (!suppressed) {
      const why = st && st.markerRejected ? st.markerRejected.get(el) : null
      out.push({ sel: '::marker', content: cs.listStyleType, why })
    }
  }
  if (!textCarrier || typeof getComputedStyle !== 'function') return out
  // `::first-letter` only when the clone did not already materialise it: when it did,
  // the span is a node of its own with its own styles and there is nothing to declare.
  const selectors = el.querySelector(`:scope > [${PSEUDO_ATTR}="::first-letter"]`)
    ? ['::first-line']
    : ['::first-letter', '::first-line']
  for (const sel of selectors) {
    let pseudoCs
    try {
      pseudoCs = getComputedStyle(el, sel)
    } catch {
      break
    }
    if (!pseudoCs) continue
    const changed = FIRST_PSEUDO_PROPS.filter((prop) => pseudoCs[prop] !== cs[prop])
    if (!changed.length) continue
    out.push({ sel, content: changed.map((prop) => `${prop}: ${pseudoCs[prop]}`).join('; '), styleOnly: true })
  }
  return out
}

/**
 * Untransformed border box in root space.
 *
 * With no transform between the capture root and `el` the painted rect IS the
 * layout box, and it is the only source with sub-pixel precision, so it wins.
 * Under a transform it is the bbox of a transformed quad — unusable — and the
 * offset chain answers instead, at integer precision, which is recorded.
 */
function measure (el, cs, st, frameCtx, node) {
  const chainTransformed = frameCtx.transformed || hasTransform(cs)
  if (!chainTransformed) {
    const r = rectOf(el)
    return { x: r.x - st.rootOrigin.x, y: r.y - st.rootOrigin.y, w: r.w, h: r.h }
  }
  if (el.namespaceURI === MATH_NS && el.localName === 'math') {
    const { box, root } = mathLayoutBox(el, st.rootEl)
    return { x: box.x - root.x, y: box.y - root.y, w: box.w, h: box.h }
  }
  const lb = st.rootLayout && layoutBox(el)
  if (lb) {
    pushDiag(st, {
      code: 'B4.geometry-from-layout',
      severity: 'info',
      _node: node,
      note: 'a transform on this element or an ancestor makes getBoundingClientRect ' +
        'report a transformed bbox; the box comes from the integer-rounded layout ' +
        'offset chain instead, so it can be up to 0.5px off per axis',
    })
    if (node) degrade(node, 'A', 'geometry rounded to integers')
    return {
      x: lb.x - st.rootLayout.x - frameCtx.scrollX,
      y: lb.y - st.rootLayout.y - frameCtx.scrollY,
      w: lb.w,
      h: lb.h,
    }
  }
  const r = rectOf(el)
  pushDiag(st, {
    code: 'B4.geometry-transformed',
    severity: 'warn',
    _node: node,
    note: 'element has no layout offset box (SVG or detached); geometry is the ' +
      'post-transform bounding box, so its own transform is applied twice by any ' +
      'backend that also honours `transform`',
  })
  if (node) degrade(node, 'A', 'geometry measured post-transform')
  return { x: r.x - st.rootOrigin.x, y: r.y - st.rootOrigin.y, w: r.w, h: r.h }
}

function readTransform (el, cs, box, node, st) {
  if (!hasTransform(cs)) return null
  // The individual properties are separate computed values and apply BEFORE
  // `transform`, in the order translate, rotate, scale. Handing the whole list to
  // one parser keeps a single origin convention instead of two.
  const parts = []
  if (isSet(cs.translate)) parts.push(`translate(${cs.translate.trim().split(/\s+/).slice(0, 2).join(', ')})`)
  if (isSet(cs.rotate)) parts.push(`rotate(${cs.rotate.trim().split(/\s+/).pop()})`)
  if (isSet(cs.scale)) parts.push(`scale(${cs.scale.trim().split(/\s+/).slice(0, 2).join(', ')})`)
  if (isSet(cs.transform)) parts.push(cs.transform)
  if (isSet(cs.offsetPath)) {
    pushDiag(st, {
      code: 'B4.offset-path',
      severity: 'warn',
      _node: node,
      note: 'motion-path placement (offset-path/offset-distance) is not modelled; ' +
        'the box is taken from layout, which is where the element would sit at distance 0',
    })
    degrade(node, 'A', 'offset-path ignored')
  }
  if (!parts.length) return null

  const parsed = parseTransform(parts.join(' '), cs.transformOrigin, box.w, box.h)
  if (!parsed) {
    pushDiag(st, {
      code: 'B4.transform-unreadable',
      severity: 'warn',
      _node: node,
      css: parts.join(' '),
      note: 'no transform function could be read; the node is emitted untransformed',
    })
    degrade(node, 'A', 'transform dropped')
    return null
  }
  if (parsed.is3d) {
    pushDiag(st, {
      code: 'B4.transform-3d',
      severity: 'warn',
      _node: node,
      css: parts.join(' '),
      note: 'a 3D transform was flattened to its 2D projection',
    })
    degrade(node, 'A', '3D transform flattened')
  }
  for (const note of parsed.notes || []) {
    pushDiag(st, { code: 'B4.transform-partial', severity: 'warn', _node: node, note })
    degrade(node, 'A', note)
  }
  return { m: parsed.m, decomposed: parsed.decomposed }
}

function makeNode (fields) {
  return {
    type: fields.type,
    name: fields.name,
    frame: { x: 0, y: 0, w: 0, h: 0 },
    abs: { x: 0, y: 0, w: 0, h: 0 },
    paint: { z: 0, stackingContext: false },
    transform: null,
    opacity: 1,
    blend: 'normal',
    clip: null,
    fills: [],
    strokes: [],
    effects: [],
    text: null,
    fidelity: { grade: 'E', notes: [] },
    source: fields.source,
    children: [],
  }
}

/**
 * One DOM element -> at most one emitted entry.
 *
 * Returns `{node, cs, el, sc}` where `node` is the emitted node and `cs`/`el`/`sc`
 * describe the OUTERMOST element of the flattened chain — a pass-through wrapper
 * hands its own ordering properties up with its child's node, so a
 * `position:absolute; z-index:5` div that emits nothing still places the box it
 * wraps. `null` when the subtree paints nothing.
 */
function walk (el, st, frameCtx) {
  const tag = el.tagName ? el.tagName.toUpperCase() : ''
  if (!tag || SKIP_TAGS.has(tag)) return null
  if (isExcluded(el, st.exclude)) return null
  if (frameCtx.depth > st.maxDepth) return null

  const cs = st.styleOf(el)
  if (!cs || cs.display === 'none') return null

  const isRoot = el === st.rootEl
  const visible = cs.visibility === 'visible'
  const contents = cs.display === 'contents'
  const pseudo = isRoot ? null : pseudoSelectorOf(el)
  const segment = pathSegment(el, tag.toLowerCase(), pseudo)
  // A pseudo hangs off its originating element's selector, not below it as a child.
  const path = isRoot ? segment : (pseudo ? `${frameCtx.path}${segment}` : `${frameCtx.path} > ${segment}`)

  // Artifacts of the clone: nodes snapdom added that the page never had. Each one
  // leaves under its own diagnostic code — a node that vanishes without a reason is
  // the failure mode this engine exists to avoid.
  const artifact = isRoot ? null : cloneArtifactOf(el)
  if (artifact === 'exclusion-spacer') {
    pushDiag(st, {
      code: 'B4.clone-exclusion-spacer',
      severity: 'info',
      path,
      note: 'snapdom replaced an excluded element with an invisible layout spacer ' +
        '(excludeMode:"hide"): it reserves the space the element took and paints ' +
        'nothing at all, so it is pruned rather than emitted as an empty node',
    })
    return null
  }
  if (artifact === 'defs-container') {
    pushDiag(st, {
      code: 'B4.clone-defs-container',
      severity: 'info',
      path,
      note: 'snapdom hoisted the <defs> that the captured SVGs reference from outside the ' +
        'subtree into a zero-sized <svg class="inline-defs-container">. It is a lookup table ' +
        'and paints nothing; `collect/image.js` reads it when it resolves an SVG\'s ' +
        '`url(#…)` references, so the node is pruned and nothing it holds is lost',
    })
    return null
  }

  const sc = isRoot ? true : isStackingContext(el, cs, frameCtx.parentCs)
  const own = hasTransform(cs)
  const childCtx = {
    path,
    depth: frameCtx.depth + 1,
    transformed: frameCtx.transformed || own,
    parentCs: cs,
    scrollX: frameCtx.scrollX + (el.scrollLeft || 0),
    scrollY: frameCtx.scrollY + (el.scrollTop || 0),
    inText: false,
  }

  const opaque = OPAQUE_TAGS.has(tag)
  const isImage = IMAGE_TAGS.has(tag) || (tag === 'INPUT' && el.getAttribute('type') === 'image')
  const isSvg = tag === 'SVG'
  const isMath = tag === 'MATH' && el.namespaceURI === MATH_NS
  const textCarrier = !frameCtx.inText && visible && !contents && !opaque && hasOwnText(el, st)
  const inText = frameCtx.inText || textCarrier

  // A form control paints something no CSS property announces: the UA draws the
  // value, the placeholder, the tick, the chevron, the track and the thumb, and
  // `appearance: none` only takes away the widget half. A checkbox with no
  // background, no border and no text failed every term above and was pruned
  // before `collect/box.js` could say it existed — 7 of the 11 controls in
  // `demo/challenges.html#fx-form` (3 checkboxes, 3 radios, the `<progress>`)
  // vanished with no node and therefore no diagnostic. Being a control IS paint.
  const isControl = CONTROL_TAGS.has(tag)
  const paints = visible && !contents && (paintsBox(cs) || isImage || isSvg || isMath || textCarrier || isControl)
  // The marker and first-line cases paint on the page and have no box in the tree,
  // so both have to be seen before the pruner decides — a node that says "something
  // was here" is the point, and it needs a box to say it in.
  const pseudos = contents || !visible ? [] : findUnrepresentedPseudos(el, cs, textCarrier, st)
  // A husk is empty and invisible by construction, so nothing below would keep it;
  // it is emitted anyway because the content it stands for is real, and its box is
  // the crop the clip window made.
  const forced = artifact === 'clip-husk'
  // The clone has no shadow trees left — `deepClone` flattens them and rewrites their
  // CSS to prefixed classes. One here means we were handed a live element instead,
  // UNLESS the adapter put it there: connecting the clone upgrades its custom
  // elements and the browser attaches a root we then empty, which is a repaired
  // node and not a live one.
  const defusedShadow = !!(el.shadowRoot && el.hasAttribute && el.hasAttribute(DEFUSED_SHADOW_ATTR))
  const liveShadow = !!el.shadowRoot && !defusedShadow

  // Poda por pintura visible. An element with nothing to paint and no emitted
  // descendant is not a node, whatever its CSS says — this is where the node
  // ratio is won.
  const kids = []
  if (!opaque && !isSvg) {
    for (const child of el.children) {
      const childCs = st.styleOf(child)
      // Only the in-flow inline part of the subtree belongs to this block's
      // inline formatting context. A block-level or out-of-flow child starts one
      // of its own, so it is a text carrier in its own right — without this the
      // text of every block inside a mixed-content box would silently vanish.
      childCtx.inText = inText && !!childCs && joinsParentText(childCs.display) &&
        childCs.position !== 'absolute' && childCs.position !== 'fixed' &&
        floatOf(childCs) === 'none'
      const entry = walk(child, st, childCtx)
      if (entry) kids.push(entry)
    }
  }
  if (!paints && !kids.length && !isRoot && !forced && !liveShadow && !pseudos.length) return null

  const needsOwnLayer = !contents && (forcesGroup(cs) || clipsContent(cs) || own)
  const emits = isRoot || paints || needsOwnLayer || forced || liveShadow ||
    pseudos.length > 0 || kids.length >= 2

  if (!emits) {
    // Pass-through: at most one emitted child, so the wrapper adds nothing but a
    // level. Its ordering properties travel up with the child it wraps.
    if (!kids.length) return null
    return { node: kids[0].node, cs, el, sc }
  }

  if (!isRoot && st.count >= st.maxNodes) {
    if (!st.truncated) {
      st.truncated = true
      pushDiag(st, {
        code: 'B4.max-nodes',
        severity: 'error',
        limit: st.maxNodes,
        note: 'node ceiling reached; the rest of the subtree is not in the document',
      })
    }
    return kids.length ? { node: kids[0].node, cs, el, sc } : null
  }
  st.count++

  // The text of the block is a child, never the box itself: a `text` node's
  // `fills` are the glyph fills in every backend, so a background that landed
  // there would paint the letters instead of the box.
  const wantsTextChild = textCarrier && (kids.length > 0 || paintsBox(cs) || forcesGroup(cs) || clipsContent(cs))
  const asText = textCarrier && !wantsTextChild

  let type
  if (isSvg || isMath) type = 'vector'
  else if (isImage) type = 'image'
  else if (asText) type = 'text'
  else if (kids.length || wantsTextChild) type = paintsBox(cs) || clipsContent(cs) ? 'frame' : 'group'
  else type = paints ? 'shape' : 'frame'

  const source = { tag: tag.toLowerCase(), path, css: sourceCss(cs) }
  // Provenance the clone knows and the page does not. A consumer reading `source`
  // must be able to tell a `::before` from a span and an artifact from an element
  // without re-deriving either from the name.
  if (pseudo) source.pseudo = pseudo
  if (artifact) source.clone = artifact
  if (el.hasAttribute && el.hasAttribute(SHADOW_SCOPE_ATTR)) source.shadowHost = true
  const node = makeNode({
    type,
    name: artifact === 'scroll-wrapper'
      ? 'scroll offset'
      : nodeName(el, tag.toLowerCase(), asText ? 'text' : type,
        asText || pseudo ? ownText(el, st) : '', pseudo),
    source,
  })
  node.abs = contents
    ? unionBoxes(kids.map(k => k.node.abs))
    : measure(el, cs, st, frameCtx, node)
  node.paint.stackingContext = sc
  node.opacity = Math.min(1, Math.max(0, opacityOf(cs)))
  node.blend = cs.mixBlendMode && cs.mixBlendMode !== '' ? cs.mixBlendMode : 'normal'
  node.transform = contents ? null : readTransform(el, cs, node.abs, node, st)

  Object.defineProperty(node, 'el', { value: el, writable: true, configurable: true, enumerable: false })
  Object.defineProperty(node, '_kids', { value: kids.map(k => k.node), writable: true, configurable: true, enumerable: false })
  Object.defineProperty(node, '_paints', { value: paints, writable: true, configurable: true, enumerable: false })

  for (const { sel, content, styleOnly, why } of pseudos) {
    pushDiag(st, {
      code: styleOnly ? 'B4.pseudo-style' : 'B4.list-marker',
      severity: 'warn',
      _node: node,
      pseudo: sel,
      content,
      note: styleOnly
        ? `${sel} restyles glyphs that ARE collected, at the element's own style instead of the ` +
          'pseudo\'s — the characters are present, their size, weight and advance are the wrong ones'
        : 'the list marker is painted by the UA from list-style-*, so the clone has no element for ' +
          'it and nothing to collect. It is rebuilt where the string can be reproduced from the ' +
          `page's own @counter-style rules or from the predefined ones, AND checked against the ` +
          `UA's own advance; here ${
            why || `"${content}" is a counter style this build does not reproduce (an ` +
              '`extends`/`additive` @counter-style, or one of the CJK, Ethiopic or disclosure ' +
              'systems), or the item is not an LTR `list-style-position: outside` one'
          }, so the item is emitted without its marker`,
    })
    degrade(node, styleOnly ? 'O' : 'A', `${sel} omitted`)
  }
  if (st.markerSynthesized && st.markerSynthesized.has(el)) {
    pushDiag(st, {
      code: 'B4.list-marker-synthesized',
      severity: 'info',
      _node: node,
      pseudo: '::marker',
      content: el.getAttribute('data-snapdom-vector-marker-host'),
      kind: el.getAttribute('data-snapdom-vector-marker-shape') ? 'symbol' : 'text',
      note: el.getAttribute('data-snapdom-vector-marker-shape')
        ? `the UA paints this ${el.getAttribute('data-snapdom-vector-marker-shape')} bullet as a SHAPE ` +
          'and not as a glyph — measured across three font families and twelve sizes, its ink is the ' +
          'same width in all of them, so it is not the font\'s bullet and cannot be rebuilt as text ' +
          '(the string would land ~7px right of the bullet at 14px). It is rebuilt as a real shape ' +
          'instead, at the diameter (0.3 x the marker font-size), the gap to the item\'s content edge ' +
          '(0.3 x font-size + 6.7px) and the rise above the first baseline (0.29 x font-size) that ' +
          'Chromium was measured to use, each fitted over 10..40px with a worst residual under 1px, ' +
          'and then checked to land inside the marker box this engine itself reports. That is a LAW ' +
          'rather than a measurement of this marker: another engine draws the bullet somewhere else'
        : 'the UA paints this list marker natively and the clone has no element for it, so one ' +
          `was rebuilt: the string from ${el.hasAttribute('data-snapdom-vector-marker-authored')
            ? 'the ::marker\'s own `content`, resolved against the counters in scope'
            : '`list-style-type` and the page\'s @counter-style rule'}, the ` +
          'paint from `getComputedStyle(li, "::marker")`, the box right-aligned to the item\'s ' +
          'content edge on its first baseline. The string was checked against the advance the UA ' +
          'itself reports and the box against its own measured position, so this is a ' +
          'reconstruction that agreed with the browser, not a guess — but it is a reconstruction' +
          (el.getAttribute('data-snapdom-vector-marker-overruled')
            ? `. The check DISAGREED here (${el.getAttribute('data-snapdom-vector-marker-overruled')}px, ours ` +
              'over the clone\'s) and was overruled on purpose: this marker prints a counters() stack, ' +
              'and the clone is mounted beside the document it was cloned from, so Chromium\'s ' +
              'sibling-carry leaks the page\'s own list-item counters into it and its marker renders one ' +
              'level too deep. The string above is the css-lists-3 resolution taken from the tree, which ' +
              'is what the page paints'
            : ''),
    })
    degrade(node, 'A', el.getAttribute('data-snapdom-vector-marker-shape')
      ? `::marker rebuilt as a ${el.getAttribute('data-snapdom-vector-marker-shape')} shape at Chromium's measured proportions`
      : '::marker rebuilt from list-style-* rather than captured')
  }
  if (artifact === 'clip-husk') {
    pushDiag(st, {
      code: 'B4.clone-clip-husk',
      severity: 'warn',
      _node: node,
      note: 'snapdom culled this subtree before we saw it: it painted entirely outside ' +
        "the capture's clip window, and what reached the clone is a frozen empty " +
        'stand-in. The box IS the crop the clip made and is emitted as such; the ' +
        'content behind it was never cloned and cannot be recovered here',
    })
    degrade(node, 'O', 'subtree culled outside the clip window')
  }
  if (artifact === 'scroll-wrapper') {
    pushDiag(st, {
      code: 'B4.clone-scroll-wrapper',
      severity: 'info',
      _node: node,
      note: "snapdom's scroll compensation, not an element of the page: it carries the " +
        'translate that puts a scrolled container back where it was seen. The layer is ' +
        'kept because every child is positioned by it',
    })
  }
  if (liveShadow) {
    pushDiag(st, {
      code: 'B4.unresolved-shadow-root',
      severity: 'error',
      _node: node,
      note: 'this element has a shadowRoot that nothing accounted for. A clone never ' +
        'inherits one (`cloneNode` does not copy shadow trees) and the adapter marks the ' +
        'ones it provokes by mounting, so this is either a live tree reaching `buildPaintTree` ' +
        'instead of the clone, or a `closed` shadow root the adapter could not reach to ' +
        'repair. The host is emitted, its shadow tree is not',
    })
    degrade(node, 'O', 'shadow tree omitted (walked a live tree, not the clone)')
  }
  if (defusedShadow) {
    pushDiag(st, {
      code: 'B4.upgraded-custom-element',
      severity: 'info',
      _node: node,
      note: 'this is a custom element, and connecting the clone made the browser upgrade it: ' +
        'its `connectedCallback` attached a new shadow root over the tree snapdom had already ' +
        'flattened. The adapter emptied that root back to a bare `<slot>`, which renders the ' +
        'flattened content unchanged — measured at 0.00px against the live element. What it ' +
        'cannot undo is a `connectedCallback` that rewrites its own light DOM, or a `closed` ' +
        'shadow root, which is not reachable from script at all',
    })
  }
  // The pseudo whose number is wrong is usually NOT a node of its own: its text
  // is inline and folds into the block's text node, which is the node that ends
  // up carrying the wrong characters and therefore the node to degrade.
  if (pseudo === '::before' || pseudo === '::after') reportCounterDrift(el, pseudo, node, st)
  for (const child of el.children || []) {
    const sel = pseudoSelectorOf(child)
    if (sel === '::before' || sel === '::after') reportCounterDrift(child, sel, node, st)
  }
  if (isSvg) {
    pushDiag(st, {
      code: 'B4.inline-svg',
      severity: 'info',
      _node: node,
      note: 'the subtree of an inline <svg> is not walked: it has no CSS box tree of its own, ' +
        'so `collect/image.js` serializes it whole, namespaces its ids per instance and ' +
        'resolves every `url(#…)` to the definition the DOCUMENT resolved it to. It travels ' +
        'as passthrough markup on this node, which is why the node is `vector` and not `image`. ' +
        'This is not a degradation and is not graded here — if the markup does not reach the ' +
        'backend, the backend says so (`emit.svg.vector-no-markup`, grade O)',
    })
  }
  if (RASTER_ONLY_TAGS.has(tag)) {
    pushDiag(st, {
      code: 'B4.raster-only',
      severity: 'info',
      _node: node,
      tag: tag.toLowerCase(),
      note: 'replaced content with no vector form; the collector must rasterize it',
    })
  }
  if (CONTROL_TAGS.has(tag)) {
    let widget = null
    try {
      widget = describeWidget(el, cs)
    } catch (error) {
      pushDiag(st, {
        code: 'B4.form-control',
        severity: 'warn',
        _node: node,
        tag: tag.toLowerCase(),
        note: `reading this control's widget threw (${error && error.message}); it is emitted as an ` +
          'empty box',
      })
    }
    if (widget) node.control = widget
    pushDiag(st, {
      code: 'B4.form-control',
      severity: 'warn',
      _node: node,
      tag: tag.toLowerCase(),
      widget: widget ? widget.kind : null,
      note: widget
        ? `a form control paints a widget no CSS property describes, so this one is REBUILT from what ` +
          `the element does declare: a ${widget.kind}, its state, and ` +
          `${widget.accentSource === 'accent-color' ? 'its own accent-color' : 'the UA accent this build measured'}. ` +
          'The box, its background and its border are exact and come from CSS; the shapes inside it ' +
          '(the tick, the dot, the chevron, the track, the thumb) are shapes THIS ENGINE drew to ' +
          'Chromium\'s measured proportions, not the widget the platform paints — a different browser, ' +
          'a different platform theme or a different Chromium version draws it differently, and the ' +
          'text a control paints (a value, a placeholder, an option label) is still not drawn. Read ' +
          '`collect.box.form-control` on this node for what the UA paints; the half of it that says ' +
          '"this engine has no primitive for that" is out of date for the shapes named here'
        : 'a form control paints a widget no CSS property describes and this one is not rebuilt (' +
          ((cs.appearance || cs.webkitAppearance || 'auto') === 'none'
            ? 'appearance:none — the author replaced the widget in CSS, which the ordinary ' +
              'collectors already read'
            : 'its widget is text or a button — a value, a placeholder, an option label, a file ' +
              'picker, a date picker or a list — and this build draws shapes, not UA text') +
          '). The box, its background and its border are exact; read `collect.box.form-control` ' +
          'on this node for what the UA draws inside it',
    })
    degrade(node, 'A', widget
      ? `${widget.kind} widget reconstructed, not captured`
      : 'control widget declared, not drawn')
  }
  const mixed = textCarrier && hasInFlowBlockChild(el, st)
  if (mixed) {
    pushDiag(st, {
      code: 'B4.anonymous-block',
      severity: 'warn',
      _node: node,
      note: 'text and block-level children share this box, so the browser wrapped the ' +
        'text in anonymous block boxes. One text node stands for all of them, placed ' +
        'before the block children, and `collectText` MUST NOT descend into those ' +
        'children or their characters land in two nodes',
    })
    degrade(node, 'A', 'anonymous block boxes merged into one text node')
  }

  // Ordering: text runs paint above the inline decorations they sit on and below
  // anything positioned, which is exactly where an in-flow inline box lands. Where
  // the text is really a set of anonymous BLOCK boxes it takes the block lane
  // instead, ahead of the siblings it was interleaved with — usually right, always
  // closer than painting it over all of them.
  const descriptors = kids.map(k => ({ cs: k.cs, el: k.el, stackingContext: k.sc }))
  let textIndex = -1
  if (wantsTextChild) {
    const descriptor = mixed
      ? { position: 'static', float: 'none', display: 'block', zIndex: 'auto', stackingContext: false }
      : { position: 'static', float: 'none', display: 'inline', zIndex: 'auto', stackingContext: false }
    textIndex = mixed ? 0 : descriptors.length
    descriptors.splice(textIndex, 0, descriptor)
  }
  const ranks = paintOrder(descriptors)
  for (let i = 0; i < kids.length; i++) {
    kids[i].node.paint.z = ranks[i < textIndex || textIndex === -1 ? i : i + 1]
  }

  if (wantsTextChild) {
    const textNode = makeNode({
      type: 'text',
      name: nodeName(el, tag.toLowerCase(), 'text', ownText(el, st), pseudo),
      source: pseudo
        ? { tag: tag.toLowerCase(), path: `${path}::text`, css: {}, pseudo }
        : { tag: tag.toLowerCase(), path: `${path}::text`, css: {} },
    })
    textNode.abs = { ...node.abs }
    textNode.paint.z = ranks[textIndex]
    Object.defineProperty(textNode, 'el', { value: el, writable: true, configurable: true, enumerable: false })
    Object.defineProperty(textNode, '_kids', { value: [], writable: true, configurable: true, enumerable: false })
    Object.defineProperty(textNode, '_paints', { value: true, writable: true, configurable: true, enumerable: false })
    node._kids.push(textNode)
    st.count++
  }

  // Promotion candidates, evaluated once the whole tree and its paint order exist.
  const z = zIndexOf(cs)
  let promoteAs = null
  if (isRoot) promoteAs = null
  else if (z !== null && z < 0 && (cs.position !== 'static' || isFlexOrGridItem(el, frameCtx.parentCs))) {
    promoteAs = { kind: 'negative-z', z }
  } else if (isTopLayer(el)) promoteAs = { kind: 'top-layer' }
  else if (cs.position === 'fixed') promoteAs = { kind: 'fixed' }
  else if (cs.position === 'absolute') promoteAs = { kind: 'absolute' }
  const hide = (key, value) => Object.defineProperty(node, key, { value, writable: true, configurable: true, enumerable: false })
  if (promoteAs) hide('_promote', promoteAs)
  hide('_clips', !contents && clipsContent(cs))
  hide('_fixedCB', isRoot || isFixedContainingBlock(cs))
  hide('_absCB', isRoot || cs.position !== 'static' || isFixedContainingBlock(cs))

  return { node, cs, el, sc }
}

/** Modal dialogs, open popovers and the fullscreen element paint above everything. */
function isTopLayer (el) {
  if (typeof el.matches !== 'function') return false
  try {
    if (el.matches(':modal')) return true
  } catch {
    if (el.tagName === 'DIALOG' && el.hasAttribute('open')) return true
  }
  try {
    if (el.matches(':popover-open')) return true
  } catch { /* older engine: no popover API, so no top layer entry either */ }
  const doc = el.ownerDocument
  return !!doc && doc.fullscreenElement === el
}

// ——— assembly, promotion, frames ———

function assignIds (rootNode, st) {
  const nodes = {}
  const parentOf = new Map()
  let seq = 0
  const visit = (node, parentId) => {
    const id = `n_${seq++}`
    Object.defineProperty(node, 'id', { value: id, writable: true, configurable: true, enumerable: false })
    nodes[id] = node
    if (parentId !== null) parentOf.set(id, parentId)
    for (const kid of node._kids) visit(kid, id)
    node.children = node._kids.map(k => k.id)
    return id
  }
  const rootId = visit(rootNode, null)
  st.nodes = nodes
  st.parentOf = parentOf
  return rootId
}

/** Back-to-front order of the whole document: a node paints before its children. */
function flattenOrder (rootId, nodes) {
  const order = []
  const visit = (id) => {
    order.push(id)
    const kids = nodes[id].children.slice().sort((a, b) => nodes[a].paint.z - nodes[b].paint.z)
    for (const kid of kids) visit(kid)
  }
  visit(rootId)
  return order
}

function subtreeIds (id, nodes, out = new Set()) {
  out.add(id)
  for (const kid of nodes[id].children) subtreeIds(kid, nodes, out)
  return out
}

function ancestorsOf (id, st) {
  const out = []
  let cur = st.parentOf.get(id)
  while (cur !== undefined) {
    out.push(cur)
    cur = st.parentOf.get(cur)
  }
  return out
}

/**
 * Ancestors between the node and its containing block that clip, and whose box
 * does not cover it. The node escapes those clips per CSS — the clip only applies
 * to boxes whose containing block is the clipper or inside it — but a tree that
 * keeps it there would have the backend clip it anyway, and clip it away entirely
 * in the usual case where it sits somewhere else on the page.
 */
function clipEscapes (id, parentId, targetId, st) {
  const box = st.nodes[id].abs
  const out = []
  let cur = parentId
  while (cur !== undefined && cur !== targetId) {
    const ancestor = st.nodes[cur]
    if (ancestor._clips && !containsBox(ancestor.abs, box)) out.push(cur)
    cur = st.parentOf.get(cur)
  }
  return out
}

/**
 * Reparenting, with the two-part test from D3. Condition (a) is structural — the
 * order cannot be had by reordering siblings within the parent — and is what
 * `targetId` computes; condition (b) is geometric, and is either a clip the node
 * escapes or an overlap with a box whose relative order would change. Both must
 * hold, so a `z-index:-1` decoration that overlaps nothing keeps its place in the
 * tree. That is the common case, and the reason most containers survive intact.
 *
 * Every candidate is tested against the pre-promotion order: promotions are rare
 * and independent in practice, and re-flattening after each one would make the
 * result depend on the order candidates happen to be visited in.
 */
function promote (rootId, st) {
  const { nodes } = st
  const candidates = Object.keys(nodes).filter(id => nodes[id]._promote)
  if (!candidates.length) return

  const order = flattenOrder(rootId, nodes)
  const index = new Map(order.map((id, i) => [id, i]))

  for (const id of candidates) {
    const node = nodes[id]
    const parentId = st.parentOf.get(id)
    if (parentId === undefined) continue
    const { kind } = node._promote

    // (a) where would the correct order — or the correct containing block — put it?
    let targetId = null
    let backwards = false
    let reason = ''
    if (kind === 'negative-z') {
      // A negative z-index paints in front of its stacking context's background
      // and behind everything else in it. Inside a parent that IS that context
      // this is just "first sibling"; otherwise it has to clear the parent's own
      // background, which no sibling order expresses.
      targetId = ancestorsOf(id, st).find(a => nodes[a].paint.stackingContext) || rootId
      backwards = true
      reason = `z-index:${node._promote.z} must paint behind the background of an ancestor that is not a stacking context`
    } else if (kind === 'fixed') {
      targetId = ancestorsOf(id, st).find(a => nodes[a]._fixedCB) || rootId
      reason = 'position:fixed — the containing block is an ancestor, so the clips and the paint order in between do not apply'
    } else if (kind === 'absolute') {
      targetId = ancestorsOf(id, st).find(a => nodes[a]._absCB) || rootId
      reason = 'position:absolute — its containing block is above an ancestor that clips, so that clip does not apply to it'
    } else {
      targetId = rootId
      reason = 'top layer (modal dialog, open popover or fullscreen element) paints above the whole document'
    }
    if (!targetId || targetId === parentId || targetId === id) continue

    // (b) is the divergence observable? An escaped clip is the cheap answer and the
    // decisive one — left in place the node would be cropped, usually to nothing.
    let hits = clipEscapes(id, parentId, targetId, st)
    const escaped = hits.length > 0
    if (escaped) {
      reason += `; its box is not inside the clip of ${hits.join(', ')}`
    } else if (kind !== 'absolute') {
      // Otherwise it comes down to paint order, which is only observable against
      // boxes that paint and that this one overlaps.
      const scope = subtreeIds(targetId, nodes)
      const mine = subtreeIds(id, nodes)
      const myIndex = index.get(id)
      hits = []
      for (const other of scope) {
        if (other === targetId || mine.has(other)) continue
        const otherNode = nodes[other]
        if (!otherNode._paints) continue
        const before = index.get(other) < myIndex
        if (backwards ? !before : before) continue
        if (!overlaps(node.abs, otherNode.abs)) continue
        hits.push(other)
        if (hits.length >= 16) break
      }
    }
    if (!hits.length) continue

    const siblings = nodes[targetId].children
    const zs = siblings.map(s => nodes[s].paint.z)
    // Escaping a clip is a change of containing block, not of paint order, so the
    // node lands immediately after the branch it came out of. Everything else moved
    // because of paint order, and goes to the end (or the start) of the target.
    let branch = escaped && kind !== 'top-layer' ? id : null
    for (let guard = 0; branch && st.parentOf.get(branch) !== targetId && guard < 4096; guard++) {
      branch = st.parentOf.get(branch)
    }
    if (backwards) {
      node.paint.z = Math.min(0, ...zs) - 1
    } else if (branch && nodes[branch]) {
      const at = nodes[branch].paint.z
      for (const sibling of siblings) if (nodes[sibling].paint.z > at) nodes[sibling].paint.z++
      node.paint.z = at + 1
    } else {
      node.paint.z = Math.max(0, ...zs) + 1
    }

    const from = nodes[parentId].children
    from.splice(from.indexOf(id), 1)
    siblings.push(id)
    st.parentOf.set(id, targetId)

    // `overlaps` is the geometric evidence for a paint-order move; a clip escape
    // has different evidence and says so under its own key rather than pretending
    // the clippers are boxes this one overlaps.
    const diag = { code: 'B4.promoted', severity: 'info', node: id, from: parentId, to: targetId, reason, overlaps: escaped ? [] : hits }
    if (escaped) diag.escapes = hits
    pushDiag(st, diag)
  }
}

/** `frame` is `abs` in the emitted parent's space; `abs` is what survives reparenting. */
function setFrames (rootId, st) {
  const { nodes } = st
  const visit = (id, origin) => {
    const node = nodes[id]
    node.frame = {
      x: node.abs.x - origin.x,
      y: node.abs.y - origin.y,
      w: node.abs.w,
      h: node.abs.h,
    }
    for (const kid of node.children) visit(kid, node.abs)
  }
  visit(rootId, { x: 0, y: 0 })
}

/**
 * Build the paint tree for `rootEl`.
 *
 * `rootEl` is **snapdom's clone, already mounted** — the tree the `vector()` plugin's
 * `beforeRender` hook takes out of a capture, attached to the light DOM with
 * `fontsCSS + classPrefixCSS` in the document. Every predicate here reads computed style, and in the clone the
 * paint lives in prefixed classes rather than inline styles, so an unmounted clone
 * computes to nothing and would prune to a single empty node. That is checked, not
 * assumed: this function refuses a detached root instead of returning an empty
 * document that looks like a page with nothing on it.
 *
 * Produces structure, geometry and paint order — nothing else. No collector runs
 * here: every node keeps its source element on a non-enumerable `el` and the
 * orchestrator fills the paint arrays from it, so this function stays cheap
 * enough to run before any decision about rasterizing has been made.
 *
 * @param {Element} rootEl the capture root; its border box is the origin of `abs`
 * @param {CollectCtx} [ctx]
 * @returns {{nodes: Record<string, Object>, rootId: string, diagnostics: Object[]}}
 */
export function buildPaintTree (rootEl, ctx = {}) {
  if (!rootEl || rootEl.nodeType !== 1) throw new Error('buildPaintTree: rootEl must be an Element')
  if (rootEl.isConnected === false) {
    throw new Error('buildPaintTree: rootEl is not in a document. The engine walks snapdom\'s ' +
      'clone, and a clone only has computed styles — and therefore only has paint, since the ' +
      'clone carries its paint in prefixed classes — once it is mounted. Attach it to the ' +
      'light DOM with fontsCSS + classPrefixCSS before calling.')
  }

  const st = makeState(rootEl, ctx)
  const rootCs = st.styleOf(rootEl)
  if (!rootCs) throw new Error('buildPaintTree: no computed style for rootEl (detached document?)')
  if (!rootCs.display) {
    throw new Error('buildPaintTree: rootEl computes to no style at all, so nothing in the tree ' +
      'would appear to paint. It is attached to a document that does not lay it out (a detached ' +
      'or inert one); mount the clone in the live document.')
  }
  if (typeof ShadowRoot === 'function' && typeof rootEl.getRootNode === 'function' &&
      rootEl.getRootNode() instanceof ShadowRoot) {
    pushDiag(st, {
      code: 'B4.clone-in-shadow-root',
      severity: 'warn',
      note: 'the clone is mounted inside a shadow root: Chromium ignores @font-face there, so ' +
        'every text box was laid out with a substituted font and every measurement taken from ' +
        'it is wrong. Mount it in the light DOM.',
    })
  }

  // Before anything is measured: the marker spans are out of flow and move
  // nothing, but the `list-style-position` probe they are checked with does, and
  // it must be over and reverted before a single box is read.
  try {
    synthesizeMarkers(rootEl, st)
  } catch (error) {
    pushDiag(st, {
      code: 'B4.list-marker',
      severity: 'warn',
      note: `rebuilding the native list markers threw (${error && error.message}); every list item ` +
        'in this capture is emitted without its marker',
    })
  }
  // Same reason, same place: a repaired counter is a different string and a
  // different advance, so it has to be in the clone before anything is measured.
  try {
    repairCounters(rootEl, st)
  } catch (error) {
    pushDiag(st, {
      code: 'B4.counter-misnumbered',
      severity: 'warn',
      note: `checking the materialised counters threw (${error && error.message}); the numbers in ` +
        'this capture are snapdom\'s and nothing here has confirmed them',
    })
  }

  const rootRect = rootEl.getBoundingClientRect()
  st.rootOrigin = { x: rootRect.left, y: rootRect.top }
  st.rootLayout = layoutBox(rootEl)
  if (!st.rootLayout && rootEl.namespaceURI === MATH_NS && hasTransform(rootCs)) {
    st.rootLayout = mathLayoutBox(rootEl, rootEl).box
  }

  const entry = walk(rootEl, st, {
    path: '',
    depth: 0,
    // The capture root's own transform is outside the space `abs` is expressed
    // in, but it still transforms every descendant's painted rect, so the chain
    // starts "transformed" and descendants take the layout path.
    transformed: hasTransform(rootCs),
    parentCs: rootEl.parentElement ? st.styleOf(rootEl.parentElement) : null,
    scrollX: 0,
    scrollY: 0,
    inText: false,
  })
  if (!entry) throw new Error('buildPaintTree: the capture root emitted no node')

  const rootNode = entry.node
  // The root's box is the origin by definition, whatever the chain above it does.
  rootNode.abs = {
    x: 0,
    y: 0,
    w: st.rootLayout && hasTransform(rootCs) ? st.rootLayout.w : rootRect.width,
    h: st.rootLayout && hasTransform(rootCs) ? st.rootLayout.h : rootRect.height,
  }
  rootNode.paint.z = 0
  rootNode.paint.stackingContext = true

  const rootId = assignIds(rootNode, st)
  promote(rootId, st)
  setFrames(rootId, st)

  // Diagnostics carry the node object until ids exist, because the walk emits
  // them before the tree is numbered.
  for (const diag of st.diagnostics) {
    if (diag._node) {
      diag.node = diag._node.id
      delete diag._node
    }
  }
  if (st.suppressed.size) {
    st.diagnostics.push({
      code: 'B4.diagnostics-suppressed',
      severity: 'warn',
      counts: Object.fromEntries(st.suppressed),
      note: `more than ${st.maxPerCode} occurrences of these codes; the rest are counted, not listed`,
    })
  }

  return { nodes: st.nodes, rootId, diagnostics: st.diagnostics }
}

export default buildPaintTree
