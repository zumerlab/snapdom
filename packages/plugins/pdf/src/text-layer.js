/**
 * Reads the laid-out DOM mounted in an isolated iframe from SnapDOM's FINAL SVG
 * artifact and produces the geometry the PDF text layer needs:
 * one positioned run per word (or source line in preserved white-space), plus
 * link rectangles.
 *
 * Word-level for ordinary prose is deliberate. A line-level run leans on the PDF
 * font's own advance widths to place characters, so selection highlights drift
 * away from the pixels underneath. Per word the drift is bounded by the word.
 *
 * The walk is over the FLATTENED tree (shadow roots entered, slots resolved) and
 * every element carries three accumulated ancestor facts: the linear part of its
 * CSS transform, the opacity product, and the overflow clip. Those three turn
 * "the DOM says this text exists" into "the raster paints it, there, at that
 * angle" — which is the only claim a text layer is allowed to make.
 */

// Which elements are semantic objects, and what they are called, is `tagged.js`'s
// question — this module only needs to know which textless ones deserve a run to
// hang a tag on, and asking there is what keeps the two answers one answer.
import { isFigure, semanticAlt } from './tagged.js'

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'DATALIST'])

/** Values, not text nodes: these carry their painted text on the element itself. */
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Input types whose value is painted as text. The rest paint widgets, not glyphs. */
const TEXT_INPUTS = new Set([
  'text', 'search', 'email', 'url', 'tel', 'number', 'password',
  'date', 'datetime-local', 'month', 'week', 'time', 'submit', 'reset', 'button',
])

const EPS = 1e-6
const SINGULAR = 1e-9
/**
 * Half-window for "this character is the same distance from both of those rects",
 * as a fraction of the coordinate magnitude — 64 float32 ulps. Relative because
 * the thing it absorbs is relative: client rects come back float32-rounded, so two
 * rects on the SAME painted line project to values that differ by ~ulp(coordinate)
 * rather than by 0. An absolute window cannot work, in either direction: 1e-6 px
 * sits INSIDE that rounding rather than above it (the same-line gaps in
 * groupByRect straddle it), and 0.5 px is above a real `line-height: 0.4px`
 * separation, which it then reads as one line. MEASURED over 78840 wrapped words,
 * drawn from a grid of 20 transforms × 3 nested outer transforms × 6 origins out
 * to ±9000 px × 4 font sizes from 3 to 200 px: the worst same-line projection is
 * 49.2 ulps of the (|cx| + |cy|) / 2 this multiplies, 30 cases exceed 32 ulps and
 * none exceeds 64.
 *
 * What it costs at the other end, since a window always costs something there: a
 * REAL separation narrower than it — about 0.003 painted px at a 400 px origin —
 * is read as one line. MEASURED, the split stays exact down to a 0.01 px
 * separation (`line-height: 0.2px` under `scale(1, 0.05)`) and goes wrong at
 * 0.004 px (the same under `scale(1, 0.02)`).
 */
const TIE_REL = 64 * 2 ** -23
/** Not an exact-zero test on purpose: '0.0000001' is invisible and serializes as a number. */
const ALPHA_MIN = 0.01
/** A sub-pixel numerical fringe is not a hidden character; anything larger is. */
const CLIP_EPS = 0.25
const CONTAIN_PAINT = /\b(paint|strict|content)\b/
/**
 * The `will-change` values that group. Naming a grouping property is NOT the rule,
 * however plausible: MEASURED against what Blink paints, of 23 property names given
 * to `will-change` this Chromium groups for `opacity`, `filter` and
 * `backdrop-filter` and for nothing else — `mix-blend-mode`, `clip-path`,
 * `mask-image`, `isolation` and `-webkit-box-reflect` all group as the property
 * but not as a `will-change` hint. `filter` is the substring that catches
 * `backdrop-filter`; the match is over a comma-separated list.
 */
const GROUPING = /opacity|filter/
/** Scripts that stay upright under `text-orientation: mixed`. All outside WinAnsi. */
const UPRIGHT = /[\u2E80-\uA4CF\uAC00-\uD7FF\uF900-\uFAFF\uFF00-\uFF60]/
/** 90° clockwise on screen: local +x goes down, local +y (down) goes left. */
const R90 = { a: 0, b: 1, c: -1, d: 0 }
/** The other way, for `sideways-lr` — the one vertical mode that reads bottom-up. */
const R270 = { a: 0, b: -1, c: 1, d: 0 }

/**
 * Chromium insets a themed <select>'s value by 4px on the inline-start side and
 * 16px on the end side (1px plus the drop-down arrow), and exposes neither in any
 * computed value: both were MEASURED by ink-scanning the painted value, and are
 * constant across font sizes. Other engines have their own numbers. What IS
 * observable is whether they apply at all — `appearance: none|base-select` drops
 * the widget and both insets with it.
 */
const MENULIST_START = 4
const MENULIST_END = 16
const THEMED = /^(auto|menulist)/

/** Schemes safe to hand to a PDF viewer as an external /URI action. */
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SVG_NS = 'http://www.w3.org/2000/svg'

const NO_CLIP = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
// Identity is a sentinel; importing the plugin must also work outside a browser.
const IDENTITY = Object.freeze({
  a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true,
  m11: 1, m12: 0, m13: 0, m14: 0,
  m21: 0, m22: 1, m23: 0, m24: 0,
  m31: 0, m32: 0, m33: 1, m34: 0,
  m41: 0, m42: 0, m43: 0, m44: 1,
})

/**
 * `filter: opacity(…)` only changes alpha, which this module can model. Every
 * other filter is a compositing operation whose visible contribution cannot be
 * inferred from a text rect (blur, url(), drop-shadow(), contrast, …), so null is
 * the fail-safe answer and the whole affected branch is excluded from the layer.
 */
function filterOpacity(value) {
  if (!value || value === 'none') return 1
  const calls = value.match(/opacity\([^)]*\)/gi) || []
  if (!calls.length || value.replace(/opacity\([^)]*\)/gi, '').trim()) return null
  let alpha = 1
  for (const call of calls) {
    const body = call.slice(call.indexOf('(') + 1, -1).trim()
    const n = parseFloat(body)
    if (!Number.isFinite(n)) return null
    alpha *= Math.max(0, Math.min(1, body.endsWith('%') ? n / 100 : n))
  }
  return alpha
}

/** Effects that can hide, reveal only part of, or visually replace glyph paint. */
function hasUnmodelledPaint(cs, alpha) {
  const value = (name, fallback = 'none') => cs[name] || fallback
  const textClip = String(value('backgroundClip', '')).split(',').some(v => v.trim() === 'text') ||
    String(value('webkitBackgroundClip', '')).split(',').some(v => v.trim() === 'text')
  return alpha === null ||
    value('clipPath') !== 'none' || value('clip', 'auto') !== 'auto' ||
    value('maskImage') !== 'none' || value('webkitMaskImage') !== 'none' ||
    value('maskBorderSource') !== 'none' || value('webkitMaskBoxImageSource') !== 'none' ||
    value('mixBlendMode', 'normal') !== 'normal' ||
    textClip || cs.contentVisibility === 'hidden'
}

const textSecurity = (cs) => (cs.webkitTextSecurity || 'none') !== 'none'
const shadowPaint = (cs) => (cs.textShadow || 'none') !== 'none'

let paintContext = null
const paintAlphaCache = new Map()

/** Ask Chromium's own colour parser whether a computed paint is transparent. */
function colourAlpha(value) {
  if (!value || value === 'none') return 0
  if (/^(?:url|context-fill|context-stroke)\(/i.test(value)) return 1
  if (paintAlphaCache.has(value)) return paintAlphaCache.get(value)
  if (!paintContext) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    paintContext = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!paintContext) return 1
  paintContext.clearRect(0, 0, 1, 1)
  // An unsupported assignment leaves this opaque sentinel in place. Keeping an
  // unknown paint is safer than declaring visible text invisible by accident.
  paintContext.fillStyle = '#000'
  try { paintContext.fillStyle = value } catch { /* computed colours should parse */ }
  paintContext.fillRect(0, 0, 1, 1)
  const alpha = paintContext.getImageData(0, 0, 1, 1).data[3] / 255
  paintAlphaCache.set(value, alpha)
  return alpha
}

function numericAlpha(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(1, String(value).trim().endsWith('%') ? n / 100 : n))
}

/** Whether the element's own glyph fill/stroke contributes visible paint. */
function textPaints(el, cs) {
  if (el.namespaceURI === SVG_NS) {
    const fill = colourAlpha(cs.fill) * numericAlpha(cs.fillOpacity)
    const stroke = colourAlpha(cs.stroke) * numericAlpha(cs.strokeOpacity)
    return fill >= ALPHA_MIN || (stroke >= ALPHA_MIN && (parseFloat(cs.strokeWidth) || 0) > 0)
  }
  const fillColour = cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor'
    ? cs.webkitTextFillColor
    : cs.color
  const fill = colourAlpha(fillColour)
  const stroke = colourAlpha(cs.webkitTextStrokeColor || cs.color)
  return fill >= ALPHA_MIN ||
    (stroke >= ALPHA_MIN && (parseFloat(cs.webkitTextStrokeWidth) || 0) > 0)
}

/** Shared by navigation so bookmarks never reveal paint-redacted heading text. */
export function inspectTextPaint(el, cs = getComputedStyle(el)) {
  const filtered = filterOpacity(cs.filter)
  const paints = textPaints(el, cs)
  const secured = textSecurity(cs)
  const shadowOnly = !paints && shadowPaint(cs)
  const unmodelled = hasUnmodelledPaint(cs, filtered)
  return {
    filterAlpha: filtered,
    paints,
    secured,
    shadowOnly,
    unmodelled,
    unsafe: unmodelled || secured || shadowOnly,
  }
}

/** Canvas advances, scoped to the document that owns each embedded font face. */
const measureContexts = new WeakMap()
function measurer(doc = document) {
  let ctx = measureContexts.get(doc)
  if (!ctx) {
    ctx = doc.createElement('canvas').getContext('2d')
    measureContexts.set(doc, ctx)
  }
  return ctx
}

/** Map a CSS font stack onto the base-14 family the PDF will actually carry. */
function base14Key(style) {
  const family = style.fontFamily.toLowerCase()
  const weight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400)
  const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique'

  let base = 'sans'
  if (/mono|courier|consolas|menlo/.test(family)) base = 'mono'
  else if (/serif/.test(family) && !/sans-serif/.test(family)) base = 'serif'
  else if (/times|georgia|garamond|cambria/.test(family)) base = 'serif'

  const bold = weight >= 600
  if (bold && italic) return `${base}-bolditalic`
  if (bold) return `${base}-bold`
  if (italic) return `${base}-italic`
  return base
}

/** Font string for the base-14 equivalent, used to predict the PDF's own advance. */
function pdfFontShorthand(key, size) {
  const italic = key.includes('italic') ? 'italic ' : ''
  const bold = key.includes('bold') ? 'bold ' : ''
  const family = key.startsWith('mono') ? 'Courier' : key.startsWith('serif') ? 'Times' : 'Helvetica'
  return `${italic}${bold}${size}px ${family}`
}

/**
 * `text-transform` computes to a compound value — 'uppercase full-width',
 * 'capitalize full-size-kana' — so this tests membership, not equality. The
 * width/kana keywords swap glyphs rather than case and are left alone: the raster
 * paints them, the layer stays searchable in the codepoints the DOM has.
 */
function applyTransform(text, mode) {
  if (mode.includes('uppercase')) return text.toUpperCase()
  if (mode.includes('lowercase')) return text.toLowerCase()
  if (!mode.includes('capitalize')) return text
  return text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

/**
 * The painted form of ONE fragment of a word. `capitalize` is the only keyword
 * that needs to know where the word starts — the caller does — and applying it
 * blind to a fragment would upcase every glyph. The case keywords are length-safe
 * here by construction: the Range offsets bounding the fragment index the SOURCE
 * string, so ß → SS moves nothing.
 */
function shown(info, text, first) {
  if (!info.transform.includes('capitalize')) return applyTransform(text, info.transform)
  return first ? text.replace(/\S/, c => c.toUpperCase()) : text
}

/**
 * The flattened tree, which is the one that gets painted: slotted nodes render
 * inside the SLOT's box, and a shadow root's children have no parentElement.
 * All three ancestor walks below use this — anything else describes a tree the
 * browser never laid out.
 */
function renderParent(node) {
  if (node.assignedSlot) return node.assignedSlot
  if (node.parentElement) return node.parentElement
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

// ——— transforms ———

function toDeg(v) {
  const n = parseFloat(v) || 0
  // 'grad' first: it ends with 'rad'.
  if (v.endsWith('grad')) return n * 0.9
  if (v.endsWith('rad')) return (n * 180) / Math.PI
  if (v.endsWith('turn')) return n * 360
  return n
}

function applyRotate(m, value) {
  const parts = value.trim().split(/\s+/)
  const angle = toDeg(parts.pop())
  if (parts.length === 3) return m.rotateAxisAngleSelf(+parts[0], +parts[1], +parts[2], angle)
  const axis = parts.length === 1 ? parts[0] : 'z'
  return m.rotateAxisAngleSelf(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'x' || axis === 'y' ? 0 : 1, angle)
}

/**
 * The element's own transform, linear part only.
 * `transform` alone is not enough: the rotate/scale longhands are separate
 * computed values applied outside it, in the order translate → rotate → scale →
 * transform. `translate` is pure translation, so it never reaches the linear part
 * — and neither does `transform-origin`, which is a conjugation by a translation.
 * Its z does reach the PERSPECTIVE question, though, which is what zTranslate is.
 */
function ownLinear(cs) {
  let m = null
  if (cs.rotate && cs.rotate !== 'none') m = applyRotate(new DOMMatrix(), cs.rotate)
  if (cs.scale && cs.scale !== 'none') {
    const p = cs.scale.trim().split(/\s+/).map(Number)
    m = (m || new DOMMatrix()).scaleSelf(p[0], p.length > 1 ? p[1] : p[0], p.length > 2 ? p[2] : 1)
  }
  // Computed `transform` is always 'none' or matrix()/matrix3d(); DOMMatrix throws on 'none'.
  if (cs.transform.startsWith('matrix')) {
    const t = new DOMMatrix(cs.transform)
    m = m ? m.multiply(t) : t
  }
  return m
}

/**
 * How far the `translate` longhand moves the element along z. It is a
 * translation, so ownLinear drops it — but a translation in z is exactly what an
 * ancestor's perspective divides by, and nothing else here would ever see it.
 */
function zTranslate(cs) {
  if (!cs.translate || cs.translate === 'none') return 0
  const p = cs.translate.trim().split(/\s+/)
  return p.length > 2 ? parseFloat(p[2]) || 0 : 0
}

/**
 * `transform-origin`'s z. Chromium serializes the computed value with two
 * components when z is zero and three when it is not, so the third is absent far
 * more often than it is present.
 */
function originZ(cs) {
  const p = cs.transformOrigin.trim().split(/\s+/)
  return p.length > 2 ? parseFloat(p[2]) || 0 : 0
}

/**
 * Whether the element leaves the z = 0 plane AT z = 0. That is exactly when a
 * perspective above it is the identity, because perspective divides by 1 − z/d
 * and reads nothing else — so it is the whole question this file has to ask about
 * any perspective it cannot itself multiply out.
 *
 * Three terms. The z row must not couple x or y into z, or the plane tilts rather
 * than shifts. Its displacement is m43, plus the `translate` longhand's z that
 * ownLinear drops as a translation, plus `oz·(1 − m33)` — the residue of
 * conjugating the transform by a transform-origin that has a z of its own.
 *
 * All three MEASURED against Blink over 20 transform × origin × translate
 * combinations, by painting each with and without an ancestor `perspective:500px`
 * and comparing the linear parts: every case this calls z-neutral paints
 * identically both ways (diff 0), and every case it does not is scaled by exactly
 * 1 / (1 − z/500) to five decimals. `rotateX(180deg)` alone is z-neutral — that is
 * the card flip, and it survives — while the same rotation under
 * `transform-origin: 50% 50% 60px` lands the plane at z = 120 and Blink scales it
 * by 1.31579. The origin term is the one this module got wrong before: without it
 * that flip was shipped as a bare [1, 0, 0, −1] over glyphs painted 1.32× larger.
 */
function zNeutral(cs, own) {
  let z = zTranslate(cs)
  if (own) {
    if (Math.abs(own.m13) > EPS || Math.abs(own.m23) > EPS) return false
    const oz = originZ(cs)
    // ownLinear reports the matrix UNCONJUGATED by transform-origin, which is exact
    // for an affine one — a translation cannot reach an affine linear part — and
    // wrong for a projective one, where the conjugation divides through. So a
    // projective own with an origin off the z = 0 plane is a map this file does not
    // hold. MEASURED: `transform: perspective(324px)` under
    // `transform-origin: 14px 47px 31px` is painted 0.913× = 1 / (1 + 31/324),
    // where the bare matrix claims 1 and used to be believed.
    if (oz && (own.m34 || own.m14 || own.m24 || own.m44 !== 1)) return false
    z += own.m43 + oz * (1 - own.m33)
  }
  return Math.abs(z) < EPS
}

/**
 * `L · seg`, with `seg` projected onto z = 0 first — which is all a flat ancestor
 * ever composites into its own plane. Dropping the z row and column IS CSS
 * flattening; every entry it clears is one the browser has already discarded.
 */
function flatten(L, seg) {
  if (seg === IDENTITY) return L
  if (seg.is2D) return L === IDENTITY ? seg : L.multiply(seg)
  const f = DOMMatrix.fromMatrix(seg)
  f.m13 = f.m23 = f.m31 = f.m32 = f.m34 = f.m43 = 0
  f.m33 = 1
  return L === IDENTITY ? f : L.multiply(f)
}

/**
 * Whether the element is a grouping context, which composites its subtree as one
 * flat image and so overrides `transform-style: preserve-3d`. Every term MEASURED
 * against what Blink paints, over 108 property values: `rotateY(30deg)` over
 * `rotateY(30deg)` paints 0.75 of the local advance when the outer element groups
 * and 0.50 when it preserves. The surprises, both ways round: `contain:
 * paint|strict|content` and `content-visibility: auto` measurably do NOT group
 * here, while `-webkit-box-reflect`, `view-transition-name` and
 * `-webkit-mask-box-image` do. Those last three are guarded rather than compared
 * bare — all three are prefixed or recent enough that a computed style need not
 * carry them, and `undefined !== 'none'` would make EVERY element group.
 */
function groups(cs) {
  return cs.opacity !== '1' || cs.filter !== 'none' || cs.clipPath !== 'none' ||
    cs.mixBlendMode !== 'normal' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible' ||
    cs.maskImage !== 'none' || cs.backdropFilter !== 'none' || cs.isolation !== 'auto' ||
    (cs.webkitBoxReflect || 'none') !== 'none' || (cs.viewTransitionName || 'none') !== 'none' ||
    (cs.webkitMaskBoxImageSource || 'none') !== 'none' || GROUPING.test(cs.willChange)
}

/** 2×2 product in CSS column convention: x' = a·x + c·y, y' = b·x + d·y. */
function compose(L, M) {
  if (!L) return { ...M }
  return {
    a: L.a * M.a + L.c * M.b,
    b: L.b * M.a + L.d * M.b,
    c: L.a * M.c + L.c * M.d,
    d: L.b * M.c + L.d * M.d,
  }
}

function axisAligned(L) {
  return Math.abs(L.b) < EPS && Math.abs(L.c) < EPS
}

/**
 * The matrix a run should carry: null for the untransformed case, so the common
 * path stays exactly as cheap and as exact as it was before rotation existed.
 * Null too where no 2×2 describes the map — see `affine` in contextOf for what
 * that costs and why. The 2×2 itself is exact whenever it is handed out: it is
 * the accumulated map restricted to the plane the text lives in.
 */
function runMatrix(ctx) {
  if (!ctx.affine) return null
  const { a, b, c, d } = ctx.L
  if (Math.abs(a - 1) < EPS && Math.abs(d - 1) < EPS && Math.abs(b) < EPS && Math.abs(c) < EPS) return null
  return { a, b, c, d }
}

// ——— clipping ———

function intersect(a, b) {
  if (a === NO_CLIP) return b
  if (b === NO_CLIP) return a
  return {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  }
}

/**
 * A run is selectable as its COMPLETE source string, so it is safe only when its
 * complete painted rect is inside every overflow clip. Keeping a 60%-visible word
 * would also keep the 40% used as a visual redaction. CLIP_EPS absorbs CSS/device
 * rounding only; it is far smaller than a legible glyph stem.
 */
function fullyInside(rect, clip) {
  if (clip === NO_CLIP) return true
  return rect.left >= clip.left - CLIP_EPS && rect.top >= clip.top - CLIP_EPS &&
    rect.right <= clip.right + CLIP_EPS && rect.bottom <= clip.bottom + CLIP_EPS
}

/** Crop a link annotation to what is actually clickable after overflow clips. */
function clippedRect(rect, clip) {
  if (clip === NO_CLIP) return {
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.width, height: rect.height, cropped: false,
  }
  const left = Math.max(rect.left, clip.left)
  const top = Math.max(rect.top, clip.top)
  const right = Math.min(rect.right, clip.right)
  const bottom = Math.min(rect.bottom, clip.bottom)
  if (right <= left || bottom <= top) return null
  return {
    left, top, right, bottom, width: right - left, height: bottom - top,
    cropped: left > rect.left + CLIP_EPS || top > rect.top + CLIP_EPS ||
      right < rect.right - CLIP_EPS || bottom < rect.bottom - CLIP_EPS,
  }
}

/**
 * Which axes clip, and how far past the padding box the clip edge sits on each.
 * Per axis because `clip` next to `visible` is a legal COMPUTED pair — only
 * `hidden`/`scroll`/`auto` force the other axis to `auto`. `overflow-x: clip;
 * overflow-y: visible` cuts nothing off the top or the bottom, and taking one
 * rect for both axes drops text the raster demonstrably paints.
 */
function clipAxes(cs) {
  const paint = CONTAIN_PAINT.test(cs.contain)
  // The margin only exists where there IS an overflow clip EDGE to push outward.
  // `overflow: hidden` clips at the padding box and ignores it — but Chromium
  // computes the length there all the same, so taking it unconditionally WOULD
  // keep text the raster cut off, which is what these two gates are for.
  const m = parseFloat(cs.overflowClipMargin) || 0
  return {
    x: paint || cs.overflowX !== 'visible',
    y: paint || cs.overflowY !== 'visible',
    mx: paint || cs.overflowX === 'clip' ? m : 0,
    my: paint || cs.overflowY === 'clip' ? m : 0,
  }
}

/** A form control clips its own value at the padding box, whatever `overflow` says. */
const CONTROL_CLIP = { x: true, y: true, mx: 0, my: 0 }

function containsFixed(cs) {
  // The individual transform properties are not everywhere: unguarded, `undefined
  // !== 'none'` would make EVERY element a containing block and collapse clipAbs.
  return cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
    (cs.rotate || 'none') !== 'none' || (cs.scale || 'none') !== 'none' ||
    (cs.translate || 'none') !== 'none' ||
    (cs.backdropFilter || 'none') !== 'none' || cs.willChange.includes('transform') ||
    CONTAIN_PAINT.test(cs.contain)
}

/**
 * The clip rect is the PADDING box, and getBoundingClientRect gives the border
 * box — insetting a transformed AABB by unscaled border widths would be wrong.
 * offsetWidth/clientLeft are transform-free layout metrics, so the padding box is
 * built in local px and mapped out through L: the AABB centre is the image of the
 * local centre for any affine map, which pins the translation for free.
 */
function paddingBox(el, L, ax) {
  const r = el.getBoundingClientRect()
  const { a, b, c, d } = L
  const cw = el.clientWidth
  const ch = el.clientHeight
  let box
  if (!cw || !el.offsetWidth) {
    // No local box to expand before mapping, so the margins are mapped on their
    // own — same units as the branch below, which is the whole point.
    const mx = Math.abs(a) * ax.mx + Math.abs(c) * ax.my
    const my = Math.abs(b) * ax.mx + Math.abs(d) * ax.my
    box = { left: r.left - mx, top: r.top - my, right: r.right + mx, bottom: r.bottom + my }
  } else {
    const dx = el.clientLeft + cw / 2 - el.offsetWidth / 2
    const dy = el.clientTop + ch / 2 - el.offsetHeight / 2
    const cx = (r.left + r.right) / 2 + a * dx + c * dy
    const cy = (r.top + r.bottom) / 2 + b * dx + d * dy
    // overflow-clip-margin is a LOCAL length: expand the padding box before mapping
    // it out, or a scale(4) box comes back clipped 3·margin too tight on each side.
    const hx = (Math.abs(a) * (cw + 2 * ax.mx) + Math.abs(c) * (ch + 2 * ax.my)) / 2
    const hy = (Math.abs(b) * (cw + 2 * ax.mx) + Math.abs(d) * (ch + 2 * ax.my)) / 2
    box = { left: cx - hx, top: cy - hy, right: cx + hx, bottom: cy + hy }
  }
  if (ax.x && ax.y) return box
  // One axis clipping alone bounds only the VIEWPORT axis its edge normal lands
  // on — (d, −c) for local x, (−b, a) for local y, so a 90° rotation swaps them.
  // Under a diagonal map it lands on neither: a slab is not an AABB, and leaving
  // that axis open keeps text the raster paints instead of dropping it.
  if (!((ax.x && Math.abs(c) < EPS) || (ax.y && Math.abs(a) < EPS))) { box.left = -Infinity; box.right = Infinity }
  if (!((ax.x && Math.abs(d) < EPS) || (ax.y && Math.abs(b) < EPS))) { box.top = -Infinity; box.bottom = Infinity }
  return box
}

// ——— accumulated ancestor context ———

const TOP = {
  cs: null, L: IDENTITY, outer: IDENTITY, seg: IDENTITY,
  preserve3d: false, persp: false, perspProp: false, tilt: false,
  affine: true, bad: false, soft: false,
  noCtm: false, alpha: 1, inside: false, unsafePaint: false,
  clip: NO_CLIP, clipAbs: NO_CLIP, clipFixed: NO_CLIP,
}

/**
 * Everything the ancestors do to an element, memoized per element so the walk
 * costs one getComputedStyle each rather than one per text node.
 *
 * Two different stop points, on purpose. The transform accumulates to the top of
 * the document because client rects already carry every transform up to the
 * viewport — origin and matrix must describe the same space. Opacity and clipping
 * stop at the capture root INCLUSIVE, because snapdom re-renders the element in
 * isolation: an above-root `opacity: 0` does not blank the capture, but the root's
 * own does, and with `overflow: visible` snapdom paints outside the root box.
 */
function contextOf(el, S) {
  const hit = S.ctxCache.get(el)
  if (hit) return hit

  const parent = renderParent(el)
  const base = parent ? contextOf(parent, S) : TOP
  const cs = getComputedStyle(el)
  // An element that generates no box has its transform, opacity and filter ignored.
  const boxless = cs.display === 'contents'

  // Two parts, because a 3D rendering context is only flattened once it CLOSES:
  // `outer` is every context above that already has, `seg` is the open one. `seg`
  // stays IDENTITY while nothing 3D is in play, so the ordinary chain is one
  // matrix and one multiply per transform, exactly as it was.
  let outer = base.outer
  let seg = base.seg
  // A perspective that projects THIS element: the `perspective` property warps an
  // element's descendants and never its own text, so it is inherited rather than
  // applied here — but the perspective() transform FUNCTION is part of the
  // element's own transform and projects the element itself.
  //
  // Both of these describe the OPEN 3D context only, and are cleared when one
  // closes. `bad` is the one thing that cannot be: it records that `outer` itself
  // is no longer a description of anything Blink paints.
  let persp = base.persp
  let tilt = base.tilt
  let bad = base.bad
  let soft = base.soft
  let noCtm = base.noCtm
  const ctm = !boxless && el.getScreenCTM ? el.getScreenCTM() : null
  if (ctm) {
    // viewBox scaling appears in no computed transform. getScreenCTM is the only
    // place it surfaces, and it already carries every ancestor — stop here. Only
    // its linear part is taken, so however it treats scroll offsets is moot.
    outer = new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, 0, 0])
    seg = IDENTITY
  } else if (!boxless) {
    if (el.getScreenCTM) noCtm = true
    // A parent that does not preserve 3D closes the context above it: what it
    // composites into its own plane is that context FLATTENED, and the flattened
    // form is the only one the browser paints. Multiplying the whole chain naively
    // instead lets two 3D transforms across such a boundary cancel terms that were
    // already dropped — MEASURED: `rotateY(60deg)` over `rotateY(-60deg)
    // rotate(25deg)` then places a run 60.7 px wide where Blink paints 15.2 px.
    if (!base.preserve3d) {
      // Whether this close changes anything — a 3D segment to flatten, a perspective
      // or a tilt to drop. One that does is one a descendant can tell apart, which
      // is the whole of what `soft` is for; one that does not is free.
      if (seg !== IDENTITY || persp || tilt) soft = true
      if (seg !== IDENTITY) { outer = flatten(outer, seg); seg = IDENTITY }
      // Closing the context ends what it was, too. Below the boundary the geometry
      // is a plane again, and every perspective above has been baked out of it —
      // flattening zeroes m34, which is the whole of a perspective. MEASURED:
      // `transform: perspective(500px)` on a flat parent leaves its rotateY(45deg)
      // child painting [0.7071, 0, 0, 1], the bare orthographic squash, with no
      // trace of the perspective in it.
      //
      // Unless the closing context was itself projected, in which case `outer` now
      // holds an orthographic squash of something Blink painted as a trapezoid and
      // nothing below it can be trusted again. MEASURED, `perspective: 500px` over
      // a flat `rotateY(60deg)` over `rotateY(-60deg) rotate(25deg)`: the leaf's
      // painted quad is not a parallelogram at all — its fourth corner misses by
      // 50.5 px — while the matrix this would otherwise hand out claims it is.
      if (!base.affine) bad = true
      tilt = false
      persp = false
    }
    // A perspective on the parent applies to this element whatever the parent's
    // transform-style: flattening ends the parent's 3D CONTEXT, and the parent's
    // perspective acts below that, on its children's own plane.
    if (base.perspProp) persp = true
    const own = ownLinear(cs)
    if (own) {
      // A 2D transform is its own flattening, so it can go straight into `outer`
      // and leave the 3D bookkeeping — and its cost — to chains that are 3D.
      if (seg === IDENTITY && own.is2D) outer = outer === IDENTITY ? own : outer.multiply(own)
      else seg = seg === IDENTITY ? own : seg.multiply(own)
    }
    // `ownLinear` drops the `translate` longhand as a pure translation, but Blink
    // builds a transform node for it all the same — and a transform node is what
    // closes the context. Keying the reach-back guard on `own` alone let
    // `perspective(300px)` over a bare `preserve-3d` div over `translate: 0 0 30px`
    // ship a silent identity where Blink paints 1/(1 − 30/300).
    if ((own && !own.isIdentity) || (cs.translate && cs.translate !== 'none')) {
      // A context closed above at an element that carried no transform of its own
      // is a close Blink may not have made: an element under a `preserve-3d`
      // parent can reach back past it and compose against the UNFLATTENED chain.
      // MEASURED, `rotate3d(0,1,1,45deg)` (flat) over an empty div over a
      // `preserve-3d` div over `rotateY(25deg)`: Blink paints
      // [0.4295, 0.3913, −0.5, 0.8536], the flattened PRODUCT, where closing at
      // the empty div gives [0.6409, 0.4532, −0.5, 0.8536].
      //
      // Which way it goes is not decidable from anything this file reads. Also
      // MEASURED on that same chain: giving the empty div `transform:
      // translateX(1px)` or `margin-left: 37px` restores the close and the
      // [0.6409, …] answer, while `transform: rotate(0deg)`, `width`, `height`,
      // `padding-left` and `margin-top` all leave it reaching back. So refuse,
      // rather than pick — and treat an identity transform as no transform, since
      // `rotate(0deg)` measurably does not restore the close.
      if (base.preserve3d && soft) bad = true
      soft = false
    }
    // Per element, and deliberately so: an ancestor's perspective divides by
    // 1 − z/d at every link, so a link that puts geometry off the plane is not
    // undone by a later link that brings the ACCUMULATED 2×2 back. MEASURED under
    // `perspective: 600px`, `rotateY(45deg)` over `rotateY(-45deg) rotate(25deg)`
    // accumulates to a clean rotate(25deg) and Blink paints it 1.892× that, because
    // the two rotations turn about origins 400 px apart and leave the plane off z.
    // The same two rotations about the SAME origin do return to z = 0 and do paint
    // rotate(25deg) exactly — and this rejects that one too, loudly rather than
    // silently, because the difference is a layout offset this module never sees.
    if (!zNeutral(cs, own)) tilt = true
    if (own && own.m34) persp = true
  }
  // The map that paints this element's own text: its context, flattened into the
  // plane it is composited onto.
  const M = flatten(outer, seg)
  // Text lives in the z = 0 plane, and a matrix3d maps that plane through its 2×2
  // block alone as long as its projective row is trivial — which every
  // GPU-promotion hack (translateZ(0), translate3d) is, and Chrome serializes ALL
  // of them as matrix3d. That row is the only thing left to check here, because
  // flattening has already taken care of the z column.
  //
  // Under a perspective the plane must also STAY at z = 0, or the map is a
  // trapezoid — or a uniform scale by 1 / (1 − z/d) that this product has no term
  // for — and the run falls back to axis-aligned. That is what keeps the card flip
  // — `rotateY(180deg)`, 3D but z-neutral — exact instead of thrown away.
  const affine = !bad && !M.m14 && !M.m24 && M.m44 === 1 && (!persp || !tilt)

  const inside = base.inside || el === S.root
  let alpha = base.alpha
  let unsafePaint = inside && el !== S.root ? base.unsafePaint : false
  if (inside && !boxless) {
    alpha *= parseFloat(cs.opacity) || 0
    const filtered = filterOpacity(cs.filter)
    if (filtered !== null) alpha *= filtered
    if (hasUnmodelledPaint(cs, filtered)) unsafePaint = true
  }

  // An absolutely positioned box escapes every clipper that is not in its
  // containing-block chain, so it picks up the clip recorded at that point.
  let clip = NO_CLIP
  if (inside) clip = cs.position === 'fixed' ? base.clipFixed : cs.position === 'absolute' ? base.clipAbs : base.clip
  if (inside && !boxless) {
    const ax = clipAxes(cs)
    if (ax.x || ax.y) clip = intersect(clip, paddingBox(el, M, ax))
  }
  const fixedCb = containsFixed(cs)

  if (cs.zoom && cs.zoom !== '1') S.f.zoom = true
  if (cs.contentVisibility && cs.contentVisibility !== 'visible') S.f.contentVisibility = true

  const ctx = {
    cs, L: M, outer, seg, affine, tilt, persp, bad, soft, noCtm,
    alpha, inside, unsafePaint, clip,
    // `display: contents` generates no box, so it neither preserves nor groups nor
    // projects — whatever the parent decided still holds for its children.
    preserve3d: boxless ? base.preserve3d : cs.transformStyle === 'preserve-3d' && !groups(cs),
    perspProp: boxless ? base.perspProp : cs.perspective !== 'none',
    clipAbs: cs.position !== 'static' || fixedCb ? clip : inside ? base.clipAbs : NO_CLIP,
    clipFixed: fixedCb ? clip : inside ? base.clipFixed : NO_CLIP,
  }
  S.ctxCache.set(el, ctx)
  return ctx
}

// ——— font metrics ———

/**
 * Baseline metrics from the document that actually laid out the final artifact.
 *
 * Canvas metrics from the application document are not interchangeable here: an
 * embedded @font-face belongs to the isolated artifact document, so the parent
 * canvas can silently measure a fallback face. A zero-height inline block sits on
 * the baseline; its top minus a neighbouring text Range's top is therefore the
 * ascent Blink used for that inline box. The probe is off-screen, cached per font,
 * and removed before collectTextLayer returns.
 */
function layoutFontMetrics(el, S, css, fallbackAscent, fallbackDescent) {
  const doc = el.ownerDocument || document
  const key = css
  const cached = S.layoutFontCache.get(key)
  if (cached) return cached
  if (!doc.body) return { ascent: fallbackAscent, descent: fallbackDescent }

  let host = S.metricHost
  if (!host || host.ownerDocument !== doc) {
    host = doc.createElement('div')
    host.setAttribute('data-snapdom-pdf-font-metrics', '')
    host.style.cssText =
      'all:initial!important;position:fixed!important;left:0!important;top:0!important;' +
      'display:block!important;width:max-content!important;height:auto!important;' +
      'white-space:nowrap!important;line-height:normal!important;visibility:hidden!important;' +
      'pointer-events:none!important;z-index:-2147483648!important;'
    doc.body.appendChild(host)
    S.metricHost = host
  }

  const probe = doc.createElement('span')
  probe.style.font = css
  probe.style.lineHeight = 'normal'
  probe.style.whiteSpace = 'nowrap'
  const marker = doc.createElement('span')
  marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;border:0;margin:0'
  const sample = doc.createTextNode('Hxg')
  probe.append(marker, sample)
  host.appendChild(probe)

  const range = doc.createRange()
  range.selectNodeContents(sample)
  const textRect = range.getClientRects()[0]
  const baseline = marker.getBoundingClientRect().top
  probe.remove()

  const ascent = textRect ? baseline - textRect.top : NaN
  const descent = textRect ? textRect.bottom - baseline : NaN
  const measured = {
    ascent: Number.isFinite(ascent) && ascent > 0 ? ascent : fallbackAscent,
    descent: Number.isFinite(descent) && descent >= 0 ? descent : fallbackDescent,
  }
  S.layoutFontCache.set(key, measured)
  return measured
}

function fontOf(el, S, cs) {
  const hit = S.fontCache.get(el)
  if (hit) return hit

  const size = parseFloat(cs.fontSize) || 16
  const key = base14Key(cs)
  // The REAL identity of the face this style asks for, kept alongside the
  // base-14 approximation: an export that can embed the actual binary needs the
  // stack, and the stack is only readable while this document is alive.
  const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400)
  const italic = cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique')
  const fkKey = `${cs.fontFamily}|${weight}|${italic}`
  let fk = S.fontKeyIndex.get(fkKey)
  if (fk === undefined) {
    fk = S.fontKeys.length
    S.fontKeys.push({ stack: cs.fontFamily, weight, italic })
    S.fontKeyIndex.set(fkKey, fk)
  }
  const css = `${cs.fontStyle === 'normal' ? '' : cs.fontStyle + ' '}${cs.fontWeight} ${size}px ${cs.fontFamily}`
  const doc = el.ownerDocument || document
  const ctx = measurer(doc)
  ctx.font = css
  const metrics = ctx.measureText('Hxg')
  const fallbackAscent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || size * 0.8
  const fallbackDescent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || size * 0.2
  const { ascent, descent } = layoutFontMetrics(el, S, css, fallbackAscent, fallbackDescent)
  const info = {
    key, fk, size, ascent, descent, css, document: doc,
    pdf: pdfFontShorthand(key, size),
    transform: cs.textTransform,
    // 'normal' is not a length: assigning it to the canvas leaves the previous value.
    tracking: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing,
    spacing: cs.wordSpacing === 'normal' ? '0px' : cs.wordSpacing,
    // 'normal' is ascent + descent + the font's line GAP, and no browser API
    // exposes the gap — this under-reports it by a few percent of the size, which
    // accumulates downward over a long textarea. Recovering it needs a mirror
    // element laid out in the same style — the extra layout wrapLines below
    // already declines to pay for, and paying for it here buys half an answer.
    lineHeight: parseFloat(cs.lineHeight) || ascent + descent,
    vertical: /^(vertical|sideways)/.test(cs.writingMode),
    // sideways-lr turns glyphs COUNTER-clockwise; every other vertical mode turns
    // them clockwise. text-orientation does not apply to sideways-* at all, so
    // folding it in here keeps the upright test to one rule.
    turn: cs.writingMode === 'sideways-lr' ? R270 : R90,
    orientation: /^sideways/.test(cs.writingMode) ? 'sideways' : cs.textOrientation,
    align: cs.textAlign,
    rtl: cs.direction === 'rtl',
    // The fill a vector-text export paints this run with, and null when the run
    // must NOT be painted as vector: a colour that does not resolve, is
    // translucent (a Type0 fill has no per-run alpha here), or a word-spacing a
    // Type0 font cannot express — PDF `Tw` applies only to single-byte code 32,
    // and Identity-H is two-byte. Letter-spacing IS expressible (via `Tc`) and
    // travels on `tracking` instead of blocking the paint.
    color: (colourAlpha(cs.color) >= 0.999 && (parseFloat(cs.wordSpacing) || 0) === 0)
      ? colourTriple(cs.color) : null,
    // Letter-spacing in CSS px, applied as character spacing (`Tc`) when
    // painting. Distinct from `tracking` above, which is the canvas string the
    // measurement path feeds to ctx.letterSpacing.
    trackingPx: parseFloat(cs.letterSpacing) || 0,
  }
  S.fontCache.set(el, info)
  return info
}

/** Advance in the REAL font — the only independent measurement a rotated run has. */
function measureReal(info, text) {
  const ctx = measurer(info.document)
  ctx.font = info.css
  ctx.letterSpacing = info.tracking
  ctx.wordSpacing = info.spacing
  const w = ctx.measureText(text).width
  ctx.letterSpacing = '0px'
  ctx.wordSpacing = '0px'
  return w
}

/**
 * Advance the base-14 font will produce, which is what Tz has to correct for.
 * Zero for a run the substitute maps to no advance at all (combining marks), and
 * reported as such: the caller divides by it and has to guard, and inventing an
 * epsilon here would silently turn that run into a 1000% stretch instead.
 */
function measureNatural(info, text) {
  const ctx = measurer(info.document)
  ctx.font = info.pdf
  return ctx.measureText(text).width
}

/**
 * Advance of a string in a base-14 face, in the units `size` is given in.
 *
 * Exported because the page's own text — a number, a running head, a line of the
 * generated index — has no DOM run to take a measurement from, and the standing
 * `length × size × 0.5` estimate puts a right-aligned string visibly off its
 * margin and makes dot leaders arrive at the wrong place.
 *
 * @param {string} text
 * @param {string} [key='sans'] a base-14 key: `sans`, `serif-bold`, `mono`, …
 * @param {number} [size=10]
 */
export function measureBase14(text, key = 'sans', size = 10) {
  const ctx = measurer()
  ctx.font = pdfFontShorthand(key || 'sans', size)
  return ctx.measureText(String(text)).width
}

// ——— placing a run ———

/**
 * The run's box in ITS OWN space, recovered from the AABB the browser reported.
 *
 * Rotation makes this genuinely hard: the two AABB equations in (w, h) are
 * singular at 45°, so one of the two must come from an independent measurement.
 * We measure w (canvas advance) and recover h.
 *
 * h is the INLINE box — ascent + descent, what getClientRects reports for a text
 * Range and what the fallback below uses. Not the line box: `line-height: 2`
 * leaves its leading OUT of h, deliberately, because h is the run's painted
 * extent and that is what a page-slice overlap test has to reason about.
 */
function localBox(L, rect, info, text) {
  if (!L) return { width: rect.width, height: rect.height }
  const { a, b, c, d } = L
  if (axisAligned(L)) {
    // The AABB corners ARE the images of the local corners; h never enters.
    return { width: rect.width / Math.abs(a), height: rect.height / Math.abs(d) }
  }
  const width = measureReal(info, text)
  // Pick the better-conditioned axis: the larger divisor is the smaller error gain.
  let height = Math.abs(d) >= Math.abs(c)
    ? (rect.height - Math.abs(b) * width) / Math.abs(d)
    : (rect.width - Math.abs(a) * width) / Math.abs(c)
  // Blink's text fragment rects are inline boxes, not line boxes (getClientRects
  // on an inline ignores line-height), so that is the shape to fall back to.
  const inline = info.ascent + info.descent
  if (!isFinite(height) || height < 0.5 * inline || height > 3 * inline) height = inline
  return { width, height }
}

/**
 * Baseline start point, in viewport px. The AABB centre is the image of the local
 * centre under any affine map, so the origin is one displacement away along L —
 * no inverse, and the unknown translation cancels.
 *
 * With L identity this collapses to `rect.left, rect.top + ascent`: the shipped,
 * verified line, and h drops out. That is the untransformed path, unchanged.
 */
function baselineOrigin(L, rect, box, A) {
  if (!L) return { originX: rect.left, originY: rect.top + A }
  const { a, b, c, d } = L
  if (axisAligned(L)) {
    return {
      originX: a > 0 ? rect.left : rect.right,
      originY: (d > 0 ? rect.top : rect.bottom) + d * A,
    }
  }
  const dx = -box.width / 2
  const dy = A - box.height / 2
  return {
    originX: rect.left + rect.width / 2 + a * dx + c * dy,
    originY: rect.top + rect.height / 2 + b * dx + d * dy,
  }
}

/**
 * Truthy only when the run really went out. Three paths drop it — a degenerate
 * rect, a singular map, the clip — and all three COUNT what they dropped, or a
 * `transform: scale(0)` would empty the whole layer without a word of warning.
 */
function pushRun(S, text, rect, info, L, ctx, owner) {
  // scale(0) and friends collapse an axis before the determinant below ever sees it.
  if (rect.width <= 0 || rect.height <= 0) { S.n.invisible++; return }
  // A singular map paints nothing and leaves w and h unrecoverable.
  if (L && Math.abs(L.a * L.d - L.b * L.c) < SINGULAR) { S.n.invisible++; return }
  if (!fullyInside(rect, ctx.clip)) { S.n.clipped++; return }
  if (!ctx.affine) S.n.nonAffine++
  // Only worth warning about once something was actually placed under it.
  if (ctx.noCtm) S.f.svgNoCtm = true

  const box = localBox(L, rect, info, text)
  const { originX, originY } = baselineOrigin(L, rect, box, info.ascent)
  S.runs.push({
    text, originX, originY,
    width: box.width, height: box.height, ascent: info.ascent,
    size: info.size, font: info.key, fk: info.fk,
    naturalWidth: measureNatural(info, text),
    matrix: L, rtl: info.rtl, color: info.color, tracking: info.trackingPx,
  })
  // Parallel to `runs`, never inside a run: the run's key set is a pinned
  // contract, and this is a node from the temporary layout DOM that must not
  // travel with it.
  S.owners.push(owner)
  return true
}

// ——— text nodes ———

/** Glyphs that keep their horizontal orientation while the line advances downward. */
function isUpright(info, text) {
  return info.orientation === 'upright' ||
    (info.orientation !== 'sideways' && UPRIGHT.test(text))
}

function emitText(node, S) {
  if (!node.data || !/\S/.test(node.data)) return
  const parent = renderParent(node)
  if (!parent) return

  const ctx = contextOf(parent, S)
  const preserve = /^(pre|pre-wrap|break-spaces)$/.test(ctx.cs.whiteSpace)
  const count = preserve
    ? (node.data.match(/[^\r\n]*\S[^\r\n]*/g) || []).length
    : (node.data.match(/\S+/g) || []).length
  const paints = textPaints(parent, ctx.cs)
  if (ctx.unsafePaint || textSecurity(ctx.cs) || (!paints && shadowPaint(ctx.cs))) {
    S.n.effects += count
    return
  }
  // visibility is inherited and a descendant may re-assert it, so the parent's
  // own computed value is already the whole answer.
  if (ctx.cs.visibility !== 'visible' || ctx.alpha < ALPHA_MIN || !paints) {
    S.n.invisible += count
    return
  }

  const info = fontOf(parent, S, ctx.cs)
  const L = runMatrix(ctx)
  // Sideways glyphs are an exact affine image of a horizontal run, so a whole
  // word still places under one Tm — and per word is what keeps extraction from
  // reading H e l l o.
  const turn = info.vertical ? compose(L, info.turn) : L

  const range = node.ownerDocument.createRange()
  // Collapsing white-space modes keep the compact one-run-per-word path. In
  // pre/pre-wrap/break-spaces the spaces are content, so keep each source line in
  // one logical run. PDF extractors routinely discard trailing-space-only runs;
  // an internal sequence inside `alpha    beta` survives copy/paste reliably.
  const tokens = preserve ? /[^\r\n]*\S[^\r\n]*/g : /\S+/g
  for (const match of node.data.matchAll(tokens)) {
    const from = match.index
    const to = from + match[0].length
    // Per word in normal prose, per source line where white-space is preserved:
    // one CJK glyph anywhere else in a paragraph must not send every Latin word
    // around it down the per-glyph branch.
    if (info.vertical && isUpright(info, match[0])) {
      emitVertical(S, node, ctx, info, L, turn, range, from, to, preserve)
      continue
    }
    place(S, node, ctx, info, turn, range, from, to, true, preserve)
  }
}

/**
 * Which of a wrapped word's rects each of its characters was really painted in.
 * Blink breaks where the LINE runs out, not where the character count divides, so
 * sharing the word out by proportion hands every fragment its neighbour's glyphs
 * and leaves Tz squashing them into a box they never occupied. One Range probe
 * per code point is the only thing that knows, and it is paid only by a word that
 * actually wrapped — which is rare, and always short.
 *
 * Returns the source text of each rect, and the non-empty rects in the order the
 * SOURCE reaches them: bidi hands back its rects in visual order, and the run that
 * goes out first is the one extraction reads first.
 *
 * `line-height: 0` is the case this LOSES, and not only for bidi. Every line box
 * is then painted in the same place, so no geometry separates the lines at all and
 * the horizontal gap below answers from whichever line it likes. MEASURED, 6 words
 * × 4 transforms at `line-height: 0`: the split is wrong in all 24. `Hyphenation`
 * is painted in four rects and comes back as ONE run carrying all eleven
 * characters, placed in the first rect's 28.45 px box — three of the four painted
 * fragments get no run at all. What survives is the two invariants extraction
 * actually needs: over 180 such cases nothing was lost or duplicated, and only the
 * one bidi word reordered.
 */
function groupByRect(node, from, to, rects, range, L) {
  // A DOMRectList, not an array — it indexes and has a length, and that is all.
  const parts = new Array(rects.length).fill('')
  const at = new Array(rects.length).fill(0)
  const data = node.data
  // Which line a character is on is its position along the NORMAL to the mapped
  // baseline, (−b, a) — not along the mapped local +y, (c, d). Those two agree
  // only for an orthogonal map: under skewX(20deg) a step along the baseline has a
  // component on (c, d) worth several px, which hands characters to other lines.
  const vx = L ? -L.b : 0
  const vy = L ? L.a : 1
  // v / scale is the perpendicular gap to a line in painted px. Zero is not a
  // usable test for "same line": MEASURED, under rotate(30deg) the seven
  // characters of `xyאבגzw` sit 4.9e-8 … 1.25e-5 px from the three rects they all
  // share a LINE with, and never 0 — untransformed the same gaps are exactly 0.
  // Without a window the branch below, the only thing that knows which bidi run a
  // character is in, is dead. The window is sized per character: see TIE_REL.
  const scale = Math.hypot(vx, vy)
  // Within a line — bidi runs, the rect a hyphen gets to itself — the gap along
  // the viewport axis the baseline runs closest to decides instead. An AABB is not
  // the quad, but every fragment on one line shares that line's height, so each
  // one's AABB overshoots its quad by the same amount and the comparison between
  // them survives it.
  const alongX = !L || Math.abs(L.a) >= Math.abs(L.b)
  let last = 0
  for (let i = from; i < to;) {
    // Code POINTS, never UTF-16 units: half a surrogate pair is not a character,
    // and would reach /ToUnicode as an unpaired one.
    const ch = String.fromCodePoint(data.codePointAt(i))
    range.setStart(node, i)
    range.setEnd(node, i + ch.length)
    // A character that straddles a break has a rect on each side; the first one is
    // where it starts. Zero-width and combining characters still report a box at
    // their base's position, so only a character with NO box at all falls through
    // to its neighbour's fragment.
    const cr = range.getClientRects()[0]
    let best = last
    if (cr) {
      const cx = cr.left + cr.right
      const cy = cr.top + cr.bottom
      const tie = TIE_REL * scale * (Math.abs(cx) + Math.abs(cy)) / 2
      let bv = Infinity
      let bh = Infinity
      for (let n = 0; n < rects.length; n++) {
        // Start at the previous character's fragment, so a genuine tie resolves
        // forward and the split stays contiguous — which is also all that holds
        // the `line-height: 0` case together; see above.
        const k = (last + n) % rects.length
        const r = rects[k]
        const v = Math.abs((cx - r.left - r.right) * vx + (cy - r.top - r.bottom) * vy) / 2
        // Negative when the boxes overlap, and by how deeply.
        const h = alongX
          ? Math.max(r.left - cr.right, cr.left - r.right)
          : Math.max(r.top - cr.bottom, cr.top - r.bottom)
        if (v < bv - tie || (v < bv + tie && h < bh)) { best = k; bv = Math.min(bv, v); bh = h }
      }
    }
    if (!parts[best]) at[best] = i
    parts[best] += ch
    last = best
    i += ch.length
  }
  const order = []
  for (let k = 0; k < rects.length; k++) if (parts[k]) order.push(k)
  return { parts, order: order.sort((p, q) => at[p] - at[q]) }
}

/**
 * One word/source line, or one same-orientation stretch of it. Offsets index the
 * SOURCE, and the painted form is derived here: `text-transform` never reaches
 * the text node, so the DOM string and the pixels disagree without it.
 */
function place(S, node, ctx, info, L, range, from, to, first, preserveWords = false) {
  // The element the glyphs belong to STRUCTURALLY, which is the flattened parent
  // — the same one `ctx` was derived from. Read once per word, not per fragment.
  const owner = renderParent(node)
  range.setStart(node, from)
  range.setEnd(node, to)
  // A word that wraps yields several rects; each fragment is placed on its own.
  // Bidi does the same, which is why RTL needs no shaping here: every fragment
  // is placed from its own box and extraction stays in logical order.
  const rects = range.getClientRects()
  if (!rects.length) return
  const display = (text, startsWord) => preserveWords
    ? applyTransform(text, info.transform)
    : shown(info, text, startsWord)
  if (rects.length === 1) { pushRun(S, display(node.data.slice(from, to), first), rects[0], info, L, ctx, owner); return }
  const { parts, order } = groupByRect(node, from, to, rects, range, L)
  // Only the fragment the word STARTS in may take the capital.
  for (const i of order) pushRun(S, display(parts[i], first && i === order[0]), rects[i], info, L, ctx, owner)
}

/**
 * Vertical writing never appears in any computed transform, so the accumulated L
 * is blind to it. This is the branch for a word that MIXES orientations under
 * `text-orientation: mixed`: an upright glyph's advance is vertical while the
 * glyph itself stays horizontal, which no single Tm expresses — it needs a Type0
 * font with a vertical CMap, so here it is simply placed square (and base-14 drops
 * it anyway, being CJK). The sideways stretches BETWEEN those glyphs still go out
 * whole: `日本語のtext` is one \S+ word, and its Latin tail must not shatter.
 */
function emitVertical(S, node, ctx, info, L, turn, range, from, to, preserveWords = false) {
  const owner = renderParent(node)
  const data = node.data
  const chars = []
  // Code POINTS, not UTF-16 units: half a surrogate pair is not a character, and
  // pdf-writer would map it to an unpaired /ToUnicode destination.
  for (let i = from; i < to;) {
    const ch = String.fromCodePoint(data.codePointAt(i))
    chars.push({ i, ch, up: isUpright(info, ch) })
    i += ch.length
  }
  for (let k = 0; k < chars.length;) {
    const { i, ch, up } = chars[k]
    if (up) {
      range.setStart(node, i)
      range.setEnd(node, i + ch.length)
      const rect = range.getClientRects()[0]
      // The warning belongs to a glyph that was actually PLACED — pushRun still
      // drops it for a degenerate rect, a singular matrix or the clip.
      if (rect && pushRun(S, shown(info, ch, k === 0), rect, info, L, ctx, owner)) S.f.upright = true
      k++
      continue
    }
    let e = k + 1
    while (e < chars.length && !chars[e].up) e++
    const end = e < chars.length ? chars[e].i : to
    place(S, node, ctx, info, turn, range, i, end, k === 0, preserveWords)
    k = e
  }
}

// ——— form controls ———

function controlText(el) {
  const tag = el.tagName
  if (tag === 'SELECT') {
    // A multiple/sized select paints a scrolling list of options; reconstructing
    // which ones are visible is guesswork, so it contributes nothing.
    if (el.multiple || el.size > 1) return ''
    const opt = el.selectedOptions[0]
    return opt ? opt.label || opt.text : ''
  }
  if (tag === 'TEXTAREA') return el.value || el.placeholder
  if (!TEXT_INPUTS.has(el.type)) return ''
  if (el.type === 'password') {
    // The value must never reach the file: a text layer is plain text on disk,
    // and an invisible one is still copy-pasteable. Bullets are what is painted.
    return el.value ? '•'.repeat(el.value.length) : el.placeholder
  }
  // Date-ish controls paint a locale-formatted value; the ISO value is what is
  // reachable, so those runs are searchable but may not match the pixels.
  return el.value || el.placeholder
}

/**
 * True wrap geometry needs a mirror element laid out with the same style — a
 * whole extra layout per textarea. Greedy breaking on spaces at the content
 * width matches Chrome for ordinary prose and errs by one word for hyphenation,
 * CJK, and unbreakable strings (which Chrome breaks mid-word and this does not).
 */
function wrapLines(text, info, width) {
  const out = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && measureReal(info, next) > width) { out.push(line); line = word }
      else line = next
    }
    out.push(line)
  }
  return out
}

function alignOffset(info, boxWidth, textWidth) {
  const a = info.align
  if (a === 'center') return (boxWidth - textWidth) / 2
  if (a === 'right' || a === 'end' || (info.rtl && (a === 'start' || a === 'match-parent'))) {
    return boxWidth - textWidth
  }
  return 0
}

/**
 * Control values have no text node, so they get placed from layout metrics
 * instead of client rects: local point → viewport through the centring theorem,
 * exactly as paddingBox does.
 */
function emitControl(el, S) {
  const ctx = contextOf(el, S)
  const cs = ctx.cs
  const raw = controlText(el)
  // Nothing to place is not the same as something dropped, so it is not counted.
  if (!raw || !/\S/.test(raw)) return
  const paints = textPaints(el, cs)
  // Passwords are deliberately converted to bullets by controlText(). For every
  // other use of -webkit-text-security, omission is safer than writing the source
  // value that the browser replaced with dots.
  const securedSource = textSecurity(cs) && !(el.tagName === 'INPUT' && el.type === 'password')
  if (ctx.unsafePaint || securedSource || (!paints && shadowPaint(cs))) {
    S.n.effects++
    return
  }
  if (cs.visibility !== 'visible' || ctx.alpha < ALPHA_MIN || !paints) {
    S.n.invisible++
    return
  }

  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) { S.n.invisible++; return }
  const L = runMatrix(ctx)
  if (L && Math.abs(L.a * L.d - L.b * L.c) < SINGULAR) { S.n.invisible++; return }

  const info = fontOf(el, S, cs)
  const text = applyTransform(raw, info.transform)
  const px = (v) => parseFloat(v) || 0
  let left = px(cs.borderLeftWidth) + px(cs.paddingLeft)
  const top = px(cs.borderTopWidth) + px(cs.paddingTop)
  // clientWidth/Height exclude the scrollbar, which is where the value is laid
  // out; their integer rounding is well under one glyph.
  let boxW = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
  const boxH = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)
  if (el.tagName === 'SELECT' && THEMED.test(cs.appearance)) {
    // Both insets shrink the box the value is aligned in, and which one lands on
    // the left is what `direction` decides — under rtl the arrow is on the left.
    left += info.rtl ? MENULIST_END : MENULIST_START
    boxW -= MENULIST_START + MENULIST_END
  }
  if (boxW <= 0 || boxH <= 0) { S.n.invisible++; return }

  // offsetWidth is integer-rounded, so prefer the exact AABB when nothing rotates.
  const frame = {
    cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2,
    w: L ? el.offsetWidth : r.width, h: L ? el.offsetHeight : r.height,
  }
  const clip = intersect(ctx.clip, paddingBox(el, ctx.L, CONTROL_CLIP))

  const inline = info.ascent + info.descent
  const multiline = el.tagName === 'TEXTAREA'
  const lineH = multiline ? info.lineHeight : boxH
  const lines = multiline ? wrapLines(text, info, boxW) : [text]
  const scrollX = el.scrollLeft || 0
  const scrollY = el.scrollTop || 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/\S/.test(line)) continue
    const width = measureReal(info, line)
    // Single-line controls centre their value in the content box; a textarea
    // stacks line boxes from the top, each with its half-leading.
    const ly = top + i * lineH + (lineH - inline) / 2 + info.ascent - scrollY
    const lx = left + alignOffset(info, boxW, width) - scrollX
    pushLocalRun(S, line, info, L, frame, lx, ly, width, inline, clip, el)
  }
}

function pushLocalRun(S, text, info, L, frame, lx, ly, width, height, clip, owner) {
  const map = (x, y) => {
    const dx = x - frame.w / 2
    const dy = y - frame.h / 2
    return L
      ? [frame.cx + L.a * dx + L.c * dy, frame.cy + L.b * dx + L.d * dy]
      : [frame.cx + dx, frame.cy + dy]
  }
  const [ccx, ccy] = map(lx + width / 2, ly - info.ascent + height / 2)
  const hx = L ? (Math.abs(L.a) * width + Math.abs(L.c) * height) / 2 : width / 2
  const hy = L ? (Math.abs(L.b) * width + Math.abs(L.d) * height) / 2 : height / 2
  const aabb = {
    left: ccx - hx, top: ccy - hy, right: ccx + hx, bottom: ccy + hy,
    width: 2 * hx, height: 2 * hy,
  }
  if (!fullyInside(aabb, clip)) { S.n.clipped++; return }

  const [originX, originY] = map(lx, ly)
  S.runs.push({
    text, originX, originY, width, height, ascent: info.ascent,
    size: info.size, font: info.key, fk: info.fk,
    naturalWidth: measureNatural(info, text),
    matrix: L, rtl: info.rtl, color: info.color, tracking: info.trackingPx,
  })
  // A control's value belongs to the control itself: there is no text node to
  // take a parent from, which is the whole reason this path exists.
  S.owners.push(owner)
}

// ——— links ———

/**
 * Resolve HTML and SVG hrefs through the same URL parser. SVG exposes a raw
 * SVGAnimatedString (`#dest`), while HTMLAnchorElement.href is usually absolute;
 * reading the attribute first makes both paths identical and also lets the URL
 * parser canonicalize protocol case before the allowlist is applied.
 *
 * Same-document fragments are PDF destinations, not external actions, and are
 * allowed even on `file:`/`about:` pages. Other URLs must use an explicitly safe
 * protocol: active (`javascript:`), embedded (`data:`/`blob:`) and local-file
 * actions never reach the file.
 */
function linkHref(el, documentURL) {
  const attr = el.getAttribute && el.getAttribute('href')
  const raw = attr != null ? attr : (typeof el.href === 'string' ? el.href : el.href?.baseVal)
  if (typeof raw !== 'string' || !raw.trim()) return null

  let url
  try {
    url = new URL(raw, el.baseURI || el.ownerDocument?.baseURI || location.href)
  } catch {
    return null
  }

  const href = url.href
  const hash = href.indexOf('#')
  // In production `el.ownerDocument.location` is `about:srcdoc`: layout runs in a
  // sandboxed iframe reconstructed from the final SVG. The source document URL is
  // therefore an explicit measurement input, not something this DOM can infer.
  const here = String(documentURL || el.ownerDocument?.location?.href || location.href).split('#')[0]
  if (hash >= 0 && href.slice(0, hash) === here) return href
  return LINK_PROTOCOLS.has(url.protocol.toLowerCase()) ? href : null
}

function emitLink(el, S) {
  const href = linkHref(el, S.documentURL)
  if (!href) {
    if (String(el.getAttribute && el.getAttribute('href') || '').trim()) S.n.unsafeLinks++
    return
  }
  const ctx = contextOf(el, S)
  const paints = textPaints(el, ctx.cs)
  if (ctx.unsafePaint || textSecurity(ctx.cs) || (!paints && shadowPaint(ctx.cs))) {
    S.n.effects++
    return
  }
  const ownsText = /\S/.test(el.textContent || '')
  if (ctx.cs.visibility !== 'visible' || ctx.alpha < ALPHA_MIN ||
      (ownsText && !paints)) {
    S.n.invisible++
    return
  }
  for (const rect of el.getClientRects()) {
    if (rect.width <= 0 || rect.height <= 0) continue
    const shown = clippedRect(rect, ctx.clip)
    if (!shown) { S.n.clipped++; continue }
    if (shown.cropped) S.n.croppedLinks++
    // PDF 1.4 /Rect is axis-aligned and cannot be rotated, so a rotated link
    // ships its AABB: a superset of the real quad, generous rather than wrong.
    S.links.push({
      href, x: shown.left, y: shown.top,
      width: shown.width, height: shown.height, matrix: null,
      // The owner element, so the structure tree can hang a /Link node with an
      // /OBJR at the right place. index.js strips it before anything escapes the
      // measurement frame.
      el,
    })
  }
}

// ——— fillable fields ———

/** Input types that become fillable text fields. Date-ish controls carry their
 * ISO value — the same value the text layer documents for its runs. */
const FIELD_TEXT = new Set([
  'text', 'search', 'email', 'url', 'tel', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
])

/** A computed colour as an [r, g, b] triple in 0..1, or null when transparent.
 * The same 1px-canvas trick colourAlpha uses, reading colour instead of alpha. */
function colourTriple(value) {
  if (!value || value === 'none') return null
  if (!paintContext) {
    // colourAlpha builds the shared context lazily; reuse its path.
    if (colourAlpha(value) === 0) return null
  }
  if (!paintContext) return null
  paintContext.clearRect(0, 0, 1, 1)
  paintContext.fillStyle = '#000'
  try { paintContext.fillStyle = value } catch { /* computed colours should parse */ }
  paintContext.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = paintContext.getImageData(0, 0, 1, 1).data
  if (a < 128) return null
  return [r / 255, g / 255, b / 255]
}

/** The label a viewer shows as the field's tooltip and a screen reader speaks —
 * the accessible-name order, shortened to what these controls actually use. */
function controlLabel(el) {
  const aria = el.getAttribute && el.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()
  const label = el.labels && el.labels[0]
  if (label) {
    const text = (label.textContent || '').trim().replace(/\s+/g, ' ')
    if (text) return text
  }
  const placeholder = el.getAttribute && el.getAttribute('placeholder')
  if (placeholder && placeholder.trim()) return placeholder.trim()
  const title = el.getAttribute && el.getAttribute('title')
  return title && title.trim() ? title.trim() : null
}

/**
 * One control record for the fillable-field planner: what the control IS, where
 * it is, what it holds, and how it is painted — measured under the same
 * visibility, clip and transform rules as every text run, in the same pass.
 *
 * The rules a record can fail, and what failing means:
 *  - invisible / display-hidden controls produce NO record, exactly as a hidden
 *    control cannot be filled on the page it was captured from;
 *  - a clipped control is recorded with `skip: 'clipped'` — a widget reaching
 *    outside the capture's clip would expose area the capture excluded;
 *  - a transformed control is recorded with `skip: 'transformed'` — a widget's
 *    /Rect is axis-aligned, and drawing one over a rotated control would be a
 *    lie about where the field is.
 * Skipped records still reach the planner so the loss is REPORTED, not silent.
 */
function recordControl(el, S) {
  const tag = el.tagName
  const type = tag === 'INPUT' ? String(el.type || 'text').toLowerCase() : null

  let kind = null
  if (tag === 'SELECT') kind = 'select'
  else if (tag === 'TEXTAREA') kind = 'multiline'
  else if (type === 'checkbox') kind = 'checkbox'
  else if (type === 'radio') kind = 'radio'
  else if (type === 'password') kind = 'password'
  else if (FIELD_TEXT.has(type)) kind = 'text'
  // Buttons, file pickers, sliders, colour wells and hidden inputs stay pixels:
  // none of them holds a value a fillable field could round-trip.
  if (!kind) return

  const ctx = contextOf(el, S)
  const cs = ctx.cs
  if (cs.visibility !== 'visible' || ctx.alpha < ALPHA_MIN) return
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return

  let skip = null
  if (!ctx.affine || runMatrix(ctx)) skip = 'transformed'
  else {
    // ctx.clip includes the control's OWN clip — a text input carries a UA
    // `overflow: clip` — and no border box fits inside its own padding box. The
    // widget covers the whole control, so the question is whether an ANCESTOR
    // hides any of it: the same clip choice contextOf makes for the element,
    // one level up.
    const parent = renderParent(el)
    const base = parent ? contextOf(parent, S) : null
    const inherited = !base ? NO_CLIP
      : cs.position === 'fixed' ? base.clipFixed
      : cs.position === 'absolute' ? base.clipAbs
      : base.clip
    if (!fullyInside({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, inherited)) {
      skip = 'clipped'
    }
  }

  const record = {
    kind,
    el,
    name: String(el.getAttribute('name') || '').trim() || null,
    id: String(el.id || '').trim() || null,
    label: controlLabel(el),
    // The password rule restated at the source: the VALUE never leaves the
    // measurement frame, only its length is even knowable to the planner.
    value: kind === 'password' ? '' :
      kind === 'checkbox' || kind === 'radio' ? String(el.value || '') :
      kind === 'select' ? '' : String(el.value || ''),
    checked: kind === 'checkbox' || kind === 'radio' ? !!el.checked : false,
    multiple: kind === 'select' ? !!el.multiple : false,
    listbox: kind === 'select' ? (!!el.multiple || (el.size || 0) > 1) : false,
    options: kind === 'select'
      ? [...el.options].map(o => ({
        value: String(o.value), label: String(o.label || o.text || ''), selected: !!o.selected,
      }))
      : [],
    readonly: !!(el.readOnly || el.disabled),
    required: !!el.required,
    maxLength: tag === 'TEXTAREA' || kind === 'text' || kind === 'password'
      ? (el.maxLength > 0 ? el.maxLength : 0) : 0,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    style: {
      bg: colourTriple(cs.backgroundColor),
      border: colourTriple(cs.borderTopColor),
      borderW: parseFloat(cs.borderTopWidth) || 0,
      color: colourTriple(cs.color) || [0, 0, 0],
      size: parseFloat(cs.fontSize) || 16,
      align: /right|end/.test(cs.textAlign) ? 'right' : cs.textAlign === 'center' ? 'center' : 'left',
    },
    skip,
    transformed: skip === 'transformed',
    runs: [],
  }
  S.controls.push(record)
}

// ——— non-text semantic objects ———

function hiddenFromAT(el, root) {
  let node = el
  while (node) {
    if (node.getAttribute &&
        String(node.getAttribute('aria-hidden')).trim().toLowerCase() === 'true') return true
    if (node === root) break
    node = renderParent(node)
  }
  return false
}

/**
 * A textless Figure has no run for the tagged-PDF ParentTree to associate with a
 * page. Give it one whitespace-only marked-content run: it paints no ink, adds no
 * searchable word, but lets a reader reach the Figure and announce its /Alt. The
 * whole-page raster remains an Artifact, so it is never announced twice.
 */
function emitSemanticMarkers(root, S) {
  const seen = new Set()
  const occupied = new Set()
  for (const owner of new Set(S.owners)) {
    if (hiddenFromAT(owner, root)) continue
    let node = owner
    while (node) {
      if (isFigure(node)) occupied.add(node)
      if (node === root) break
      node = renderParent(node)
    }
  }
  const visit = (el) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    if (hiddenFromAT(el, root)) return

    // An image nobody named has no /Alt to announce, and the raster showing it is
    // an Artifact, so a painted one blocks the PDF/UA-1 claim. `alt=""` is the
    // author calling it decorative. A <figure> takes its name from what it holds.
    if (isFigure(el) && !semanticAlt(el) && !occupied.has(el) && !el.hasAttribute('alt') &&
        el.tagName.toUpperCase() !== 'FIGURE') {
      const ctx = contextOf(el, S)
      const r = el.getBoundingClientRect()
      if (ctx.cs.visibility === 'visible' && ctx.alpha >= ALPHA_MIN && r.width > 0 && r.height > 0) {
        S.n.unnamedImages++
      }
    }

    if (isFigure(el) && semanticAlt(el) && !occupied.has(el)) {
      const ctx = contextOf(el, S)
      const r = el.getBoundingClientRect()
      if (ctx.unsafePaint) {
        S.n.effects++
      } else if (ctx.cs.visibility === 'visible' && ctx.alpha >= ALPHA_MIN &&
          r.width > 0 && r.height > 0 && fullyInside(r, ctx.clip)) {
        const size = 1
        const ascent = 0.8
        const width = Math.min(r.width, 0.278)
        S.runs.push({
          text: ' ', originX: r.left, originY: r.top + ascent,
          width, height: 1, ascent, size, font: 'sans', fk: -1, naturalWidth: 0.278,
          matrix: null, rtl: false, color: null, tracking: 0,
        })
        S.owners.push(el)
      } else if (r.width > 0 && r.height > 0 && !fullyInside(r, ctx.clip)) {
        S.n.clipped++
      } else {
        S.n.invisible++
      }
    }

    const tag = el.tagName.toUpperCase()
    let kids
    if (el.shadowRoot) kids = el.shadowRoot.children
    else if (tag === 'SLOT') kids = el.assignedElements({ flatten: true })
    else kids = el.children
    for (const kid of kids) visit(kid)
  }
  visit(root)
}

// ——— the walk ———

/**
 * Flattened-tree traversal, which is also the deduplication rule: a host's light
 * children are NOT visited as children of the host — they are reached exactly
 * once, through the slot they are assigned to. Walking both trees naively would
 * emit slotted text twice, at two different places.
 */
function walk(node, S) {
  if (node.nodeType === Node.TEXT_NODE) { emitText(node, S); return }
  if (node.nodeType !== Node.ELEMENT_NODE) return

  // SVG tag names are lower case, HTML's are upper — normalize once.
  const tag = node.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag)) return
  if (tag === 'A' && node.hasAttribute('href')) emitLink(node, S)
  if (CONTROL_TAGS.has(tag)) {
    // Record before emit: the field planner needs the control even when its
    // value is empty, which is exactly when emitControl has nothing to place.
    if (S.forms) recordControl(node, S)
    if (S.formValues) emitControl(node, S)
    return
  }

  let kids
  if (node.shadowRoot) {
    if (!S.shadow) return
    kids = node.shadowRoot.childNodes
  } else if (tag === 'SLOT') {
    // flatten:true also yields the fallback content when nothing is assigned.
    kids = node.assignedNodes({ flatten: true })
  } else {
    // A closed root is unreachable from here: the host looks like an empty leaf.
    if (tag.includes('-') && !node.firstChild && window.customElements?.get(tag.toLowerCase())) S.f.closed++
    kids = node.childNodes
  }
  for (const kid of kids) walk(kid, S)
}

/**
 * @param {Element} root
 * @param {object} [options]
 * @param {boolean} [options.formValues=true] Emit input/textarea/select values.
 * @param {boolean} [options.shadow=true]     Enter open shadow roots.
 * @param {string} [options.documentURL]      Source URL; the measurement iframe
 *   itself is `about:srcdoc`, so same-document fragments need this explicitly.
 * @returns {{runs: Array, links: Array, warnings: string[]}}
 *
 * A run is `{ text, originX, originY, width, height, ascent, size, font,
 * naturalWidth, matrix }`. `originX`/`originY` are the baseline start point in
 * VIEWPORT CSS px; everything else is a length in the run's OWN space, which
 * `matrix` — the 2×2 linear part, null when that map is the identity — carries
 * into the viewport.
 *
 *   width         the advance the run must occupy
 *   height        the INLINE box, ascent + descent. Not the line box: a
 *                 `line-height: 2` run's leading is deliberately not in it,
 *                 because this is the painted extent
 *   ascent        baseline to the top of that box, so `originY - ascent` is the
 *                 top edge and `+ height` the bottom — the span a page-slice
 *                 overlap test needs, and not derivable from `size`/`font`
 *                 (it comes from the CSS font, those name the substitute)
 *   naturalWidth  the advance the base-14 substitute produces, for
 *                 Tz = width / naturalWidth. MAY BE 0 for a run the substitute
 *                 gives no advance at all: the caller must guard the division.
 *
 * A link is `{ href, x, y, width, height, matrix }` and `matrix` is ALWAYS null,
 * by construction: PDF /Rect cannot be rotated, so x/y/width/height are the
 * viewport AABB of the link's quad even when it is rotated — a superset.
 */
export function collectTextLayer(root, options = {}) {
  const { formValues = true, shadow = true, documentURL = null, forms = true } = options
  const S = {
    root, formValues, shadow, documentURL, forms,
    runs: [], owners: [], links: [], controls: [],
    fontKeys: [], fontKeyIndex: new Map(),
    ctxCache: new WeakMap(), fontCache: new WeakMap(), layoutFontCache: new Map(),
    metricHost: null,
    n: {
      invisible: 0, clipped: 0, croppedLinks: 0,
      effects: 0, nonAffine: 0, unsafeLinks: 0, unnamedImages: 0,
    },
    f: { upright: false, zoom: false, contentVisibility: false, svgNoCtm: false, closed: 0 },
  }

  try {
    walk(root, S)
    emitSemanticMarkers(root, S)
  } finally {
    // The probe never belongs to the captured document and must not outlive the
    // synchronous measurement pass when this helper is used outside index.js.
    if (S.metricHost) S.metricHost.remove()
  }

  const warnings = []
  if (S.n.nonAffine) warnings.push(`${S.n.nonAffine} run(s) under a 3D/perspective transform — placed axis-aligned`)
  if (S.n.invisible) warnings.push(`${S.n.invisible} run(s)/link(s) dropped because their paint is invisible or degenerate`)
  if (S.n.effects) warnings.push(`${S.n.effects} run(s)/link(s) omitted because a visual effect cannot be mapped safely ` +
    '(clip-path, mask, filter, text masking/shadow, blend mode, or text background clip)')
  if (S.n.clipped) warnings.push(`${S.n.clipped} run(s)/link(s) dropped because an overflow clip hides any part of them`)
  if (S.n.croppedLinks) warnings.push(`${S.n.croppedLinks} link annotation(s) cropped to their visible overflow area`)
  if (S.n.unsafeLinks) warnings.push(`${S.n.unsafeLinks} link(s) dropped because their URL is malformed or uses an unsafe protocol`)
  if (S.f.svgNoCtm) warnings.push('SVG content without a screen CTM — placed axis-aligned')
  if (S.f.upright) warnings.push('upright glyphs in vertical writing-mode — placed square, they need the Type0 vertical path')
  if (S.f.contentVisibility) warnings.push('content-visibility on an ancestor may have skipped content')
  if (S.f.zoom) warnings.push('zoom on an ancestor — geometry is taken as measured')
  if (S.f.closed) warnings.push(`${S.f.closed} custom element(s) may hold a closed shadow root — unreadable`)
  // index.js frames the raster on the root's AABB, which cannot describe a rotated root.
  if (runMatrix(contextOf(root, S))) {
    warnings.push('capture root has a non-identity transform — the raster frame assumes an axis-aligned root')
  }

  return {
    runs: S.runs, owners: S.owners, links: S.links, controls: S.controls, fontKeys: S.fontKeys, warnings,
    unnamedImages: S.n.unnamedImages,
  }
}
